import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';
import {
  EXCALIDRAW_APP_STATE_KEY,
  EXCALIDRAW_ELEMENTS_KEY,
  EXCALIDRAW_FILES_KEY,
  EXCALIDRAW_META_KEY,
  applySceneDiffToExcalidrawRoom,
  buildExcalidrawRoomScene,
  ensureExcalidrawRoomSchema,
  isExcalidrawRoomDocStructured,
  readExcalidrawReplaceGeneration,
  readLegacyExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
} from '../../domain/excalidraw-room-codec.js';
import {
  MSG_AGENT_FLUSH,
  MSG_AGENT_FLUSH_ACK,
} from '../../domain/collaboration-protocol.js';

import {
  buildCollaboratorsMap,
  mergeAwarenessUserPatch,
  normalizeCollaboratorViewport,
} from '../domain/excalidraw-collaboration.js';
import {
  buildLiveCollaborationScene,
  createEmptyScene,
  parseSceneJson,
  tryParseSceneJson,
} from '../domain/excalidraw-scene.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';
import {
  normalizeCommentQuote,
} from '../../domain/comment-threads.js';
import { CommentThreadStore } from './comment-thread-store.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

const DEFAULT_EMPTY_SCENE_GUARD_MS = 250;
const DEFAULT_SAVE_THROTTLE_MS = 48;
const DEFAULT_SYNC_TIMEOUT_MS = 4000;
const DEFAULT_AGENT_FLUSH_TIMEOUT_MS = 1000;

export const EXCALIDRAW_ROOM_CONNECTION_STATE = Object.freeze({
  AUTHORITATIVE: 'authoritative',
  CLOSED: 'closed',
  CONNECTING: 'connecting',
  DISCONNECTING: 'disconnecting',
  FALLBACK_READONLY: 'fallback-readonly',
  RECONNECTING_READONLY: 'reconnecting-readonly',
});

function areExcalidrawFilesEqual(left, right) {
  if (left === right) {
    return true;
  }

  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') {
    return false;
  }

  return left.id === right.id
    && left.mimeType === right.mimeType
    && left.dataURL === right.dataURL
    && left.created === right.created
    && left.lastRetrieved === right.lastRetrieved
    && left.version === right.version;
}

function normalizeElementVersion(value) {
  const version = Number(value);
  return Number.isFinite(version) ? version : 0;
}

function normalizeElementVersionNonce(value) {
  const versionNonce = Number(value);
  return Number.isFinite(versionNonce) ? versionNonce : 0;
}

function shouldSyncElementToRoom(localElement, roomElement) {
  if (!localElement?.id) {
    return false;
  }

  if (!roomElement) {
    return true;
  }

  const localVersion = normalizeElementVersion(localElement.version);
  const roomVersion = normalizeElementVersion(roomElement.version);
  if (localVersion !== roomVersion) {
    return localVersion > roomVersion;
  }

  const localVersionNonce = normalizeElementVersionNonce(localElement.versionNonce);
  const roomVersionNonce = normalizeElementVersionNonce(roomElement.versionNonce);
  return localVersionNonce < roomVersionNonce;
}

function createDiagramCommentAnchor(element) {
  const elementId = typeof element?.id === 'string' ? element.id.trim() : '';
  const x = Number(element?.x);
  const y = Number(element?.y);
  const width = Number(element?.width);
  const height = Number(element?.height);
  if (!elementId || ![x, y, width, height].every(Number.isFinite)) {
    return null;
  }

  return {
    anchorKind: 'diagram-element',
    anchorPoint: {
      x: x + (width / 2),
      y: y + (height / 2),
    },
    anchorQuote: normalizeCommentQuote(element.text),
    anchorSnapshot: {
      height,
      text: normalizeCommentQuote(element.text),
      type: typeof element.type === 'string' ? element.type : 'element',
      width,
      x,
      y,
    },
    elementId,
  };
}

