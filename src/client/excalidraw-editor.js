import React from 'react';
import { createRoot } from 'react-dom/client';
import { Excalidraw } from '@excalidraw/excalidraw';
import '@excalidraw/excalidraw/index.css';
import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { ensureClientAuthenticated } from './infrastructure/auth-client.js';

const params = new URLSearchParams(window.location.search);
const filePath = params.get('file');
const isTestMode = params.get('test') === '1';
const parentOrigin = window.location.origin;

const ROOM_TEXT_KEY = 'codemirror';
const SAVE_THROTTLE_MS = 48;
const SYNC_TIMEOUT_MS = 4000;
const syncTimeoutMs = Number.parseInt(params.get('syncTimeoutMs') || '', 10);
const USER_COLOR_PALETTE = [
  '#ef4444', '#f97316', '#eab308', '#22c55e', '#06b6d4',
  '#3b82f6', '#8b5cf6', '#ec4899', '#14b8a6', '#f59e0b',
  '#6366f1', '#10b981', '#f43f5e', '#0ea5e9', '#a855f7',
];

let excalidrawAPI = null;
let sceneSyncTimer = null;
let lastSceneSyncAt = 0;
let pendingSceneSyncPayload = null;
let currentTheme = params.get('theme') || 'dark';

let ydoc = null;
let ytext = null;
let provider = null;
let awareness = null;
let localAwarenessUser = null;
let handleProviderSync = null;

let collabReady = false;
let canWriteToRoom = false;
let waitingForAuthoritativeSync = false;
let suppressOnChange = false;
let lastSceneJson = '';
let pendingRemoteSceneJson = '';
let pendingCollaborators = null;
let pointerAwarenessFrame = 0;
let pendingPointerPayload = null;
let lastSelectedIdsSignature = '';
let suppressOnChangeReleaseToken = 0;

function trimTrailingSlash(value) {
  return value.endsWith('/') ? value.slice(0, -1) : value;
}

function normalizeUserName(value) {
  const normalized = String(value || '').trim().replace(/\s+/g, ' ');
  return normalized ? normalized.slice(0, 24) : null;
}

function hashString(value) {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(index);
    hash |= 0;
  }

  return Math.abs(hash);
}

function generatePeerId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto?.getRandomValues?.(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

function pickFallbackColor(seed) {
  return USER_COLOR_PALETTE[hashString(seed) % USER_COLOR_PALETTE.length];
}

function ensureColorLight(color, colorLight) {
  if (colorLight && /^#[0-9a-fA-F]{8}$/.test(colorLight)) {
    return colorLight;
  }

  if (/^#[0-9a-fA-F]{6}$/.test(color)) {
    return `${color}33`;
  }

  return '#0ea5e933';
}

function resolveLocalAwarenessUser() {
  const name = normalizeUserName(params.get('userName'))
    || normalizeUserName(localStorage.getItem('collabmd-user-name'))
    || 'User';
  const peerId = params.get('userPeerId') || generatePeerId();
  const color = params.get('userColor') || pickFallbackColor(`${name}-${peerId}`);
  const colorLight = ensureColorLight(color, params.get('userColorLight'));

  return {
    color,
    colorLight,
    name,
    peerId,
  };
}

function applyLocalUserPatch(nextUser = {}) {
  const patchedName = normalizeUserName(nextUser.name) || localAwarenessUser?.name || 'User';
  const patchedPeerId = nextUser.peerId || localAwarenessUser?.peerId || generatePeerId();
  const patchedColor = nextUser.color || localAwarenessUser?.color || pickFallbackColor(`${patchedName}-${patchedPeerId}`);
  const patchedColorLight = ensureColorLight(
    patchedColor,
    nextUser.colorLight || localAwarenessUser?.colorLight,
  );

  localAwarenessUser = {
    color: patchedColor,
    colorLight: patchedColorLight,
    name: patchedName,
    peerId: patchedPeerId,
  };

  if (awareness) {
    awareness.setLocalStateField('user', localAwarenessUser);
  }

  updateCollaboratorsFromAwareness();
}

function getRuntimeConfig() {
  return {
    publicWsBaseUrl: '',
    wsBasePath: '/ws',
    ...(window.__COLLABMD_CONFIG__ || {}),
  };
}

function resolveWsBaseUrl() {
  const customServerUrl = params.get('server');
  if (customServerUrl) {
    return trimTrailingSlash(customServerUrl);
  }

  const config = getRuntimeConfig();
  if (config.publicWsBaseUrl) {
    return trimTrailingSlash(config.publicWsBaseUrl);
  }

  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
  return `${protocol}//${window.location.host}${config.wsBasePath}`;
}

function createEmptyScene() {
  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    elements: [],
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    files: {},
  };
}

