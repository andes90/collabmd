import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  buildCollaboratorsMap,
  mergeAwarenessUserPatch,
} from '../domain/excalidraw-collaboration.js';
import {
  buildStoredScene,
  createEmptyScene,
  parseSceneJson,
} from '../domain/excalidraw-scene.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';

const DEFAULT_HISTORY_ARRAY_KEY = 'excalidraw-history';
const DEFAULT_HISTORY_CAPTURE_WINDOW_MS = 500;
const DEFAULT_HISTORY_LIMIT = 100;
const DEFAULT_HISTORY_STATE_KEY = 'excalidraw-history-state';
const DEFAULT_ROOM_TEXT_KEY = 'codemirror';
const DEFAULT_SAVE_THROTTLE_MS = 48;
const DEFAULT_SYNC_TIMEOUT_MS = 4000;
const HISTORY_HEAD_KEY = 'head';

export class ExcalidrawRoomClient {
  constructor({
    cancelAnimationFrameFn = (frameId) => cancelAnimationFrame(frameId),
    clearTimeoutFn = (timeoutId) => clearTimeout(timeoutId),
    filePath = '',
    historyArrayKey = DEFAULT_HISTORY_ARRAY_KEY,
    historyCaptureWindowMs = DEFAULT_HISTORY_CAPTURE_WINDOW_MS,
    historyLimit = DEFAULT_HISTORY_LIMIT,
    historyStateKey = DEFAULT_HISTORY_STATE_KEY,
    now = () => Date.now(),
    onCollaboratorsChange = () => {},
    onHistoryStateChange = () => {},
    onRemoteSceneJson = () => {},
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    resolveWsBaseUrlFn = resolveWsBaseUrl,
    roomTextKey = DEFAULT_ROOM_TEXT_KEY,
    saveThrottleMs = DEFAULT_SAVE_THROTTLE_MS,
    setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    vaultClient,
    websocketProviderFactory = (wsUrl, path, ydoc, options) => new WebsocketProvider(wsUrl, path, ydoc, options),
    ydocFactory = () => new Doc(),
  }) {
    this.cancelAnimationFrameFn = cancelAnimationFrameFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.filePath = filePath;
    this.historyArrayKey = historyArrayKey;
    this.historyCaptureWindowMs = historyCaptureWindowMs;
    this.historyLimit = historyLimit;
    this.historyStateKey = historyStateKey;
    this.now = now;
    this.onCollaboratorsChange = onCollaboratorsChange;
    this.onHistoryStateChange = onHistoryStateChange;
    this.onRemoteSceneJson = onRemoteSceneJson;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.resolveWsBaseUrlFn = resolveWsBaseUrlFn;
    this.roomTextKey = roomTextKey;
    this.saveThrottleMs = saveThrottleMs;
    this.setTimeoutFn = setTimeoutFn;
    this.syncTimeoutMs = syncTimeoutMs;
    this.vaultClient = vaultClient;
    this.websocketProviderFactory = websocketProviderFactory;
    this.ydocFactory = ydocFactory;
    this.ydoc = null;
    this.historySnapshots = null;
    this.historyState = null;
    this.ytext = null;
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.handleProviderSync = null;
    this.lastSceneJson = '';
    this.sceneSyncTimer = null;
    this.lastSceneSyncAt = 0;
    this.pendingSceneSyncPayload = null;
    this.pointerAwarenessFrame = 0;
    this.pendingPointerPayload = null;
    this.viewportAwarenessFrame = 0;
    this.pendingViewportPayload = null;
    this.lastViewportSignature = '';
    this.lastSelectedIdsSignature = '';
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;
    this.applyingSharedSnapshotDepth = 0;
    this.historySubscribers = new Set();
    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;

    this.handleAwarenessChange = () => {
      this.onCollaboratorsChange(buildCollaboratorsMap(this.awareness));
    };

    this.handleSharedHistoryUpdate = () => {
      this.handleRoomHistoryUpdate();
    };

    this.handleRoomTextUpdate = () => {
      if (!this.ytext) {
        return;
      }

      const remoteJson = this.ytext.toString();
      if (!remoteJson || remoteJson === this.lastSceneJson) {
        return;
      }

      this.unlockRoomWrites();
      this.lastSceneJson = JSON.stringify(parseSceneJson(remoteJson));
      this.onRemoteSceneJson(this.lastSceneJson);
    };
  }