export class ExcalidrawRoomClient {
  constructor({
    cancelAnimationFrameFn = (frameId) => cancelAnimationFrame(frameId),
    clearTimeoutFn = (timeoutId) => clearTimeout(timeoutId),
    emptySceneGuardMs = DEFAULT_EMPTY_SCENE_GUARD_MS,
    filePath = '',
    now = () => Date.now(),
    onCollaboratorsChange = () => {},
    onCommentThreadsChange = () => {},
    onConnectionStateChange = () => {},
    onRemoteSceneJson = () => {},
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    resolveWsBaseUrlFn = resolveWsBaseUrl,
    saveThrottleMs = DEFAULT_SAVE_THROTTLE_MS,
    setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    vaultClient,
    websocketProviderFactory = (wsUrl, path, ydoc, options) => new WebsocketProvider(wsUrl, path, ydoc, options),
    ydocFactory = () => new Doc(),
  }) {
    this.cancelAnimationFrameFn = cancelAnimationFrameFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.emptySceneGuardMs = emptySceneGuardMs;
    this.filePath = filePath;
    this.now = now;
    this.onCollaboratorsChange = onCollaboratorsChange;
    this.onCommentThreadsChange = onCommentThreadsChange;
    this.onConnectionStateChange = onConnectionStateChange;
    this.onRemoteSceneJson = onRemoteSceneJson;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.resolveWsBaseUrlFn = resolveWsBaseUrlFn;
    this.saveThrottleMs = saveThrottleMs;
    this.setTimeoutFn = setTimeoutFn;
    this.syncTimeoutMs = syncTimeoutMs;
    this.vaultClient = vaultClient;
    this.websocketProviderFactory = websocketProviderFactory;
    this.ydocFactory = ydocFactory;
    this.ydoc = null;
    this.roomMeta = null;
    this.roomElements = null;
    this.roomFiles = null;
    this.roomAppState = null;
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.handleProviderSync = null;
    this.handleProviderStatus = null;
    this.lastSceneJson = '';
    this.lastReplaceGeneration = null;
    this.sceneSyncTimer = null;
    this.sceneSyncDueAt = 0;
    this.lastSceneSyncAt = 0;
    this.pendingSceneSyncPayload = null;
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    this.viewportAwarenessFrame = 0;
    this.pendingViewportPayload = null;
    this.lastViewportSignature = '';
    this.lastSelectedIdsSignature = '';
    this.pendingEmptySceneCandidate = null;
    this.agentFlushRequestCounter = 0;
    this.pendingAgentFlushRequests = new Map();
    this.structuredObserversAttached = false;
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;
    this.connectionState = EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED;
    this.hasAuthoritativeSync = false;
    this.applyingSharedSnapshotDepth = 0;
    this.suppressStructuredSceneUpdateDepth = 0;
    this.commentThreadStore = new CommentThreadStore({
      canWrite: () => this.canWriteToRoom,
      createAnchor: createDiagramCommentAnchor,
      getDoc: () => this.ydoc,
      getEditorState: () => null,
      getLocalUser: () => this.getLocalUser(),
      onCommentsChange: (threads) => this.onCommentThreadsChange(threads),
      resolveThread: (thread) => thread,
    });

    this.handleAwarenessChange = () => {
      this.onCollaboratorsChange(buildCollaboratorsMap(this.awareness));
    };

    this.handleStructuredSceneUpdate = () => {
      if (!this.ydoc) {
        return;
      }

      if (this.suppressStructuredSceneUpdateDepth > 0) {
        return;
      }

      const prevReplaceGeneration = this.lastReplaceGeneration;
      this.lastReplaceGeneration = readExcalidrawReplaceGeneration(this.ydoc);
      const authoritative = prevReplaceGeneration !== null
        && this.lastReplaceGeneration > prevReplaceGeneration;

      const remoteJson = this.getStructuredSceneJson();
      if (!remoteJson || remoteJson === this.lastSceneJson) {
        return;
      }

      this.pendingEmptySceneCandidate = null;
      this.lastSceneJson = JSON.stringify(parseSceneJson(remoteJson));
      this.onRemoteSceneJson(this.lastSceneJson, { authoritative });
    };
  }

