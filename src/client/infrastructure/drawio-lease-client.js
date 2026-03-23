import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  DRAWIO_LEASE_HEARTBEAT_MS,
  DRAWIO_LEASE_STALE_MS,
} from '../../domain/drawio-room.js';
import { resolveWsBaseUrl } from '../domain/runtime-paths.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

const DEFAULT_SYNC_TIMEOUT_MS = 4000;

function toFiniteNumber(value, fallbackValue = 0) {
  const normalized = Number(value);
  return Number.isFinite(normalized) ? normalized : fallbackValue;
}

export class DrawioLeaseClient {
  constructor({
    clearIntervalFn = (intervalId) => window.clearInterval(intervalId),
    filePath = '',
    heartbeatIntervalMs = DRAWIO_LEASE_HEARTBEAT_MS,
    now = () => Date.now(),
    onStateChange = () => {},
    resolveWsBaseUrlFn = resolveWsBaseUrl,
    roomName = '',
    setIntervalFn = (callback, delay) => window.setInterval(callback, delay),
    setTimeoutFn = (callback, delay) => window.setTimeout(callback, delay),
    staleLeaseMs = DRAWIO_LEASE_STALE_MS,
    syncTimeoutMs = DEFAULT_SYNC_TIMEOUT_MS,
    websocketProviderFactory = (wsUrl, path, ydoc, options) => new WebsocketProvider(wsUrl, path, ydoc, options),
    ydocFactory = () => new Doc(),
  }) {
    this.clearIntervalFn = clearIntervalFn;
    this.filePath = filePath;
    this.heartbeatIntervalMs = heartbeatIntervalMs;
    this.now = now;
    this.onStateChange = onStateChange;
    this.resolveWsBaseUrlFn = resolveWsBaseUrlFn;
    this.roomName = roomName;
    this.setIntervalFn = setIntervalFn;
    this.setTimeoutFn = setTimeoutFn;
    this.staleLeaseMs = staleLeaseMs;
    this.syncTimeoutMs = syncTimeoutMs;
    this.websocketProviderFactory = websocketProviderFactory;
    this.ydocFactory = ydocFactory;

    this.ydoc = null;
    this.provider = null;
    this.awareness = null;
    this.leaseMap = null;
    this.statusMap = null;
    this.localUser = null;
    this.localMode = 'viewer';
    this.heartbeatTimer = null;
    this.currentState = this.createState();
    this.handleLeaseChange = () => this.emitState();
    this.handleStatusChange = () => this.emitState();
    this.handleAwarenessChange = () => this.emitState();
  }

  createState(overrides = {}) {
    return {
      acquiredAt: 0,
      canClaim: false,
      hasHealthyHolder: false,
      heartbeatAt: 0,
      holderClientId: '',
      holderName: '',
      holderPeerId: '',
      isEditor: false,
      isStale: true,
      mode: 'viewer',
      savedAt: 0,
      savedVersion: 0,
      ...overrides,
    };
  }

  async connect({ initialUser = null, requestedMode = 'edit' } = {}) {
    this.localUser = initialUser ?? null;
    this.localMode = requestedMode === 'edit' ? 'viewer' : 'viewer';

    if (!this.roomName) {
      this.currentState = this.createState();
      this.onStateChange(this.currentState);
      return this.currentState;
    }

    this.ydoc = this.ydocFactory();
    this.provider = this.websocketProviderFactory(this.resolveWsBaseUrlFn(), this.roomName, this.ydoc, {
      disableBc: true,
      maxBackoffTime: 5000,
    });
    stopReconnectOnControlledClose(this.provider);

    this.awareness = this.provider.awareness;
    this.leaseMap = this.ydoc.getMap('lease');
    this.statusMap = this.ydoc.getMap('status');

    this.setLocalAwareness({ mode: 'viewer' });

    this.leaseMap.observe(this.handleLeaseChange);
    this.statusMap.observe(this.handleStatusChange);
    this.awareness.on('change', this.handleAwarenessChange);

    await this.waitForSync();

    if (requestedMode === 'edit') {
      this.tryAcquireLease();
    } else {
      this.emitState();
    }

    return this.currentState;
  }

  waitForSync() {
    if (!this.provider) {
      return Promise.resolve(false);
    }

    return new Promise((resolve) => {
      let finished = false;
      const timeoutId = this.setTimeoutFn(() => {
        if (finished) {
          return;
        }

        finished = true;
        this.provider.off?.('sync', handleSync);
        resolve(false);
      }, this.syncTimeoutMs);

      const handleSync = (isSynced) => {
        if (!isSynced || finished) {
          return;
        }

        finished = true;
        clearTimeout(timeoutId);
        this.provider.off?.('sync', handleSync);
        resolve(true);
      };

      this.provider.on?.('sync', handleSync);
    });
  }

  setLocalUser(nextUser = null) {
    this.localUser = nextUser ?? null;
    this.setLocalAwareness({ mode: this.currentState.isEditor ? 'editor' : 'viewer' });
    return this.localUser;
  }

  setLocalAwareness({ mode = 'viewer' } = {}) {
    this.localMode = mode;
    if (!this.awareness) {
      return;
    }

    this.awareness.setLocalStateField('drawio', {
      filePath: this.filePath,
      mode,
      name: this.localUser?.name || '',
      peerId: this.localUser?.peerId || '',
    });
  }

  getLocalClientId() {
    return this.ydoc ? String(this.ydoc.clientID) : '';
  }

