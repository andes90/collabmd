import React from 'react';
import { createRoot } from 'react-dom/client';
import {
  CaptureUpdateAction,
  Excalidraw,
  reconcileElements,
  restoreAppState,
  restoreElements,
} from '@excalidraw/excalidraw';
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
const isPreviewMode = params.get('mode') === 'preview';
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
let apiStateCleanupCallbacks = [];
let collaboratorRenderFrame = 0;
let queuedCollaborators = null;
let initialViewportFitPending = true;
const roomClient = new ExcalidrawRoomClient({
  filePath,
  onCollaboratorsChange: (collaborators) => {
    if (!collabReady) {
      pendingCollaborators = collaborators;
      return;
    }

    queueCollaboratorsRender(collaborators);
  },
  onRemoteSceneJson: (sceneJson) => {
    applySceneFromJson(sceneJson);
  },
  syncTimeoutMs: Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : undefined,
  vaultClient: vaultApiClient,
});

function getNativeHistoryButton(type) {
  const button = document.querySelector(`[data-testid="button-${type}"]`);
  return button instanceof HTMLButtonElement ? button : null;
}

function getNativeHistoryState() {
  const undoButton = getNativeHistoryButton('undo');
  const redoButton = getNativeHistoryButton('redo');

  return {
    canRedo: Boolean(redoButton) && !redoButton.disabled,
    canUndo: Boolean(undoButton) && !undoButton.disabled,
    head: null,
    length: null,
  };
}

function triggerNativeHistory(type) {
  const button = getNativeHistoryButton(type);
  if (!button || button.disabled) {
    return false;
  }

  button.click();
  return true;
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
    getElementBounds: (elementId) => {
      const element = excalidrawAPI?.getSceneElementsIncludingDeleted?.()?.find((entry) => entry.id === elementId && !entry.isDeleted);
      if (!element) {
        return null;
      }

      return {
        centerX: element.x + (element.width / 2),
        centerY: element.y + (element.height / 2),
        height: element.height,
        width: element.width,
        x: element.x,
        y: element.y,
      };
    },
    getElementCount: () => (
      excalidrawAPI?.getSceneElementsIncludingDeleted?.()?.filter((element) => !element.isDeleted).length ?? 0
    ),
    getElementIds: () => (
      excalidrawAPI?.getSceneElementsIncludingDeleted?.()
        ?.filter((element) => !element.isDeleted)
        .map((element) => element.id)
        .sort() ?? []
    ),
    getHistoryState: () => getNativeHistoryState(),
    getLocalUserName: () => localAwarenessUser?.name || '',
    getLocalPeerId: () => localAwarenessUser?.peerId || '',
    getViewport: () => {
      const appState = excalidrawAPI?.getAppState?.();
      return appState ? {
        scrollX: appState.scrollX,
        scrollY: appState.scrollY,
        zoom: appState.zoom?.value ?? null,
      } : null;
    },
    isViewMode: () => Boolean(excalidrawAPI?.getAppState?.().viewModeEnabled),
    getSceneJson: () => roomClient.getLastSceneJson(),
    isAuthoritativeReady: () => (
      Boolean(excalidrawAPI)
      && collabReady
      && roomClient.canWriteToRoom === true
      && roomClient.waitingForAuthoritativeSync === false
      && roomClient.isApplyingSharedSnapshot() === false
    ),
    isReady: () => collabReady && Boolean(excalidrawAPI) && Boolean(getNativeHistoryButton('undo')) && Boolean(getNativeHistoryButton('redo')),
    redoShared: () => triggerNativeHistory('redo'),
    setScene: (scene) => {
      applyLocalScene(normalizeScene(scene), {
        captureUpdate: CaptureUpdateAction.IMMEDIATELY,
      });
    },
    setViewport: (viewport) => {
      if (!excalidrawAPI) {
        return;
      }

      const currentAppState = excalidrawAPI.getAppState();
      excalidrawAPI.updateScene({
        appState: {
          scrollX: Number.isFinite(viewport?.scrollX) ? viewport.scrollX : currentAppState.scrollX,
          scrollY: Number.isFinite(viewport?.scrollY) ? viewport.scrollY : currentAppState.scrollY,
          zoom: Number.isFinite(viewport?.zoom) && viewport.zoom > 0
            ? { value: viewport.zoom }
            : currentAppState.zoom,
        },
        captureUpdate: CaptureUpdateAction.NEVER,
      });
    },
    undoShared: () => triggerNativeHistory('undo'),
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

function queueCollaboratorsRender(collaborators) {
  queuedCollaborators = collaborators;
  if (collaboratorRenderFrame) {
    return;
  }

  collaboratorRenderFrame = requestAnimationFrame(() => {
    collaboratorRenderFrame = 0;
    const nextCollaborators = queuedCollaborators;
    queuedCollaborators = null;
    applyCollaborators(nextCollaborators);
  });
}

function applySceneFromJson(rawJson) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (normalizedJson === appliedSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  appliedSceneJson = normalizedJson;

  if (!excalidrawAPI || !collabReady) {
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

function buildApiSceneUpdate(scene) {
  const currentAppState = excalidrawAPI.getAppState();
  const currentElements = excalidrawAPI.getSceneElementsIncludingDeleted?.() || excalidrawAPI.getSceneElements();
  const restoredElements = restoreElements(scene?.elements || [], currentElements, {
    repairBindings: true,
  });
  const restoredAppState = restoreAppState(scene?.appState || {}, currentAppState);
  const reconciledElements = reconcileElements(currentElements, restoredElements, currentAppState);

  return {
    appState: {
      theme: currentTheme,
      viewBackgroundColor: restoredAppState.viewBackgroundColor ?? '#ffffff',
      gridSize: restoredAppState.gridSize ?? null,
    },
    elements: reconciledElements,
    files: scene?.files || {},
  };
}

function updateApiScene(scene, {
  captureUpdate = CaptureUpdateAction.NEVER,
  trackedSharedSnapshot = true,
} = {}) {
  const nextSceneUpdate = buildApiSceneUpdate(scene);

  suppressOnChange = true;
  if (trackedSharedSnapshot) {
    roomClient.beginApplyingSharedSnapshot();
  }
  try {
    excalidrawAPI.updateScene({
      ...nextSceneUpdate,
      captureUpdate,
    });
  } finally {
    releaseOnChangeSuppressionAfterPaint({ trackedSharedSnapshot });
  }

  scheduleInitialViewportFit();
}

function applyLocalScene(scene, {
  captureUpdate = CaptureUpdateAction.IMMEDIATELY,
} = {}) {
  const normalizedScene = normalizeScene(scene);
  const normalizedJson = JSON.stringify(normalizedScene);

  appliedSceneJson = normalizedJson;

  if (!excalidrawAPI || !collabReady) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  excalidrawAPI.updateScene({
    ...buildApiSceneUpdate(normalizedScene),
    captureUpdate,
  });

  if (suppressOnChange) {
    roomClient.commitSceneJson(normalizedJson, {
      origin: 'excalidraw-local-scene-apply',
    });
  }
}

function onRoomTextUpdate() {
  applySceneFromJson(roomClient.getLastSceneJson());
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function getSceneElementsForPreviewFit() {
  return (
    excalidrawAPI?.getSceneElementsIncludingDeleted?.()
      ?.filter((element) => !element.isDeleted) ?? []
  );
}

function scheduleInitialViewportFit() {
  if (!initialViewportFitPending || !excalidrawAPI) {
    return;
  }

  const elements = getSceneElementsForPreviewFit();
  if (elements.length === 0) {
    return;
  }
  initialViewportFitPending = false;

  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (!excalidrawAPI) {
        return;
      }

      excalidrawAPI.scrollToContent(elements, {
        animate: false,
        fitToViewport: true,
        maxZoom: 2,
        viewportZoomFactor: isPreviewMode ? 0.92 : 0.88,
      });
    });
  });
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
  if (collaboratorRenderFrame) {
    cancelAnimationFrame(collaboratorRenderFrame);
  }
  collaboratorRenderFrame = 0;
  queuedCollaborators = null;
  apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
  apiStateCleanupCallbacks = [];
  roomClient.disconnect();
}