  getLastSceneJson() {
    return this.lastSceneJson;
  }

  getLocalUser() {
    return this.localUser;
  }

  getCommentThreads() {
    return this.commentThreadStore.getCommentThreads();
  }

  createCommentThread({ body, element } = {}) {
    return this.commentThreadStore.createCommentThread({
      anchor: element,
      body,
    });
  }

  replyToCommentThread(threadId, body) {
    return this.commentThreadStore.replyToCommentThread(threadId, body);
  }

  deleteCommentThread(threadId) {
    return this.commentThreadStore.deleteCommentThread(threadId);
  }

  getConnectionState() {
    return this.connectionState;
  }

  installAgentFlushHandler() {
    const messageHandlers = this.provider?.messageHandlers;
    if (!messageHandlers || typeof messageHandlers !== 'object') {
      return false;
    }

    messageHandlers[MSG_AGENT_FLUSH_ACK] = (_encoder, decoder) => {
      let requestId;
      try {
        requestId = decoding.readVarString(decoder);
      } catch {
        return;
      }

      const request = this.pendingAgentFlushRequests.get(requestId);
      if (!request) {
        return;
      }

      request.resolve({ status: 'acknowledged' });
    };
    return true;
  }

  settleAgentFlushRequests(status) {
    const requests = [...this.pendingAgentFlushRequests.values()];
    requests.forEach((request) => request.resolve({ status }));
  }