function normalizeScene(raw) {
  if (!raw || typeof raw !== 'object') {
    return createEmptyScene();
  }

  return {
    type: 'excalidraw',
    version: 2,
    source: 'collabmd',
    elements: Array.isArray(raw.elements) ? raw.elements : [],
    appState: {
      gridSize: raw.appState?.gridSize ?? null,
      viewBackgroundColor: raw.appState?.viewBackgroundColor ?? '#ffffff',
    },
    files: raw.files && typeof raw.files === 'object' ? raw.files : {},
  };
}

function parseSceneJson(rawJson) {
  if (!rawJson) {
    return createEmptyScene();
  }

  try {
    return normalizeScene(JSON.parse(rawJson));
  } catch {
    return createEmptyScene();
  }
}

function sceneToInitialData(parsedScene) {
  return {
    elements: parsedScene.elements || [],
    appState: {
      theme: currentTheme,
      viewBackgroundColor: parsedScene.appState?.viewBackgroundColor ?? '#ffffff',
      gridSize: parsedScene.appState?.gridSize ?? null,
    },
    files: parsedScene.files || {},
  };
}

if (isTestMode) {
  window.__COLLABMD_EXCALIDRAW_TEST__ = {
    getLocalUserName: () => localAwarenessUser?.name || '',
    getSceneJson: () => lastSceneJson,
    isReady: () => collabReady && Boolean(excalidrawAPI),
    setScene: (scene) => {
      const json = JSON.stringify(normalizeScene(scene));
      applySceneFromJson(json);
      replaceRoomContent(json, 'excalidraw-test');
    },
  };
}

function buildStoredScene(elements, appState, files) {
  return normalizeScene({
    elements: elements.filter((element) => !element.isDeleted),
    appState: {
      gridSize: appState.gridSize ?? null,
      viewBackgroundColor: appState.viewBackgroundColor ?? '#ffffff',
    },
    files: files || {},
  });
}

function buildCollaboratorsMap() {
  const collaborators = new Map();
  if (!awareness) {
    return collaborators;
  }

  awareness.getStates().forEach((state, clientId) => {
    const user = state?.user;
    if (!user) {
      return;
    }

    const pointer = state.pointer && Number.isFinite(state.pointer.x) && Number.isFinite(state.pointer.y)
      ? {
        x: state.pointer.x,
        y: state.pointer.y,
        tool: state.pointer.tool === 'laser' ? 'laser' : 'pointer',
      }
      : undefined;

    collaborators.set(String(clientId), {
      button: state.pointerButton === 'down' ? 'down' : 'up',
      color: {
        background: ensureColorLight(user.color || '#0ea5e9', user.colorLight),
        stroke: user.color || '#0ea5e9',
      },
      id: user.peerId || String(clientId),
      isCurrentUser: clientId === awareness.clientID,
      pointer,
      selectedElementIds: state.selectedElementIds || undefined,
      socketId: String(clientId),
      username: user.name || 'User',
    });
  });

  return collaborators;
}

function applyCollaborators(collaborators) {
  if (!excalidrawAPI) {
    pendingCollaborators = collaborators;
    return;
  }

  excalidrawAPI.updateScene({ collaborators });
}

function updateCollaboratorsFromAwareness() {
  if (!collabReady) {
    return;
  }

  applyCollaborators(buildCollaboratorsMap());
}

function flushPointerAwarenessPayload() {
  pointerAwarenessFrame = 0;

  if (!awareness || !pendingPointerPayload) {
    return;
  }

  awareness.setLocalStateField('pointer', pendingPointerPayload.pointer);
  awareness.setLocalStateField('pointerButton', pendingPointerPayload.button);
  pendingPointerPayload = null;
}

function scheduleLocalPointerAwareness(payload) {
  if (!awareness || !payload?.pointer) {
    return;
  }

  pendingPointerPayload = {
    button: payload.button === 'down' ? 'down' : 'up',
    pointer: {
      x: payload.pointer.x,
      y: payload.pointer.y,
      tool: payload.pointer.tool === 'laser' ? 'laser' : 'pointer',
    },
  };

  if (pointerAwarenessFrame) {
    return;
  }

  pointerAwarenessFrame = requestAnimationFrame(flushPointerAwarenessPayload);
}

function syncLocalSelectionAwareness(appState) {
  if (!awareness) {
    return;
  }

  const selected = appState?.selectedElementIds || {};
  const signature = Object.keys(selected).sort().join(',');
  if (signature === lastSelectedIdsSignature) {
    return;
  }

  lastSelectedIdsSignature = signature;
  awareness.setLocalStateField('selectedElementIds', selected);
}

function unlockRoomWrites() {
  waitingForAuthoritativeSync = false;
  canWriteToRoom = true;

  if (pendingSceneSyncPayload) {
    scheduleSceneSyncFlush();
  }
}

