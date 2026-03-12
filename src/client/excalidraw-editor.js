import React from 'react';
import { createRoot } from 'react-dom/client';
import { CaptureUpdateAction, Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';

import {
  findCollaboratorByPeerId,
  mergeAwarenessUserPatch,
  resolveLocalAwarenessUser,
} from './domain/excalidraw-collaboration.js';
import {
  normalizeScene,
  parseSceneJson,
  sceneToInitialData,
} from './domain/excalidraw-scene.js';
import { ensureClientAuthenticated } from './infrastructure/auth-client.js';
import { ExcalidrawRoomClient } from './infrastructure/excalidraw-room-client.js';
import { vaultApiClient } from './infrastructure/vault-api-client.js';

const params = new URLSearchParams(window.location.search);
const filePath = params.get('file');
const isTestMode = params.get('test') === '1';
const parentOrigin = window.location.origin;
const syncTimeoutMs = Number.parseInt(params.get('syncTimeoutMs') || '', 10);

let excalidrawAPI = null;
let currentTheme = params.get('theme') || 'dark';
let localAwarenessUser = resolveLocalAwarenessUser({
  params,
  storedUserName: localStorage.getItem('collabmd-user-name'),
});
let appliedSceneJson = '';

let collabReady = false;
let suppressOnChange = false;
let pendingRemoteSceneJson = '';
let pendingCollaborators = null;
let pendingSuppressionReleases = 0;
let activeCollaborators = new Map();
let followedSocketId = null;
let pendingHostFollowPeerId = null;
let suppressViewportBroadcast = false;
let pendingViewportSuppressionReleases = 0;
let lastAppliedFollowViewportSignature = '';
let apiCleanupCallbacks = [];
const roomClient = new ExcalidrawRoomClient({
  filePath,
  onCollaboratorsChange: (collaborators) => {
    if (!collabReady) {
      pendingCollaborators = collaborators;
      return;
    }

    applyCollaborators(collaborators);
  },
  onRemoteSceneJson: (sceneJson) => {
    applySceneFromJson(sceneJson);
  },
  syncTimeoutMs: Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : undefined,
  vaultClient: vaultApiClient,
});

function SharedHistoryControls({ roomClient: connectedRoomClient, isMobile = false }) {
  const [historyState, setHistoryState] = React.useState(() => connectedRoomClient.getHistoryState());

  React.useEffect(() => connectedRoomClient.subscribeHistoryState(setHistoryState), [connectedRoomClient]);

  return React.createElement(
    'div',
    {
      className: `collabmd-excalidraw-history-controls${isMobile ? ' is-mobile' : ''}`,
    },
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'collabmd-excalidraw-history-btn',
        disabled: !historyState.canUndo,
        onClick: () => {
          connectedRoomClient.undoShared();
        },
      },
      'Undo',
    ),
    React.createElement(
      'button',
      {
        type: 'button',
        className: 'collabmd-excalidraw-history-btn',
        disabled: !historyState.canRedo,
        onClick: () => {
          connectedRoomClient.redoShared();
        },
      },
      'Redo',
    ),
  );
}

function ensureSharedHistoryStyles() {
  if (document.getElementById('collabmd-excalidraw-history-styles')) {
    return;
  }

  const style = document.createElement('style');
  style.id = 'collabmd-excalidraw-history-styles';
  style.textContent = `
    .excalidraw .undo-redo-buttons {
      display: none !important;
    }

    .collabmd-excalidraw-history-controls {
      display: flex;
      align-items: center;
      gap: 8px;
    }

    .collabmd-excalidraw-history-controls.is-mobile {
      margin-left: 8px;
    }

    .collabmd-excalidraw-history-btn {
      appearance: none;
      border: 1px solid rgba(148, 163, 184, 0.35);
      background: rgba(15, 23, 42, 0.74);
      color: #f8fafc;
      border-radius: 10px;
      padding: 0 12px;
      min-height: 36px;
      font: 600 13px/1 "Helvetica Neue", Helvetica, Arial, sans-serif;
      cursor: pointer;
    }

    .collabmd-excalidraw-history-btn:hover:not(:disabled) {
      background: rgba(30, 41, 59, 0.92);
    }

    .collabmd-excalidraw-history-btn:disabled {
      cursor: default;
      opacity: 0.4;
    }

    .excalidraw.theme--light .collabmd-excalidraw-history-btn {
      background: rgba(255, 255, 255, 0.92);
      color: #0f172a;
    }

    .excalidraw.theme--light .collabmd-excalidraw-history-btn:hover:not(:disabled) {
      background: rgba(248, 250, 252, 1);
    }
  `;
  document.head.append(style);
}

