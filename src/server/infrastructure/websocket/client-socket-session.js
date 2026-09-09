import * as decoding from 'lib0/decoding';

import { MSG_SYNC } from '../../../domain/collaboration-protocol.js';

function isSyncMessage(payload) {
  try {
    const data = payload instanceof Uint8Array ? payload : new Uint8Array(payload);
    const decoder = decoding.createDecoder(data);
    return decoding.readVarUint(decoder) === MSG_SYNC;
  } catch {
    return false;
  }
}

export class ClientSocketSession {
  constructor({
    expiresAt = null,
    onDisconnected = null,
    onFailed = null,
    room,
    roomName,
    ws,
  }) {
    this.expiresAt = expiresAt;
    this.expiryTimer = null;
    this.onDisconnected = onDisconnected;
    this.onFailed = onFailed;
    this.room = room;
    this.roomName = roomName;
    this.ws = ws;
    this.isAlive = true;
    this.initialized = false;
    this.closedBeforeReady = false;
    this.hasReceivedClientSync = false;
    this.pendingMessages = [];
    this.initialSyncTimer = null;

    this.handleMessage = (payload) => {
      if (this.expireAuthentication()) return;
      if (isSyncMessage(payload)) {
        this.hasReceivedClientSync = true;
        this.clearInitialSyncTimer();
      }

      if (!this.initialized) {
        this.pendingMessages.push(payload);
        return;
      }

      this.room.handleMessage(this.ws, payload);
    };
    this.handleClose = () => {
      clearTimeout(this.expiryTimer);
      if (!this.initialized) {
        this.closedBeforeReady = true;
        this.clearInitialSyncTimer();
        this.pendingMessages.length = 0;
        return;
      }

      this.disconnect();
    };
    this.handleError = (error) => {
      console.error(`[ws] "${this.roomName}" socket error:`, error.message);
    };
    this.handlePong = () => {
      this.markAlive();
    };
  }

  expireAuthentication() {
    if (!Number.isFinite(this.expiresAt) || Date.now() < this.expiresAt) return false;
    this.handleClose();
    this.ws.close(4001, 'Authentication expired');
    return true;
  }

  scheduleAuthenticationExpiry() {
    if (!Number.isFinite(this.expiresAt) || this.expireAuthentication()) return;
    this.expiryTimer = setTimeout(() => {
      this.scheduleAuthenticationExpiry();
    }, Math.min(this.expiresAt - Date.now(), 2 ** 31 - 1));
    this.expiryTimer.unref?.();
  }

  markAlive() {
    this.isAlive = true;
  }

  markHeartbeatPending() {
    this.isAlive = false;
  }

  clearInitialSyncTimer() {
    if (!this.initialSyncTimer) {
      return;
    }

    clearTimeout(this.initialSyncTimer);
    this.initialSyncTimer = null;
  }

  attach() {
    this.ws.on('message', this.handleMessage);
    this.ws.on('close', this.handleClose);
    this.ws.on('error', this.handleError);
    this.ws.on('pong', this.handlePong);
  }

  detach() {
    this.ws.off('message', this.handleMessage);
    this.ws.off('close', this.handleClose);
    this.ws.off('error', this.handleError);
    this.ws.off('pong', this.handlePong);
    this.clearInitialSyncTimer();
    clearTimeout(this.expiryTimer);
  }

  flushPendingMessages() {
    while (this.pendingMessages.length > 0) {
      this.room.handleMessage(this.ws, this.pendingMessages.shift());
    }
  }

  scheduleInitialSync() {
    if (this.hasReceivedClientSync) {
      return;
    }

    this.initialSyncTimer = setTimeout(() => {
      this.initialSyncTimer = null;
      if (this.hasReceivedClientSync || this.ws.readyState !== this.ws.OPEN) {
        return;
      }

      this.room.sendInitialSync(this.ws);
    }, 0);
    this.initialSyncTimer.unref?.();
  }

  disconnect() {
    this.clearInitialSyncTimer();
    this.room.removeClient(this.ws);
    this.detach();
    this.onDisconnected?.(this.roomName);
  }

  async initialize() {
    this.attach();
    if (this.expireAuthentication()) {
      this.detach();
      this.onFailed?.(this.roomName);
      return;
    }
    this.scheduleAuthenticationExpiry();

    try {
      await this.room.addClient(this.ws, { sendInitialSync: false });
    } catch (error) {
      this.detach();
      console.error(`[ws] Failed to initialize room "${this.roomName}":`, error.message);
      this.onFailed?.(this.roomName);
      this.ws.close(1011, 'Room initialization failed');
      return;
    }

    this.initialized = true;
    if (this.expireAuthentication()) return;
    if (this.closedBeforeReady) {
      this.disconnect();
      return;
    }

    this.flushPendingMessages();
    this.scheduleInitialSync();

    console.log(`[ws] "${this.roomName}" connected (${this.room.clients.size} active client(s))`);
  }
}
