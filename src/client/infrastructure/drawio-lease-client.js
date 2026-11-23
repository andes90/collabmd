import { Doc } from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import {
  DRAWIO_LEASE_HEARTBEAT_MS,
  DRAWIO_LEASE_STALE_MS,
} from '../../domain/drawio-room.js';
import { encodeRoomPath, resolveWsBaseUrl } from '../domain/runtime-paths.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

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
    staleLeaseMs = DRAWIO_LEASE_STALE_MS,
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
    this.staleLeaseMs = staleLeaseMs;
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
    this.localMode = 'viewer';

    if (!this.roomName) {
      this.currentState = this.createState();
      this.onStateChange(this.currentState);
      return this.currentState;
    }

    this.ydoc = this.ydocFactory();
    this.provider = this.websocketProviderFactory(this.resolveWsBaseUrlFn(), encodeRoomPath(this.roomName), this.ydoc, {
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

    let claimedAfterInitialSync = false;
    const handleSync = (synced) => {
      if (synced && !claimedAfterInitialSync && requestedMode === 'edit') {
        claimedAfterInitialSync = true;
        this.tryAcquireLease();
      } else {
        this.emitState();
      }
    };
    this.provider.on('sync', handleSync);
    handleSync(this.provider.synced);
    return this.currentState;
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

  isLeaseStale(snapshot = this.getLeaseSnapshot()) {
    if (!snapshot.holderClientId) {
      return true;
    }

    // Awareness can arrive after the room sync. A recent heartbeat protects the holder.
    return (this.now() - snapshot.heartbeatAt) > this.staleLeaseMs;
  }

  isLeaseHeldByLocal(snapshot = this.getLeaseSnapshot()) {
    return Boolean(snapshot.holderClientId) && snapshot.holderClientId === this.getLocalClientId();
  }

  tryAcquireLease() {
    if (!this.leaseMap || !this.provider?.synced) {
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
    if (!this.provider?.synced || !this.leaseMap || !this.isLeaseHeldByLocal()) {
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
    if (!this.provider?.synced || !this.leaseMap || !this.isLeaseHeldByLocal()) {
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
    const synced = Boolean(this.provider?.synced);
    const isEditor = synced && this.isLeaseHeldByLocal(snapshot);
    const nextState = this.createState({
      acquiredAt: snapshot.acquiredAt,
      canClaim: synced && !isEditor && isStale,
      hasHealthyHolder: synced && Boolean(snapshot.holderClientId) && !isStale,
      heartbeatAt: snapshot.heartbeatAt,
      holderClientId: snapshot.holderClientId,
      holderName: snapshot.holderName,
      holderPeerId: snapshot.holderPeerId,
      isEditor,
      isStale,
      synced,
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

    clearTimeout(this.expiryTimer);
    if (nextState.hasHealthyHolder && !isEditor) {
      const expiresIn = Math.max(1, this.staleLeaseMs - (this.now() - snapshot.heartbeatAt) + 1);
      this.expiryTimer = setTimeout(() => this.emitState(), Math.min(expiresIn, this.staleLeaseMs + 1));
    }
    this.currentState = nextState;
    this.onStateChange(nextState);
    return nextState;
  }

  destroy() {
    this.releaseLease();
    clearTimeout(this.expiryTimer);
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