  getLastSceneJson() {
    return this.lastSceneJson;
  }

  getLocalUser() {
    return this.localUser;
  }

  getHistoryState() {
    const length = this.getSharedHistoryLength();
    const head = this.getResolvedHistoryHead();
    return {
      canRedo: head >= 0 && head < length - 1,
      canUndo: head > 0,
      head,
      length,
    };
  }

  canRedo() {
    return this.getHistoryState().canRedo;
  }

  canUndo() {
    return this.getHistoryState().canUndo;
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

  subscribeHistoryState(listener) {
    if (typeof listener !== 'function') {
      return () => {};
    }

    this.historySubscribers.add(listener);
    listener(this.getHistoryState());
    return () => {
      this.historySubscribers.delete(listener);
    };
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

  async connect({ initialUser = null } = {}) {
    this.localUser = initialUser;

    if (!this.filePath) {
      const scene = createEmptyScene();
      this.lastSceneJson = JSON.stringify(scene);
      return scene;
    }

    this.ydoc = this.ydocFactory();
    this.historySnapshots = this.ydoc.getArray(this.historyArrayKey);
    this.historyState = this.ydoc.getMap(this.historyStateKey);
    this.ytext = this.ydoc.getText(this.roomTextKey);
    this.provider = this.websocketProviderFactory(this.resolveWsBaseUrlFn(), this.filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });

    this.awareness = this.provider.awareness;
    if (this.localUser) {
      this.awareness.setLocalStateField('user', this.localUser);
    }
    this.awareness.setLocalStateField('pointerButton', 'up');
    this.awareness.setLocalStateField('selectedElementIds', {});
    this.awareness.on('change', this.handleAwarenessChange);

    this.handleProviderSync = (isSynced) => {
      if (!isSynced) {
        return;
      }

      this.unlockRoomWrites();
      this.handleRoomTextUpdate();
    };
    this.provider.on('sync', this.handleProviderSync);

    const didInitialSyncFinish = await this.waitForSync(this.provider, this.syncTimeoutMs);

    let initialJson = this.ytext.toString();
    let usedApiFallback = false;
    if (!initialJson) {
      const sceneFromApi = await this.loadSceneFromApi();
      const syncedJson = this.ytext.toString();
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

    this.waitingForAuthoritativeSync = usedApiFallback && !didInitialSyncFinish;
    this.canWriteToRoom = !this.waitingForAuthoritativeSync;
    this.lastSceneJson = JSON.stringify(parseSceneJson(initialJson));
    this.historySnapshots.observe(this.handleSharedHistoryUpdate);
    this.historyState.observe(this.handleSharedHistoryUpdate);
    this.ytext.observe(this.handleRoomTextUpdate);
    this.ensureSharedHistoryInitialized(this.lastSceneJson);
    this.handleRoomHistoryUpdate();
    this.handleRoomTextUpdate();
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
          throw new Error(readError.message || 'Excalidraw file not found');
        }

        throw new Error(readError?.message || 'Failed to load Excalidraw file');
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
        return emptyScene;
      }

      throw new Error(createError?.message || 'Failed to create Excalidraw file');
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

  unlockRoomWrites() {
    this.waitingForAuthoritativeSync = false;
    this.canWriteToRoom = true;
    this.ensureSharedHistoryInitialized(this.lastSceneJson);

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
  }

  replaceRoomContentWithinTransaction(nextJson) {
    if (!this.ytext) {
      return;
    }

    if (this.ytext.length > 0) {
      this.ytext.delete(0, this.ytext.length);
    }
    if (nextJson) {
      this.ytext.insert(0, nextJson);
    }
  }

  replaceRoomContent(nextJson, origin = 'excalidraw-room-write') {
    if (!this.ydoc || !this.ytext) {
      return;
    }

    this.ydoc.transact(() => {
      this.replaceRoomContentWithinTransaction(nextJson);
    }, origin);
  }

  scheduleSceneSync(elements, appState, files) {
    this.pendingSceneSyncPayload = { appState, elements, files };
    if (!this.canWriteToRoom) {
      return;
    }

    this.scheduleSceneSyncFlush();
  }

  scheduleSceneSyncFlush() {
    if (this.sceneSyncTimer !== null) {
      return;
    }

    const elapsed = this.now() - this.lastSceneSyncAt;
    const delay = Math.max(0, this.saveThrottleMs - elapsed);
    this.sceneSyncTimer = this.setTimeoutFn(() => {
      this.sceneSyncTimer = null;
      this.flushSceneSync();
    }, delay);
  }

  flushSceneSync() {
    if (!this.ytext || !this.pendingSceneSyncPayload) {
      return;
    }

    const { elements, appState, files } = this.pendingSceneSyncPayload;
    this.pendingSceneSyncPayload = null;

    const sceneData = buildStoredScene(elements, appState, files);
    const json = JSON.stringify(sceneData);

    if (json !== this.lastSceneJson || this.getSharedHistoryLength() === 0) {
      this.lastSceneSyncAt = this.now();
      this.commitSceneJson(json, {
        allowCoalesce: true,
        captureTime: this.lastSceneSyncAt,
        origin: 'excalidraw-local-change',
      });
    }

    if (this.pendingSceneSyncPayload) {
      this.scheduleSceneSyncFlush();
    }
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

  normalizeViewportAwareness(viewport) {
    if (!viewport || typeof viewport !== 'object') {
      return null;
    }

    const scrollX = Number(viewport.scrollX);
    const scrollY = Number(viewport.scrollY);
    const zoom = Number(viewport.zoom);
    if (!Number.isFinite(scrollX) || !Number.isFinite(scrollY) || !Number.isFinite(zoom) || zoom <= 0) {
      return null;
    }

    return {
      scrollX,
      scrollY,
      zoom,
    };
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

    const normalizedViewport = this.normalizeViewportAwareness(viewport);
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
    allowCoalesce = false,
    captureTime = this.now(),
    origin = 'excalidraw-room-write',
  } = {}) {
    if (!this.ydoc || !this.ytext || !this.historySnapshots || !this.historyState) {
      this.lastSceneJson = JSON.stringify(parseSceneJson(nextJson));
      return false;
    }

    const normalizedJson = JSON.stringify(parseSceneJson(nextJson));
    const previousSceneJson = this.lastSceneJson || JSON.stringify(parseSceneJson(this.ytext.toString()));
    this.lastSceneJson = normalizedJson;

    this.ydoc.transact(() => {
      let head = this.getResolvedHistoryHead();
      if (this.historySnapshots.length === 0) {
        this.historySnapshots.insert(0, [previousSceneJson]);
        head = 0;
        this.historyState.set(HISTORY_HEAD_KEY, head);
      }

      const shouldCoalesce = allowCoalesce && this.canCoalesceWithLocalHistory(head, captureTime);
      if (shouldCoalesce) {
        this.replaceSharedHistorySnapshot(head, normalizedJson);
      } else {
        if (head < this.historySnapshots.length - 1) {
          this.historySnapshots.delete(head + 1, this.historySnapshots.length - head - 1);
        }

        this.historySnapshots.insert(head + 1, [normalizedJson]);
        head += 1;

        if (this.historySnapshots.length > this.historyLimit) {
          const overflow = this.historySnapshots.length - this.historyLimit;
          this.historySnapshots.delete(0, overflow);
          head -= overflow;
        }

        this.historyState.set(HISTORY_HEAD_KEY, head);
      }

      this.replaceRoomContentWithinTransaction(normalizedJson);
      this.lastLocallyUpdatedHistoryHead = head;
      this.lastLocallyUpdatedHistoryAt = captureTime;
    }, origin);

    this.emitHistoryStateChange();
    return true;
  }

  undoShared() {
    return this.navigateSharedHistory(-1, 'excalidraw-shared-undo');
  }

  redoShared() {
    return this.navigateSharedHistory(1, 'excalidraw-shared-redo');
  }

  navigateSharedHistory(step, origin) {
    if (!this.canWriteToRoom || !this.ydoc || !this.historySnapshots || !this.historyState) {
      return false;
    }

    const currentHead = this.getResolvedHistoryHead();
    const nextHead = currentHead + step;
    if (nextHead < 0 || nextHead >= this.historySnapshots.length) {
      return false;
    }

    const nextJson = this.getSharedHistorySnapshot(nextHead);
    if (!nextJson) {
      return false;
    }

    this.ydoc.transact(() => {
      this.historyState.set(HISTORY_HEAD_KEY, nextHead);
      this.replaceRoomContentWithinTransaction(nextJson);
    }, origin);

    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;
    return true;
  }

  getSharedHistoryLength() {
    return this.historySnapshots?.length ?? 0;
  }

  getResolvedHistoryHead() {
    const length = this.getSharedHistoryLength();
    if (length === 0) {
      return -1;
    }

    const rawHead = Number(this.historyState?.get(HISTORY_HEAD_KEY));
    if (Number.isInteger(rawHead) && rawHead >= 0 && rawHead < length) {
      return rawHead;
    }

    return length - 1;
  }

  getSharedHistorySnapshot(index) {
    if (!this.historySnapshots || index < 0 || index >= this.historySnapshots.length) {
      return '';
    }

    const snapshot = this.historySnapshots.get(index);
    if (typeof snapshot !== 'string') {
      return '';
    }

    return JSON.stringify(parseSceneJson(snapshot));
  }

  getActiveSharedHistorySnapshot() {
    return this.getSharedHistorySnapshot(this.getResolvedHistoryHead());
  }

  replaceSharedHistorySnapshot(index, nextJson) {
    if (!this.historySnapshots || index < 0 || index >= this.historySnapshots.length) {
      return;
    }

    this.historySnapshots.delete(index, 1);
    this.historySnapshots.insert(index, [nextJson]);
  }

  canCoalesceWithLocalHistory(head, captureTime) {
    return (
      head >= 0
      && head === this.lastLocallyUpdatedHistoryHead
      && captureTime - this.lastLocallyUpdatedHistoryAt <= this.historyCaptureWindowMs
    );
  }

  ensureSharedHistoryInitialized(sceneJson) {
    if (!this.canWriteToRoom || !this.ydoc || !this.historySnapshots || !this.historyState) {
      return false;
    }

    if (this.historySnapshots.length > 0) {
      this.emitHistoryStateChange();
      return false;
    }

    const normalizedJson = JSON.stringify(parseSceneJson(sceneJson || this.lastSceneJson || this.ytext?.toString()));
    this.ydoc.transact(() => {
      if (this.historySnapshots.length > 0) {
        return;
      }

      this.historySnapshots.insert(0, [normalizedJson]);
      this.historyState.set(HISTORY_HEAD_KEY, 0);
    }, 'excalidraw-history-seed');
    this.emitHistoryStateChange();
    return true;
  }

  handleRoomHistoryUpdate() {
    this.emitHistoryStateChange();

    const historySceneJson = this.getActiveSharedHistorySnapshot();
    if (!historySceneJson || historySceneJson === this.lastSceneJson) {
      return;
    }

    this.unlockRoomWrites();
    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;
    this.lastSceneJson = historySceneJson;
    this.onRemoteSceneJson(historySceneJson);
  }

  emitHistoryStateChange() {
    const nextState = this.getHistoryState();
    this.onHistoryStateChange(nextState);
    this.historySubscribers.forEach((listener) => listener(nextState));
  }

  disconnect() {
    this.flushSceneSync();
    this.clearTimeoutFn(this.sceneSyncTimer);
    this.sceneSyncTimer = null;
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

    if (this.ytext) {
      this.ytext.unobserve(this.handleRoomTextUpdate);
    }
    this.historySnapshots?.unobserve(this.handleSharedHistoryUpdate);
    this.historyState?.unobserve(this.handleSharedHistoryUpdate);

    if (this.awareness) {
      this.awareness.off('change', this.handleAwarenessChange);
      this.awareness.setLocalState(null);
    }
    this.awareness = null;

    if (this.provider && this.handleProviderSync) {
      this.provider.off('sync', this.handleProviderSync);
    }
    this.handleProviderSync = null;
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.historySnapshots = null;
    this.historyState = null;
    this.ytext = null;
    this.localUser = null;
    this.canWriteToRoom = false;
    this.waitingForAuthoritativeSync = false;
    this.applyingSharedSnapshotDepth = 0;
    this.lastLocallyUpdatedHistoryHead = -1;
    this.lastLocallyUpdatedHistoryAt = 0;
    this.emitHistoryStateChange();
  }
}