  waitForServerFlush({ timeoutMs = DEFAULT_AGENT_FLUSH_TIMEOUT_MS } = {}) {
    const ws = this.provider?.ws;
    const openState = ws?.OPEN ?? globalThis.WebSocket?.OPEN ?? 1;
    if (
      !this.canWriteToRoom
      || !ws
      || ws.readyState !== openState
      || !this.provider?.messageHandlers?.[MSG_AGENT_FLUSH_ACK]
    ) {
      return Promise.resolve({ status: 'unavailable' });
    }

    const requestId = `agent-flush-${this.ydoc?.clientID ?? 'client'}-${++this.agentFlushRequestCounter}`;
    return new Promise((resolve) => {
      const finish = (result) => {
        const request = this.pendingAgentFlushRequests.get(requestId);
        if (!request) {
          return;
        }
        this.clearTimeoutFn(request.timeoutId);
        this.pendingAgentFlushRequests.delete(requestId);
        resolve(result);
      };
      this.pendingAgentFlushRequests.set(requestId, {
        resolve: finish,
        timeoutId: this.setTimeoutFn(() => finish({ status: 'timeout' }), timeoutMs),
      });

      try {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_AGENT_FLUSH);
        encoding.writeVarString(encoder, requestId);
        ws.send(encoding.toUint8Array(encoder));
      } catch {
        finish({ status: 'unavailable' });
      }
    });
  }

  hasPendingWrites() {
    return Boolean(this.pendingSceneSyncPayload);
  }

  setConnectionState(nextState) {
    if (!Object.values(EXCALIDRAW_ROOM_CONNECTION_STATE).includes(nextState)) {
      throw new Error(`Unsupported Excalidraw room connection state: ${nextState}`);
    }

    const previousState = this.connectionState;
    this.connectionState = nextState;
    this.canWriteToRoom = nextState === EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE;
    this.waitingForAuthoritativeSync = (
      nextState === EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING
      || nextState === EXCALIDRAW_ROOM_CONNECTION_STATE.FALLBACK_READONLY
      || nextState === EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY
    );

    if (!this.canWriteToRoom && this.sceneSyncTimer !== null) {
      this.clearTimeoutFn(this.sceneSyncTimer);
      this.sceneSyncTimer = null;
      this.sceneSyncDueAt = 0;
    }

    if (previousState === nextState) {
      return;
    }

    this.onConnectionStateChange({
      canWrite: this.canWriteToRoom,
      hasPendingWrites: this.hasPendingWrites(),
      previousState,
      state: nextState,
    });
  }

  isApplyingSharedSnapshot() {
    return this.applyingSharedSnapshotDepth > 0;
  }

  beginApplyingSharedSnapshot() {
    this.applyingSharedSnapshotDepth += 1;
  }

  endApplyingSharedSnapshot() {
    this.applyingSharedSnapshotDepth = Math.max(0, this.applyingSharedSnapshotDepth - 1);
  }

  setLocalUser(nextUser = {}) {
    this.localUser = mergeAwarenessUserPatch({
      currentUser: this.localUser,
      nextUser,
    });

    if (this.awareness) {
      this.awareness.setLocalStateField('user', this.localUser);
    }

    this.handleAwarenessChange();
    return this.localUser;
  }

  async connect(options = {}) {
    try {
      return await this.connectInternal(options);
    } catch (error) {
      this.disconnect();
      throw error;
    }
  }

  async connectInternal({ initialUser = null } = {}) {
    this.localUser = initialUser;
    this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING);

    if (!this.filePath) {
      const scene = createEmptyScene();
      this.lastSceneJson = JSON.stringify(scene);
      this.hasAuthoritativeSync = true;
      this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE);
      this.onCommentThreadsChange([]);
      return scene;
    }

    this.ydoc = this.ydocFactory();
    this.roomMeta = this.ydoc.getMap(EXCALIDRAW_META_KEY);
    this.roomElements = this.ydoc.getMap(EXCALIDRAW_ELEMENTS_KEY);
    this.roomFiles = this.ydoc.getMap(EXCALIDRAW_FILES_KEY);
    this.roomAppState = this.ydoc.getMap(EXCALIDRAW_APP_STATE_KEY);
    this.provider = this.websocketProviderFactory(this.resolveWsBaseUrlFn(), this.filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });
    this.installAgentFlushHandler();
    stopReconnectOnControlledClose(this.provider);

    this.awareness = this.provider.awareness;
    if (this.localUser) {
      this.awareness.setLocalStateField('user', this.localUser);
    }
    this.awareness.setLocalStateField('pointerButton', 'up');
    this.awareness.setLocalStateField('selectedElementIds', {});
    this.awareness.on('change', this.handleAwarenessChange);

    this.handleProviderSync = (isSynced) => {
      if (!isSynced) {
        this.setConnectionState(
          this.hasAuthoritativeSync
            ? EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY
            : EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING,
        );
        return;
      }

      this.markAuthoritative();
      this.handleStructuredSceneUpdate();
    };
    this.provider.on('sync', this.handleProviderSync);
    this.handleProviderStatus = ({ status } = {}) => {
      if (status === 'connected') {
        if (this.hasAuthoritativeSync && !this.provider?.synced) {
          this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY);
        }
        return;
      }

      if (status === 'connecting' || status === 'disconnected') {
        this.setConnectionState(
          this.hasAuthoritativeSync
            ? EXCALIDRAW_ROOM_CONNECTION_STATE.RECONNECTING_READONLY
            : this.connectionState === EXCALIDRAW_ROOM_CONNECTION_STATE.FALLBACK_READONLY
              ? EXCALIDRAW_ROOM_CONNECTION_STATE.FALLBACK_READONLY
              : EXCALIDRAW_ROOM_CONNECTION_STATE.CONNECTING,
        );
      }
    };
    this.provider.on('status', this.handleProviderStatus);

    const didInitialSyncFinish = await this.waitForSync(this.provider, this.syncTimeoutMs);

    let initialJson = this.getStructuredSceneJson();
    let usedApiFallback = false;
    if (!initialJson) {
      const sceneFromApi = await this.loadSceneFromApi({ createIfMissing: false });
      const syncedJson = this.getStructuredSceneJson();
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

    this.lastSceneJson = JSON.stringify(parseSceneJson(initialJson));
    if (didInitialSyncFinish || this.provider?.synced) {
      this.markAuthoritative();
    } else {
      this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.FALLBACK_READONLY);
    }
    if (!usedApiFallback && this.canWriteToRoom && !isExcalidrawRoomDocStructured(this.ydoc)) {
      this.ydoc.transact(() => {
        this.replaceStructuredSceneWithinTransaction(this.lastSceneJson);
      }, 'excalidraw-legacy-migrate');
    }
    this.roomMeta.observe(this.handleStructuredSceneUpdate);
    this.roomElements.observeDeep(this.handleStructuredSceneUpdate);
    this.roomFiles.observeDeep(this.handleStructuredSceneUpdate);
    this.roomAppState.observe(this.handleStructuredSceneUpdate);
    this.structuredObserversAttached = true;
    this.commentThreadStore.bind({
      commentThreads: this.ydoc.getArray('comments'),
      ydoc: this.ydoc,
    });
    if (usedApiFallback && this.canWriteToRoom) {
      this.commitSceneJson(this.lastSceneJson, {
        origin: 'excalidraw-api-fallback',
      });
    }
    this.handleStructuredSceneUpdate();
    this.handleAwarenessChange();

    return parseSceneJson(this.lastSceneJson);
  }

  async loadSceneFromApi({ createIfMissing = true } = {}) {
    if (!this.filePath) {
      return createEmptyScene();
    }

    try {
      const data = await this.vaultClient.readFile(this.filePath);
      return parseSceneJson(data.content);
    } catch (readError) {
      if (readError?.status !== 404 || !createIfMissing) {
        if (readError?.status === 404) {
          throw new Error(readError.message || 'Excalidraw file not found', {
            cause: readError,
          });
        }

        throw new Error(readError?.message || 'Failed to load Excalidraw file', {
          cause: readError,
        });
      }
    }

    const emptyScene = createEmptyScene();
    try {
      await this.vaultClient.createFile({
        content: JSON.stringify(emptyScene),
        path: this.filePath,
      });
      return emptyScene;
    } catch (createError) {
      if (createError?.status === 409) {
        try {
          const existingData = await this.vaultClient.readFile(this.filePath);
          return parseSceneJson(existingData.content);
        } catch (conflictReadError) {
          throw new Error(conflictReadError?.message || 'Failed to load existing Excalidraw file after create conflict', {
            cause: conflictReadError,
          });
        }
      }

      throw new Error(createError?.message || 'Failed to create Excalidraw file', {
        cause: createError,
      });
    }
  }

  waitForSync(providerInstance, timeoutMs = DEFAULT_SYNC_TIMEOUT_MS) {
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
        this.clearTimeoutFn(timer);
        providerInstance.off('sync', handleSync);
        resolve(true);
      };

      const timer = this.setTimeoutFn(() => {
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

  markAuthoritative() {
    this.hasAuthoritativeSync = true;
    this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.AUTHORITATIVE);
    if (!this.getStructuredSceneJson() && this.lastSceneJson) {
      this.commitSceneJson(this.lastSceneJson, {
        origin: 'excalidraw-authoritative-seed',
      });
    }

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
  }

  getStructuredSceneJson() {
    if (!this.ydoc) {
      return '';
    }

    if (isExcalidrawRoomDocStructured(this.ydoc)) {
      return JSON.stringify(buildExcalidrawRoomScene(this.ydoc));
    }

    const legacyScene = readLegacyExcalidrawRoomScene(this.ydoc);
    return legacyScene ? JSON.stringify(legacyScene) : '';
  }

  replaceStructuredSceneWithinTransaction(nextJson) {
    if (!this.ydoc) {
      return;
    }

    const nextScene = tryParseSceneJson(nextJson);
    if (!nextScene) {
      return;
    }

    ensureExcalidrawRoomSchema(this.ydoc);
    replaceExcalidrawRoomScene(this.ydoc, nextScene);
  }

  mergeLocallyChangedAppState(appState, baseSceneJson) {
    const baseScene = parseSceneJson(baseSceneJson);
    const roomScene = parseSceneJson(this.lastSceneJson || this.getStructuredSceneJson());
    const nextAppState = {
      ...roomScene.appState,
    };

    ['gridSize', 'viewBackgroundColor'].forEach((key) => {
      if (appState?.[key] === baseScene.appState?.[key]) {
        return;
      }

      nextAppState[key] = appState?.[key];
    });

    return nextAppState;
  }

  buildLiveSceneDelta({
    appState,
    baseSceneJson,
    elements,
    files,
  } = {}) {
    const roomSceneJson = this.lastSceneJson || this.getStructuredSceneJson() || baseSceneJson;
    const roomScene = parseSceneJson(roomSceneJson);
    const nextAppState = this.mergeLocallyChangedAppState(appState, baseSceneJson);
    const roomElementsById = new Map(roomScene.elements.map((element) => [element.id, element]));
    const changedElements = (Array.isArray(elements) ? elements : []).filter((element) => (
      shouldSyncElementToRoom(element, roomElementsById.get(element?.id))
    ));
    const nextFiles = files && typeof files === 'object' ? files : {};
    const changedFiles = Object.fromEntries(
      Object.entries(nextFiles).filter(([fileId, file]) => (
        !areExcalidrawFilesEqual(file, roomScene.files?.[fileId])
      )),
    );
    const appStateChanged = (
      nextAppState.gridSize !== roomScene.appState?.gridSize
      || nextAppState.viewBackgroundColor !== roomScene.appState?.viewBackgroundColor
    );

    return {
      hasChanges: changedElements.length > 0 || Object.keys(changedFiles).length > 0 || appStateChanged,
      scene: buildLiveCollaborationScene(
        changedElements,
        nextAppState,
        changedFiles,
      ),
    };
  }

  scheduleSceneSync(elements, appState, files) {
    if (!this.canWriteToRoom || this.isApplyingSharedSnapshot()) {
      return false;
    }

    this.pendingSceneSyncPayload = {
      appState,
      baseSceneJson: this.lastSceneJson,
      elements,
      files,
    };
    this.scheduleSceneSyncFlush();
    return true;
  }

  scheduleSceneSyncFlush() {
    if (!this.canWriteToRoom) {
      return false;
    }

    const elapsed = this.now() - this.lastSceneSyncAt;
    const delay = Math.max(0, this.saveThrottleMs - elapsed);
    const dueAt = this.now() + delay;
    if (this.sceneSyncTimer !== null && this.sceneSyncDueAt <= dueAt) {
      return;
    }

    if (this.sceneSyncTimer !== null) {
      this.clearTimeoutFn(this.sceneSyncTimer);
    }
    this.sceneSyncDueAt = dueAt;
    this.sceneSyncTimer = this.setTimeoutFn(() => {
      this.sceneSyncTimer = null;
      this.sceneSyncDueAt = 0;
      this.flushSceneSync();
    }, delay);
    return true;
  }

  flushSceneSync() {
    if (!this.canWriteToRoom || !this.ydoc || !this.pendingSceneSyncPayload) {
      return false;
    }

    const {
      appState,
      baseSceneJson,
      elements,
      files,
    } = this.pendingSceneSyncPayload;
    this.pendingSceneSyncPayload = null;

    if (Array.isArray(elements) && elements.length === 0) {
      const emptyCandidate = buildLiveCollaborationScene(
        elements,
        this.mergeLocallyChangedAppState(appState, baseSceneJson),
        files,
      );
      if (this.shouldDelayEmptySceneCommit(JSON.stringify(emptyCandidate))) {
        this.pendingSceneSyncPayload = {
          appState,
          baseSceneJson,
          elements,
          files,
        };
        this.scheduleDelayedEmptySceneCommit();
        return;
      }
    }

    const {
      hasChanges,
      scene: sceneData,
    } = this.buildLiveSceneDelta({
      appState,
      baseSceneJson,
      elements,
      files,
    });

    if (!hasChanges) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const json = JSON.stringify(sceneData);
    this.lastSceneSyncAt = this.now();
    this.commitSceneJson(json, {
      origin: 'excalidraw-local-change',
    });

    this.pendingEmptySceneCandidate = null;

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
    return true;
  }

  hasRemoteCollaborators() {
    if (!this.awareness) {
      return false;
    }

    for (const [clientId, state] of this.awareness.getStates()) {
      if (clientId !== this.awareness.clientID && state?.user) {
        return true;
      }
    }

    return false;
  }

  shouldDelayEmptySceneCommit(nextJson) {
    if (!this.emptySceneGuardMs || !this.hasRemoteCollaborators()) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const nextScene = parseSceneJson(nextJson);
    if (nextScene.elements.length > 0) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const previousScene = parseSceneJson(this.lastSceneJson || this.getStructuredSceneJson());
    if (previousScene.elements.length === 0) {
      this.pendingEmptySceneCandidate = null;
      return false;
    }

    const now = this.now();
    if (!this.pendingEmptySceneCandidate || this.pendingEmptySceneCandidate.previousSceneJson !== this.lastSceneJson) {
      this.pendingEmptySceneCandidate = {
        firstSeenAt: now,
        previousSceneJson: this.lastSceneJson,
      };
      console.warn(`[excalidraw:${this.filePath}] Delaying suspicious empty scene commit during active collaboration`);
      return true;
    }

    return (now - this.pendingEmptySceneCandidate.firstSeenAt) < this.emptySceneGuardMs;
  }

  scheduleDelayedEmptySceneCommit() {
    if (this.sceneSyncTimer !== null) {
      return;
    }

    const firstSeenAt = this.pendingEmptySceneCandidate?.firstSeenAt ?? this.now();
    const elapsed = this.now() - firstSeenAt;
    const delay = Math.max(0, this.emptySceneGuardMs - elapsed);
    this.sceneSyncDueAt = this.now() + delay;
    this.sceneSyncTimer = this.setTimeoutFn(() => {
      this.sceneSyncTimer = null;
      this.sceneSyncDueAt = 0;
      this.flushSceneSync();
    }, delay);
  }

  flushPointerAwarenessPayload() {
    this.pointerAwarenessFrame = 0;

    if (!this.awareness || !this.pendingPointerPayload) {
      return;
    }

    this.awareness.setLocalStateField('pointer', this.pendingPointerPayload.pointer);
    this.awareness.setLocalStateField('pointerButton', this.pendingPointerPayload.button);
    this.pendingPointerPayload = null;
  }

  scheduleLocalPointerAwareness(payload) {
    if (!this.awareness || !payload?.pointer) {
      return;
    }

    this.pendingPointerPayload = {
      button: payload.button === 'down' ? 'down' : 'up',
      pointer: {
        x: payload.pointer.x,
        y: payload.pointer.y,
        tool: payload.pointer.tool === 'laser' ? 'laser' : 'pointer',
      },
    };

    if (this.pointerAwarenessFrame) {
      return;
    }

    this.pointerAwarenessFrame = this.requestAnimationFrameFn(() => this.flushPointerAwarenessPayload());
  }

  flushViewportAwarenessPayload() {
    this.viewportAwarenessFrame = 0;

    if (!this.awareness || !this.pendingViewportPayload) {
      return;
    }

    this.awareness.setLocalStateField('viewport', this.pendingViewportPayload);
    this.pendingViewportPayload = null;
  }

  scheduleLocalViewportAwareness(viewport) {
    if (!this.awareness) {
      return;
    }

    const normalizedViewport = normalizeCollaboratorViewport(viewport);
    if (!normalizedViewport) {
      return;
    }

    const signature = `${normalizedViewport.scrollX}:${normalizedViewport.scrollY}:${normalizedViewport.zoom}`;
    if (signature === this.lastViewportSignature) {
      return;
    }

    this.lastViewportSignature = signature;
    this.pendingViewportPayload = normalizedViewport;

    if (this.viewportAwarenessFrame) {
      return;
    }

    this.viewportAwarenessFrame = this.requestAnimationFrameFn(() => this.flushViewportAwarenessPayload());
  }

  syncLocalSelectionAwareness(appState) {
    if (!this.awareness) {
      return;
    }

    const selected = appState?.selectedElementIds || {};
    const signature = Object.keys(selected).sort().join(',');
    if (signature === this.lastSelectedIdsSignature) {
      return;
    }

    this.lastSelectedIdsSignature = signature;
    this.awareness.setLocalStateField('selectedElementIds', selected);
  }

  commitSceneJson(nextJson, {
    origin = 'excalidraw-room-write',
  } = {}) {
    if (!this.canWriteToRoom) {
      return false;
    }

    const normalizedJson = JSON.stringify(parseSceneJson(nextJson));
    if (!this.ydoc) {
      const didChange = normalizedJson !== this.lastSceneJson;
      this.lastSceneJson = normalizedJson;
      return didChange;
    }

    const roomSceneJson = this.getStructuredSceneJson();
    if (normalizedJson === roomSceneJson && normalizedJson === this.lastSceneJson) {
      return false;
    }

    let didChange = false;
    this.suppressStructuredSceneUpdateDepth += 1;
    try {
      this.ydoc.transact(() => {
        didChange = applySceneDiffToExcalidrawRoom(this.ydoc, parseSceneJson(normalizedJson));
      }, origin);
    } finally {
      this.suppressStructuredSceneUpdateDepth = Math.max(0, this.suppressStructuredSceneUpdateDepth - 1);
    }

    this.lastSceneJson = JSON.stringify(parseSceneJson(this.getStructuredSceneJson() || normalizedJson));
    return didChange;
  }

  disconnect() {
    this.flushSceneSync();
    this.settleAgentFlushRequests('disconnected');
    this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.DISCONNECTING);
    this.clearTimeoutFn(this.sceneSyncTimer);
    this.sceneSyncTimer = null;
    this.sceneSyncDueAt = 0;
    this.pendingSceneSyncPayload = null;

    if (this.pointerAwarenessFrame) {
      this.cancelAnimationFrameFn(this.pointerAwarenessFrame);
    }
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    if (this.viewportAwarenessFrame) {
      this.cancelAnimationFrameFn(this.viewportAwarenessFrame);
    }
    this.viewportAwarenessFrame = 0;
    this.pendingViewportPayload = null;
    this.lastViewportSignature = '';
    this.lastSelectedIdsSignature = '';
    this.pendingEmptySceneCandidate = null;

    if (this.structuredObserversAttached) {
      this.roomMeta?.unobserve(this.handleStructuredSceneUpdate);
      this.roomElements?.unobserveDeep(this.handleStructuredSceneUpdate);
      this.roomFiles?.unobserveDeep(this.handleStructuredSceneUpdate);
      this.roomAppState?.unobserve(this.handleStructuredSceneUpdate);
      this.structuredObserversAttached = false;
    }

    this.commentThreadStore.unbind();

    if (this.awareness) {
      this.awareness.off('change', this.handleAwarenessChange);
      this.awareness.setLocalState(null);
    }
    this.awareness = null;

    if (this.provider && this.handleProviderSync) {
      this.provider.off('sync', this.handleProviderSync);
    }
    if (this.provider && this.handleProviderStatus) {
      this.provider.off('status', this.handleProviderStatus);
    }
    this.handleProviderSync = null;
    this.handleProviderStatus = null;
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.roomMeta = null;
    this.roomElements = null;
    this.roomFiles = null;
    this.roomAppState = null;
    this.localUser = null;
    this.hasAuthoritativeSync = false;
    this.setConnectionState(EXCALIDRAW_ROOM_CONNECTION_STATE.CLOSED);
    this.applyingSharedSnapshotDepth = 0;
    this.suppressStructuredSceneUpdateDepth = 0;
    this.lastReplaceGeneration = null;
  }
}
