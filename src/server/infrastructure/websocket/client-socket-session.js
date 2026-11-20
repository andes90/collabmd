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
    this.pendingMessages = [];

    this.handleMessage = (payload) => {
      if (this.expireAuthentication()) return;
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
    clearTimeout(this.expiryTimer);
  }

  flushPendingMessages() {
    while (this.pendingMessages.length > 0) {
      this.room.handleMessage(this.ws, this.pendingMessages.shift());
    }
  }

  disconnect() {
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
      await this.room.addClient(this.ws);
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
    this.room.requestClientSync(this.ws);

    console.log(`[ws] "${this.roomName}" connected (${this.room.clients.size} active client(s))`);
  }
}