function applyLocalUserPatch(nextUser = {}) {
  localAwarenessUser = mergeAwarenessUserPatch({
    currentUser: localAwarenessUser,
    nextUser,
  });
  roomClient.setLocalUser(localAwarenessUser);
}

if (isTestMode) {
  window.__COLLABMD_EXCALIDRAW_TEST__ = {
    getHistoryState: () => roomClient.getHistoryState(),
    getLocalUserName: () => localAwarenessUser?.name || '',
    getSceneJson: () => roomClient.getLastSceneJson(),
    isReady: () => collabReady && Boolean(excalidrawAPI),
    redoShared: () => roomClient.redoShared(),
    setScene: (scene) => {
      const json = JSON.stringify(normalizeScene(scene));
      applySceneFromJson(json);
      roomClient.commitSceneJson(json, {
        allowCoalesce: false,
        origin: 'excalidraw-test',
      });
    },
    undoShared: () => roomClient.undoShared(),
  };
}

function applyCollaborators(collaborators) {
  activeCollaborators = collaborators instanceof Map ? collaborators : new Map();

  if (!excalidrawAPI) {
    pendingCollaborators = activeCollaborators;
    return;
  }

  excalidrawAPI.updateScene({
    collaborators: activeCollaborators,
    captureUpdate: CaptureUpdateAction.NEVER,
  });

  if (pendingHostFollowPeerId) {
    applyHostFollowRequest(pendingHostFollowPeerId);
    return;
  }

  applyFollowedViewport(activeCollaborators);
}

function applySceneFromJson(rawJson) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (normalizedJson === appliedSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  appliedSceneJson = normalizedJson;

  if (!excalidrawAPI) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  updateApiScene(scene);
}

function releaseOnChangeSuppressionAfterPaint({ trackedSharedSnapshot = false } = {}) {
  pendingSuppressionReleases += 1;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingSuppressionReleases = Math.max(0, pendingSuppressionReleases - 1);
      if (trackedSharedSnapshot) {
        roomClient.endApplyingSharedSnapshot();
      }
      if (pendingSuppressionReleases === 0) {
        suppressOnChange = false;
      }
    });
  });
}

function releaseViewportBroadcastSuppressionAfterPaint() {
  pendingViewportSuppressionReleases += 1;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      pendingViewportSuppressionReleases = Math.max(0, pendingViewportSuppressionReleases - 1);
      if (pendingViewportSuppressionReleases === 0) {
        suppressViewportBroadcast = false;
      }
    });
  });
}

function updateApiScene(scene, {
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = true,
} = {}) {
  suppressOnChange = true;
  if (trackedSharedSnapshot) {
    roomClient.beginApplyingSharedSnapshot();
  }
  try {
    excalidrawAPI.updateScene({
      elements: scene.elements,
      appState: {
        theme: currentTheme,
        viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff',
        gridSize: scene.appState.gridSize ?? null,
      },
      files: scene.files || {},
      captureUpdate,
    });
  } finally {
    releaseOnChangeSuppressionAfterPaint({ trackedSharedSnapshot });
  }
}