function replaceRoomContent(nextJson, origin = 'excalidraw-room-write') {
  if (!ydoc || !ytext) {
    return;
  }

  ydoc.transact(() => {
    if (ytext.length > 0) {
      ytext.delete(0, ytext.length);
    }
    if (nextJson) {
      ytext.insert(0, nextJson);
    }
  }, origin);
}

async function loadSceneFromApi({ createIfMissing = true } = {}) {
  if (!filePath) {
    return createEmptyScene();
  }

  const readResponse = await fetch(`/api/file?path=${encodeURIComponent(filePath)}`);
  if (readResponse.ok) {
    const data = await readResponse.json();
    return parseSceneJson(data.content);
  }

  if (readResponse.status === 404 && createIfMissing) {
    const emptyScene = createEmptyScene();
    const createResponse = await fetch('/api/file', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path: filePath, content: JSON.stringify(emptyScene) }),
    });

    if (createResponse.ok || createResponse.status === 409) {
      return emptyScene;
    }

    const createError = await createResponse.json().catch(() => ({}));
    throw new Error(createError.error || 'Failed to create Excalidraw file');
  }

  const readError = await readResponse.json().catch(() => ({}));
  if (readResponse.status === 404) {
    throw new Error(readError.error || 'Excalidraw file not found');
  }

  throw new Error(readError.error || 'Failed to load Excalidraw file');
}

function applySceneFromJson(rawJson) {
  const scene = parseSceneJson(rawJson);
  const normalizedJson = JSON.stringify(scene);
  if (normalizedJson === lastSceneJson && !pendingRemoteSceneJson) {
    return;
  }

  clearTimeout(sceneSyncTimer);
  sceneSyncTimer = null;
  pendingSceneSyncPayload = null;
  lastSceneJson = normalizedJson;

  if (!excalidrawAPI) {
    pendingRemoteSceneJson = normalizedJson;
    return;
  }

  updateApiScene(scene);
}

function releaseOnChangeSuppressionAfterPaint() {
  const releaseToken = ++suppressOnChangeReleaseToken;
  requestAnimationFrame(() => {
    requestAnimationFrame(() => {
      if (releaseToken !== suppressOnChangeReleaseToken) {
        return;
      }

      suppressOnChange = false;
    });
  });
}

function updateApiScene(scene) {
  suppressOnChange = true;
  try {
    excalidrawAPI.updateScene({
      elements: scene.elements,
      appState: {
        theme: currentTheme,
        viewBackgroundColor: scene.appState.viewBackgroundColor ?? '#ffffff',
        gridSize: scene.appState.gridSize ?? null,
      },
      files: scene.files || {},
    });
  } finally {
    releaseOnChangeSuppressionAfterPaint();
  }
}

function onRoomTextUpdate() {
  if (!ytext) {
    return;
  }

  const remoteJson = ytext.toString();
  if (!remoteJson || remoteJson === lastSceneJson) {
    return;
  }

  unlockRoomWrites();
  applySceneFromJson(remoteJson);
}

function waitForSync(providerInstance, timeoutMs = SYNC_TIMEOUT_MS) {
  if (providerInstance.synced) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let settled = false;

    const handleSync = (isSynced) => {
      if (!isSynced || settled) {
        return;
      }

      settled = true;
      clearTimeout(timer);
      providerInstance.off('sync', handleSync);
      resolve(true);
    };

    const timer = window.setTimeout(() => {
      if (settled) {
        return;
      }

      settled = true;
      providerInstance.off('sync', handleSync);
      resolve(false);
    }, timeoutMs);

    providerInstance.on('sync', handleSync);
  });
}

async function connectRealtimeRoom() {
  if (!filePath) {
    const scene = createEmptyScene();
    lastSceneJson = JSON.stringify(scene);
    return scene;
  }

  ydoc = new Doc();
  ytext = ydoc.getText(ROOM_TEXT_KEY);
  provider = new WebsocketProvider(resolveWsBaseUrl(), filePath, ydoc, {
    disableBc: true,
    maxBackoffTime: 5000,
  });

  awareness = provider.awareness;
  localAwarenessUser = resolveLocalAwarenessUser();
  awareness.setLocalStateField('user', localAwarenessUser);
  awareness.setLocalStateField('pointerButton', 'up');
  awareness.setLocalStateField('selectedElementIds', {});
  awareness.on('change', updateCollaboratorsFromAwareness);
  handleProviderSync = (isSynced) => {
    if (!isSynced) {
      return;
    }

    unlockRoomWrites();
    onRoomTextUpdate();
  };
  provider.on('sync', handleProviderSync);

  const didInitialSyncFinish = await waitForSync(
    provider,
    Number.isFinite(syncTimeoutMs) ? syncTimeoutMs : SYNC_TIMEOUT_MS,
  );

  let initialJson = ytext.toString();
  let usedApiFallback = false;
  if (!initialJson) {
    const sceneFromApi = await loadSceneFromApi();
    const syncedJson = ytext.toString();
    if (syncedJson) {
      initialJson = syncedJson;
    } else {
      initialJson = JSON.stringify(sceneFromApi);
      usedApiFallback = true;
    }
  }

  if (!initialJson) {
    initialJson = JSON.stringify(createEmptyScene());
  }

  waitingForAuthoritativeSync = usedApiFallback && !didInitialSyncFinish;
  canWriteToRoom = !waitingForAuthoritativeSync;
  lastSceneJson = JSON.stringify(parseSceneJson(initialJson));
  ytext.observe(onRoomTextUpdate);
  onRoomTextUpdate();

  return parseSceneJson(lastSceneJson);
}

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: 'excalidraw-editor', type, ...payload }, parentOrigin);
}

