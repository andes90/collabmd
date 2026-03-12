import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { createRandomUser, normalizeUserName } from '../domain/room.js';
import { resolveWsBaseUrl } from './runtime-config.js';

export class EditorCollaborationClient {
  constructor({
    localUser = null,
    onAwarenessChange = null,
    onConnectionChange = null,
    onInitialSync = null,
    preferredUserName,
    resolveAwarenessCursor = null,
  }) {
    this.onAwarenessChange = onAwarenessChange;
    this.onConnectionChange = onConnectionChange;
    this.onInitialSync = onInitialSync;
    this.preferredUserName = preferredUserName;
    this.providedLocalUser = localUser;
    this.resolveAwarenessCursor = resolveAwarenessCursor ?? (() => null);
    this.provider = null;
    this.awareness = null;
    this.localUser = null;
    this.ydoc = null;
    this.ytext = null;
    this.commentThreads = null;
    this.wsBaseUrl = '';
    this.initialSyncComplete = false;
    this.initialSyncPromise = Promise.resolve();
    this.resolveInitialSync = null;
  }

  normalizeViewport(viewport) {
    if (!viewport || typeof viewport !== 'object') {
      return null;
    }

    const topLine = Number(viewport.topLine);
    const viewportRatio = Number(viewport.viewportRatio);
    if (!Number.isFinite(topLine) || topLine < 1) {
      return null;
    }

    return {
      topLine: Math.max(1, Math.round(topLine)),
      viewportRatio: Number.isFinite(viewportRatio) ? Math.min(Math.max(viewportRatio, 0), 1) : 0.35,
    };
  }

  async initialize(filePath) {
    this.wsBaseUrl = resolveWsBaseUrl();
    this.ydoc = new Y.Doc();
    this.ytext = this.ydoc.getText('codemirror');
    this.commentThreads = this.ydoc.getArray('comments');

    const undoManager = new Y.UndoManager(this.ytext);
    const provider = new WebsocketProvider(this.wsBaseUrl, filePath, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });
    const awareness = provider.awareness;
    const user = this.providedLocalUser ?? createRandomUser(this.preferredUserName);

    this.provider = provider;
    this.awareness = awareness;
    this.localUser = user;
    this.initialSyncComplete = false;
    this.initialSyncPromise = new Promise((resolve) => {
      this.resolveInitialSync = resolve;
    });

    awareness.setLocalStateField('user', user);
    awareness.on('change', () => {
      this.onAwarenessChange?.(this.collectUsers(this.resolveAwarenessCursor));
    });

    this.trackConnectionStatus();

    let initialSyncDone = false;
    provider.on('sync', (isSynced) => {
      if (!isSynced || initialSyncDone) {
        return;
      }

      initialSyncDone = true;
      this.initialSyncComplete = true;
      this.resolveInitialSync?.();
      this.resolveInitialSync = null;
      this.onInitialSync?.();
    });

    return {
      awareness,
      commentThreads: this.commentThreads,
      localUser: this.localUser,
      undoManager,
      ydoc: this.ydoc,
      ytext: this.ytext,
    };
  }

  destroy() {
    this.resolveInitialSync?.();
    this.resolveInitialSync = null;
    this.initialSyncComplete = false;
    this.initialSyncPromise = Promise.resolve();

    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this.awareness = null;
    this.localUser = null;

    this.ydoc?.destroy();
    this.ydoc = null;
    this.ytext = null;
    this.commentThreads = null;
  }

  waitForInitialSync(timeoutMs = 1500) {
    if (this.initialSyncComplete) {
      return Promise.resolve();
    }

    return Promise.race([
      this.initialSyncPromise,
      new Promise((resolve) => {
        window.setTimeout(resolve, timeoutMs);
      }),
    ]);
  }

  getText() {
    return this.ytext?.toString() ?? '';
  }

  getLocalUser() {
    return this.localUser;
  }

  setUserName(name) {
    const normalizedName = normalizeUserName(name);
    if (!normalizedName || !this.awareness || !this.localUser) {
      return null;
    }

    this.localUser = {
      ...this.localUser,
      name: normalizedName,
    };
    this.awareness.setLocalStateField('user', this.localUser);
    return normalizedName;
  }

  getUserCursor(clientId, resolveCursor) {
    if (!this.awareness) {
      return null;
    }

    const awarenessState = this.awareness.getStates().get(clientId);
    return resolveCursor(awarenessState?.cursor);
  }

  getUserViewport(clientId) {
    if (!this.awareness) {
      return null;
    }

    const awarenessState = this.awareness.getStates().get(clientId);
    return this.normalizeViewport(awarenessState?.viewport);
  }

  setLocalViewport(viewport) {
    if (!this.awareness) {
      return null;
    }

    const nextViewport = this.normalizeViewport(viewport);
    this.awareness.setLocalStateField('viewport', nextViewport);
    return nextViewport;
  }

  collectUsers(resolveCursor = () => null) {
    if (!this.awareness) {
      return [];
    }

    const users = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (!state.user) {
        return;
      }

      const cursor = resolveCursor(state.cursor);
      users.push({
        ...(cursor ?? {}),
        ...state.user,
        clientId,
        hasCursor: Boolean(cursor),
        isLocal: clientId === this.awareness.clientID,
        viewport: this.normalizeViewport(state.viewport),
      });
    });

    return users;
  }

  trackConnectionStatus() {
    if (!this.provider) {
      return;
    }

    let attempts = 0;
    let hasEverConnected = false;

    this.provider.on('status', ({ status }) => {
      if (status === 'connecting') {
        attempts += 1;
      }

      const firstConnection = status === 'connected' && !hasEverConnected;
      if (status === 'connected') {
        attempts = 0;
        hasEverConnected = true;
      }

      this.onConnectionChange?.({
        attempts,
        firstConnection,
        hasEverConnected,
        status,
        unreachable: !hasEverConnected && attempts >= 3,
        wsBaseUrl: this.wsBaseUrl,
      });
    });
  }
}