let didDisconnectRealtimeRoom = false;

function disconnectRealtimeRoomOnce() {
  if (didDisconnectRealtimeRoom) {
    return;
  }

  didDisconnectRealtimeRoom = true;
  disconnectRealtimeRoom();
}

async function waitForPendingRoomWrites({
  intervalMs = 10,
  maxWaitMs = 150,
} = {}) {
  const startedAt = performance.now();

  while ((performance.now() - startedAt) < maxWaitMs) {
    const ws = roomClient.provider?.ws;
    if (!ws || ws.readyState !== WebSocket.OPEN || ws.bufferedAmount === 0) {
      return;
    }

    await new Promise((resolve) => window.setTimeout(resolve, intervalMs));
  }
}

async function prepareRealtimeRoomDisconnect() {
  roomClient.flushSceneSync();
  await waitForPendingRoomWrites();
}

window.addEventListener('pagehide', disconnectRealtimeRoomOnce);

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
    return;
  }

  if (message.type === 'prepare-disconnect') {
    void (async () => {
      await prepareRealtimeRoomDisconnect();
      postToParent('disconnect-ready', {
        requestId: message.requestId || '',
      });
    })();
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || suppressOnChange) {
    return;
  }

  appliedSceneJson = JSON.stringify(normalizeScene({
    elements,
    appState,
    files,
  }));
  roomClient.scheduleSceneSync(elements, appState, files);
}

function initializeEditor(api) {
  excalidrawAPI = api;
  apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
  apiStateCleanupCallbacks = [];

  apiStateCleanupCallbacks.push(api.onStateChange(['scrollX', 'scrollY', 'zoom'], () => {
    syncLocalViewportToRoom();
  }));
  apiStateCleanupCallbacks.push(api.onStateChange('userToFollow', (userToFollow) => {
    if (userToFollow?.socketId) {
      setFollowedSocket(userToFollow.socketId, { force: true });
      return;
    }

    setFollowedSocket(null, { force: true });
  }));

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

  collabReady = true;
  syncLocalViewportToRoom();
  onRoomTextUpdate();
  if (pendingHostFollowPeerId) {
    applyHostFollowRequest(pendingHostFollowPeerId);
  }

  scheduleInitialViewportFit();
  postToParent('ready');
}

function handleEditorMount({ excalidrawAPI: api }) {
  excalidrawAPI = api;
}

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    await ensureClientAuthenticated();
    const initialScene = await roomClient.connect({ initialUser: localAwarenessUser });
    const initialData = sceneToInitialData(initialScene, { theme: currentTheme });

    loadingElement?.remove();

    const excalidrawProps = {
      onMount: handleEditorMount,
      onInitialize: (api) => {
        initializeEditor(api);
      },
      onUnmount: () => {
        apiStateCleanupCallbacks.forEach((cleanup) => cleanup());
        apiStateCleanupCallbacks = [];
        excalidrawAPI = null;
        collabReady = false;
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
      theme: currentTheme,
      viewModeEnabled: isPreviewMode,
      zenModeEnabled: isPreviewMode,
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