  getLeaseSnapshot() {
    return {
      acquiredAt: toFiniteNumber(this.leaseMap?.get('acquiredAt')),
      heartbeatAt: toFiniteNumber(this.leaseMap?.get('heartbeatAt')),
      holderClientId: String(this.leaseMap?.get('holderClientId') || ''),
      holderName: String(this.leaseMap?.get('holderName') || ''),
      holderPeerId: String(this.leaseMap?.get('holderPeerId') || ''),
    };
  }

  findHolderAwarenessState(holderClientId) {
    if (!holderClientId || !this.awareness) {
      return null;
    }

    for (const [clientId, state] of this.awareness.getStates()) {
      if (String(clientId) === String(holderClientId) && state?.drawio?.filePath === this.filePath) {
        return state.drawio;
      }
    }

    return null;
  }

  isLeaseStale(snapshot = this.getLeaseSnapshot()) {
    if (!snapshot.holderClientId) {
      return true;
    }

    if (!this.findHolderAwarenessState(snapshot.holderClientId)) {
      return true;
    }

    return (this.now() - snapshot.heartbeatAt) > this.staleLeaseMs;
  }

  isLeaseHeldByLocal(snapshot = this.getLeaseSnapshot()) {
    return Boolean(snapshot.holderClientId) && snapshot.holderClientId === this.getLocalClientId();
  }

  tryAcquireLease() {
    if (!this.leaseMap) {
      return false;
    }

    const snapshot = this.getLeaseSnapshot();
    if (snapshot.holderClientId && !this.isLeaseStale(snapshot) && !this.isLeaseHeldByLocal(snapshot)) {
      this.emitState();
      return false;
    }

    const now = this.now();
    this.ydoc.transact(() => {
      this.leaseMap.set('holderClientId', this.getLocalClientId());
      this.leaseMap.set('holderName', this.localUser?.name || '');
      this.leaseMap.set('holderPeerId', this.localUser?.peerId || '');
      this.leaseMap.set('acquiredAt', now);
      this.leaseMap.set('heartbeatAt', now);
    }, 'drawio-lease-acquire');

    this.emitState();
    return this.currentState.isEditor;
  }

  renewLeaseHeartbeat() {
    if (!this.leaseMap || !this.isLeaseHeldByLocal()) {
      return false;
    }

    this.leaseMap.set('heartbeatAt', this.now());
    return true;
  }

  startHeartbeat() {
    if (this.heartbeatTimer) {
      return;
    }

    this.heartbeatTimer = this.setIntervalFn(() => {
      this.renewLeaseHeartbeat();
    }, this.heartbeatIntervalMs);
  }

  stopHeartbeat() {
    if (!this.heartbeatTimer) {
      return;
    }

    this.clearIntervalFn(this.heartbeatTimer);
    this.heartbeatTimer = null;
  }

  releaseLease() {
    if (!this.leaseMap || !this.isLeaseHeldByLocal()) {
      return false;
    }

    this.stopHeartbeat();
    this.ydoc.transact(() => {
      this.leaseMap.delete('holderClientId');
      this.leaseMap.delete('holderName');
      this.leaseMap.delete('holderPeerId');
      this.leaseMap.delete('acquiredAt');
      this.leaseMap.delete('heartbeatAt');
    }, 'drawio-lease-release');
    this.setLocalAwareness({ mode: 'viewer' });
    this.emitState();
    return true;
  }

  publishSave() {
    if (!this.statusMap) {
      return 0;
    }

    const nextVersion = toFiniteNumber(this.statusMap.get('savedVersion')) + 1;
    const savedAt = this.now();
    this.ydoc.transact(() => {
      this.statusMap.set('savedVersion', nextVersion);
      this.statusMap.set('savedAt', savedAt);
    }, 'drawio-save-status');
    this.emitState();
    return nextVersion;
  }

  emitState() {
    const snapshot = this.getLeaseSnapshot();
    const isStale = this.isLeaseStale(snapshot);
    const isEditor = this.isLeaseHeldByLocal(snapshot);
    const nextState = this.createState({
      acquiredAt: snapshot.acquiredAt,
      canClaim: !isEditor && isStale,
      hasHealthyHolder: Boolean(snapshot.holderClientId) && !isStale,
      heartbeatAt: snapshot.heartbeatAt,
      holderClientId: snapshot.holderClientId,
      holderName: snapshot.holderName,
      holderPeerId: snapshot.holderPeerId,
      isEditor,
      isStale,
      mode: isEditor ? 'editor' : 'viewer',
      savedAt: toFiniteNumber(this.statusMap?.get('savedAt')),
      savedVersion: toFiniteNumber(this.statusMap?.get('savedVersion')),
    });

    if (isEditor) {
      this.startHeartbeat();
      this.setLocalAwareness({ mode: 'editor' });
    } else {
      this.stopHeartbeat();
      this.setLocalAwareness({ mode: 'viewer' });
    }

    this.currentState = nextState;
    this.onStateChange(nextState);
    return nextState;
  }

  destroy() {
    this.releaseLease();
    this.stopHeartbeat();
    this.leaseMap?.unobserve?.(this.handleLeaseChange);
    this.statusMap?.unobserve?.(this.handleStatusChange);
    this.awareness?.off?.('change', this.handleAwarenessChange);
    this.provider?.destroy?.();
    this.ydoc?.destroy?.();
    this.provider = null;
    this.ydoc = null;
    this.awareness = null;
    this.leaseMap = null;
    this.statusMap = null;
  }
}