function disconnectRealtimeRoom() {
  flushSceneSync();
  clearTimeout(sceneSyncTimer);
  sceneSyncTimer = null;
  pendingSceneSyncPayload = null;
  collabReady = false;

  if (pointerAwarenessFrame) {
    cancelAnimationFrame(pointerAwarenessFrame);
  }
  pointerAwarenessFrame = 0;
  pendingPointerPayload = null;
  pendingCollaborators = null;
  lastSelectedIdsSignature = '';

  if (ytext) {
    ytext.unobserve(onRoomTextUpdate);
  }

  if (awareness) {
    awareness.off('change', updateCollaboratorsFromAwareness);
    awareness.setLocalState(null);
  }
  awareness = null;

  if (provider && handleProviderSync) {
    provider.off('sync', handleProviderSync);
  }
  handleProviderSync = null;
  provider?.disconnect();
  provider?.destroy();
  provider = null;

  ydoc?.destroy();
  ydoc = null;
  ytext = null;
  localAwarenessUser = null;
  canWriteToRoom = false;
  waitingForAuthoritativeSync = false;
}

window.addEventListener('beforeunload', () => {
  disconnectRealtimeRoom();
});

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
      excalidrawAPI.updateScene({ appState: { theme: currentTheme } });
      releaseOnChangeSuppressionAfterPaint();
    }
    return;
  }

  if (message.type === 'set-user') {
    applyLocalUserPatch(message.user);
  }
});

function scheduleSyncToRoom(elements, appState, files) {
  if (!collabReady || suppressOnChange) {
    return;
  }

  pendingSceneSyncPayload = { appState, elements, files };
  if (!canWriteToRoom) {
    return;
  }

  scheduleSceneSyncFlush();
}

function scheduleSceneSyncFlush() {
  if (sceneSyncTimer !== null) {
    return;
  }

  const elapsed = Date.now() - lastSceneSyncAt;
  const delay = Math.max(0, SAVE_THROTTLE_MS - elapsed);
  sceneSyncTimer = window.setTimeout(() => {
    sceneSyncTimer = null;
    flushSceneSync();
  }, delay);
}

function flushSceneSync() {
  if (!collabReady || !ytext || !pendingSceneSyncPayload) {
    return;
  }

  const { elements, appState, files } = pendingSceneSyncPayload;
  pendingSceneSyncPayload = null;

  const sceneData = buildStoredScene(elements, appState, files);
  const json = JSON.stringify(sceneData);

  if (json !== lastSceneJson) {
    lastSceneJson = json;
    lastSceneSyncAt = Date.now();
    replaceRoomContent(json, 'excalidraw-local-change');
  }

  if (pendingSceneSyncPayload) {
    scheduleSceneSyncFlush();
  }
}

async function init() {
  const loadingElement = document.getElementById('loadingState');

  try {
    await ensureClientAuthenticated();
    const initialScene = await connectRealtimeRoom();
    const initialData = sceneToInitialData(initialScene);

    loadingElement?.remove();

    const excalidrawProps = {
      excalidrawAPI: (api) => {
        excalidrawAPI = api;

        const sceneJson = pendingRemoteSceneJson || lastSceneJson;
        pendingRemoteSceneJson = '';
        updateApiScene(parseSceneJson(sceneJson));

        if (pendingCollaborators) {
          excalidrawAPI.updateScene({ collaborators: pendingCollaborators });
          pendingCollaborators = null;
        }
        collabReady = true;
        updateCollaboratorsFromAwareness();

        postToParent('ready');
      },
      initialData,
      aiEnabled: false,
      isCollaborating: true,
      onChange: (elements, appState, files) => {
        scheduleSyncToRoom(elements, appState, files);
        syncLocalSelectionAwareness(appState);
      },
      onPointerUpdate: (payload) => {
        scheduleLocalPointerAwareness(payload);
      },
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