function onRoomTextUpdate() {
  applySceneFromJson(roomClient.getLastSceneJson());
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function syncLocalViewportToRoom() {
  if (!collabReady || !excalidrawAPI || suppressViewportBroadcast) {
    return;
  }

  const appState = excalidrawAPI.getAppState();
  roomClient.scheduleLocalViewportAwareness({
    scrollX: appState.scrollX,
    scrollY: appState.scrollY,
    zoom: appState.zoom?.value,
  });
}

function setFollowedSocket(nextSocketId, { force = false } = {}) {
  const normalizedSocketId = nextSocketId ? String(nextSocketId) : null;
  const didChange = followedSocketId !== normalizedSocketId;
  followedSocketId = normalizedSocketId;
  if (didChange) {
    lastAppliedFollowViewportSignature = '';
  }

  if (followedSocketId) {
    applyFollowedViewport(activeCollaborators, { force: force || didChange });
  }
}

function applyFollowedViewport(collaborators = activeCollaborators, { force = false } = {}) {
  if (!excalidrawAPI || !followedSocketId) {
    return;
  }

  const collaborator = collaborators?.get?.(String(followedSocketId));
  const viewport = collaborator?.viewport;
  if (!viewport) {
    return;
  }

  const nextSignature = `${followedSocketId}:${viewport.scrollX}:${viewport.scrollY}:${viewport.zoom}`;
  if (!force && nextSignature === lastAppliedFollowViewportSignature) {
    return;
  }

  lastAppliedFollowViewportSignature = nextSignature;
  suppressViewportBroadcast = true;
  excalidrawAPI.updateScene({
    appState: {
      scrollX: viewport.scrollX,
      scrollY: viewport.scrollY,
      zoom: { value: viewport.zoom },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  releaseViewportBroadcastSuppressionAfterPaint();
}

function applyHostFollowRequest(peerId) {
  pendingHostFollowPeerId = peerId || null;
  if (!excalidrawAPI) {
    return;
  }

  if (!peerId) {
    excalidrawAPI.updateScene({
      appState: { userToFollow: null },
      captureUpdate: CaptureUpdateAction.NEVER,
    });
    setFollowedSocket(null, { force: true });
    pendingHostFollowPeerId = null;
    return;
  }

  const collaborator = findCollaboratorByPeerId(activeCollaborators, peerId);
  if (!collaborator?.socketId) {
    return;
  }

  excalidrawAPI.updateScene({
    appState: {
      userToFollow: {
        socketId: collaborator.socketId,
        username: collaborator.username || '',
      },
    },
    captureUpdate: CaptureUpdateAction.NEVER,
  });
  setFollowedSocket(collaborator.socketId, { force: true });
  pendingHostFollowPeerId = null;
}

function disconnectRealtimeRoom() {
  collabReady = false;
  pendingCollaborators = null;
  activeCollaborators = new Map();
  followedSocketId = null;
  pendingHostFollowPeerId = null;
  suppressViewportBroadcast = false;
  pendingViewportSuppressionReleases = 0;
  lastAppliedFollowViewportSignature = '';
  apiCleanupCallbacks.forEach((cleanup) => cleanup());
  apiCleanupCallbacks = [];
  roomClient.disconnect();
}

function handleSharedHistoryKeydown(event) {
  if (!collabReady || !excalidrawAPI || event.altKey) {
    return;
  }

  const key = String(event.key || '').toLowerCase();
  const isPrimaryModifier = event.metaKey || event.ctrlKey;
  const isUndo = isPrimaryModifier && key === 'z' && !event.shiftKey;
  const isRedo = (
    isPrimaryModifier
    && ((key === 'z' && event.shiftKey) || (key === 'y' && event.ctrlKey && !event.metaKey && !event.shiftKey))
  );

  if (!isUndo && !isRedo) {
    return;
  }

  event.preventDefault();
  event.stopPropagation();

  if (typeof event.stopImmediatePropagation === 'function') {
    event.stopImmediatePropagation();
  }

  if (isUndo) {
    roomClient.undoShared();
    return;
  }

  roomClient.redoShared();
}

window.addEventListener('pagehide', () => {
  disconnectRealtimeRoom();
});
document.addEventListener('keydown', handleSharedHistoryKeydown, true);

window.addEventListener('message', (event) => {
  if (event.origin !== parentOrigin) {
    return;
  }

  const message = event.data;
  if (!message || message.source !== 'collabmd-host') {
    return;
  }

  if (message.type === 'set-theme') {
    currentTheme = message.theme || 'dark';
    if (excalidrawAPI) {
      suppressOnChange = true;
      excalidrawAPI.updateScene({
        appState: { theme: currentTheme },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
      releaseOnChangeSuppressionAfterPaint();
    }
    return;
  }

  if (message.type === 'set-user') {
    applyLocalUserPatch(message.user);
    return;
  }

  if (message.type === 'follow-user') {
    applyHostFollowRequest(message.peerId || null);
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || suppressOnChange || roomClient.isApplyingSharedSnapshot()) {
    return;
  }

  roomClient.scheduleSceneSync(elements, appState, files);
}

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    await ensureClientAuthenticated();
    const initialScene = await roomClient.connect({ initialUser: localAwarenessUser });
    const initialData = sceneToInitialData(initialScene, { theme: currentTheme });
    ensureSharedHistoryStyles();

    loadingElement?.remove();

    const excalidrawProps = {
      excalidrawAPI: (api) => {
        apiCleanupCallbacks.forEach((cleanup) => cleanup());
        apiCleanupCallbacks = [];
        excalidrawAPI = api;

        const sceneJson = pendingRemoteSceneJson || roomClient.getLastSceneJson();
        pendingRemoteSceneJson = '';
        updateApiScene(parseSceneJson(sceneJson));

        if (pendingCollaborators) {
          excalidrawAPI.updateScene({
            collaborators: pendingCollaborators,
            captureUpdate: CaptureUpdateAction.NEVER,
          });
          pendingCollaborators = null;
        }
        apiCleanupCallbacks.push(excalidrawAPI.onScrollChange(() => {
          syncLocalViewportToRoom();
          applyFollowedViewport();
        }));
        apiCleanupCallbacks.push(excalidrawAPI.onUserFollow((payload) => {
          if (payload.action === 'FOLLOW') {
            setFollowedSocket(payload.userToFollow?.socketId, { force: true });
            return;
          }

          setFollowedSocket(null, { force: true });
        }));
        collabReady = true;
        syncLocalViewportToRoom();
        onRoomTextUpdate();
        if (pendingHostFollowPeerId) {
          applyHostFollowRequest(pendingHostFollowPeerId);
        }

        postToParent('ready');
      },
      initialData,
      aiEnabled: false,
      isCollaborating: true,
      onChange: (elements, appState, files) => {
        scheduleSyncToRoom(elements, appState, files);
        roomClient.syncLocalSelectionAwareness(appState);
      },
      onPointerUpdate: (payload) => {
        roomClient.scheduleLocalPointerAwareness(payload);
      },
      renderTopRightUI: (isMobile) => React.createElement(SharedHistoryControls, {
        isMobile,
        roomClient,
      }),
      theme: currentTheme,
      UIOptions: {
        canvasActions: {
          export: false,
          loadScene: false,
          saveToActiveFile: false,
          toggleTheme: false,
        },
      },
    };

    const App = () => React.createElement(
      'div',
      { style: { height: '100vh', width: '100%' } },
      React.createElement(Excalidraw, excalidrawProps),
    );

    const root = createRoot(document.getElementById('root'));
    root.render(React.createElement(App));
  } catch (error) {
    console.error('[excalidraw] Failed to initialize:', error);
    postToParent('error', {
      message: error instanceof Error ? error.message : 'Failed to load Excalidraw',
    });

    if (loadingElement) {
      loadingElement.className = 'loading-state error';
      loadingElement.textContent = `Failed to load Excalidraw: ${error instanceof Error ? error.message : String(error)}`;
    }
  }
}

void init();
