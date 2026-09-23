import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import {
  CANVAS_EDGES_KEY,
  CANVAS_EDGE_ORDER_KEY,
  CANVAS_META_KEY,
  CANVAS_NODES_KEY,
  CANVAS_NODE_ORDER_KEY,
  buildCanvasRoomDocument,
  isCanvasRoomDocStructured,
  parseCanvasJson,
} from '../../domain/canvas-room-codec.js';
import { MSG_AGENT_FLUSH, MSG_AGENT_FLUSH_ACK } from '../../domain/collaboration-protocol.js';
import { resolveWsBaseUrl } from './runtime-config.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

export class CanvasRoomClient {
  constructor({ filePath, user, readFile, onChange, onAwareness, onConnection,
    providerFactory = (...args) => new WebsocketProvider(...args), wsBaseUrl = resolveWsBaseUrl() }) {
    Object.assign(this, { filePath, user, readFile, onChange, onAwareness, onConnection, providerFactory, wsBaseUrl });
    this.doc = new Y.Doc();
    this.localOrigin = Symbol('canvas-edit');
    this.meta = this.doc.getMap(CANVAS_META_KEY);
    this.undoManager = new Y.UndoManager([
      this.doc.getMap(CANVAS_NODES_KEY), this.doc.getMap(CANVAS_EDGES_KEY),
      this.doc.getMap(CANVAS_NODE_ORDER_KEY), this.doc.getMap(CANVAS_EDGE_ORDER_KEY),
    ], { trackedOrigins: new Set([this.localOrigin]), captureTimeout: 500 });
    this.pendingFlushes = new Map();
    this.localVersion = 0;
    this.acknowledgedVersion = 0;
    this.hasEverConnected = false;
    this.destroyed = false;
    this.fallback = null;
    this.error = '';
    this.offline = globalThis.navigator?.onLine === false;
    this.handleOffline = () => {
      this.offline = true;
      this.provider?.disconnect();
      this.publish();
    };
    this.handleOnline = () => {
      if (!this.offline) return;
      this.offline = false;
      this.provider?.connect();
      this.publish();
    };
  }

  get canEdit() {
    return Boolean(this.provider?.synced && isCanvasRoomDocStructured(this.doc) && !this.error
      && !this.meta.get('externalConflict') && !this.disconnecting && !this.offline);
  }

  get hasPendingWrites() {
    return this.localVersion > this.acknowledgedVersion;
  }

  async connect() {
    this.doc.on('update', (_update, origin) => {
      if (origin !== this.provider) {
        this.localVersion += 1;
        clearTimeout(this.flushTimer);
        this.flushTimer = setTimeout(() => { void this.flush(); }, 400);
      }
      this.publish();
    });
    this.provider = this.providerFactory(this.wsBaseUrl, this.filePath, this.doc, {
      disableBc: true, maxBackoffTime: 5000,
    });
    stopReconnectOnControlledClose(this.provider);
    this.provider.messageHandlers[MSG_AGENT_FLUSH_ACK] = (_encoder, decoder) => {
      const requestId = decoding.readVarString(decoder);
      this.pendingFlushes.get(requestId)?.(true);
    };
    this.awareness = this.provider.awareness;
    this.setUser(this.user);
    this.awareness.on('change', () => this.publishAwareness());
    this.provider.on('status', ({ status }) => {
      const firstConnection = status === 'connected' && !this.hasEverConnected;
      if (status === 'connected') this.hasEverConnected = true;
      this.onConnection?.({ status, firstConnection, hasEverConnected: this.hasEverConnected, attempts: 0 });
      this.publish();
    });
    this.provider.on('sync', () => {
      this.publish();
      if (this.provider.synced && this.hasPendingWrites) void this.flush();
    });
    globalThis.window?.addEventListener('offline', this.handleOffline);
    globalThis.window?.addEventListener('online', this.handleOnline);
    if (this.offline) this.provider.disconnect();
    this.publish();
    try {
      const response = await this.readFile(this.filePath);
      if (this.destroyed) return;
      this.fallback = parseCanvasJson(response.content);
    } catch (error) {
      if (this.destroyed) return;
      this.error = error.message || 'Unable to open canvas';
    }
    this.publish();
  }

  publish() {
    if (this.destroyed) return;
    let document = this.fallback;
    if (isCanvasRoomDocStructured(this.doc)) {
      try {
        document = buildCanvasRoomDocument(this.doc);
        this.error = '';
      } catch {
        this.error = 'Canvas data is invalid. Editing is paused to protect the file.';
      }
    } else if (this.meta.get('invalidContent')) {
      this.error = 'Invalid JSON Canvas file. The original file has been preserved.';
    }
    this.onChange?.({
      document, canEdit: this.canEdit, synced: Boolean(this.provider?.synced),
      conflict: this.meta.get('externalConflict'), error: this.error,
      undoAvailable: this.undoManager.canUndo(), redoAvailable: this.undoManager.canRedo(),
    });
  }

  mutate(operation, { separateUndo = true } = {}) {
    if (!this.canEdit) return false;
    if (separateUndo) this.undoManager.stopCapturing();
    this.doc.transact(() => operation(this.doc), this.localOrigin);
    if (separateUndo) this.undoManager.stopCapturing();
    return true;
  }

  undo() {
    if (!this.canEdit) return;
    this.undoManager.undo();
    this.publish();
  }

  redo() {
    if (!this.canEdit) return;
    this.undoManager.redo();
    this.publish();
  }

  setUser(user) {
    this.user = user;
    this.awareness?.setLocalStateField('user', user);
  }

  setPresence(field, value) {
    this.awareness?.setLocalStateField(field, value);
  }

  publishAwareness() {
    const users = [];
    this.awareness?.getStates().forEach((state, clientId) => {
      if (!state.user) return;
      users.push({ ...state.user, clientId, isLocal: clientId === this.doc.clientID,
        pointer: state.pointer, selectedNodeIds: state.selectedNodeIds });
    });
    this.onAwareness?.(users);
  }

  flush(timeoutMs = 5000) {
    if (!this.hasPendingWrites) return Promise.resolve(true);
    const ws = this.provider?.ws;
    if (!this.provider?.synced || ws?.readyState !== 1) return Promise.resolve(false);
    const version = this.localVersion;
    const requestId = `canvas-${this.doc.clientID}-${crypto.randomUUID()}`;
    return new Promise((resolve) => {
      const finish = (acknowledged) => {
        clearTimeout(timeout);
        this.pendingFlushes.delete(requestId);
        if (acknowledged) this.acknowledgedVersion = Math.max(this.acknowledgedVersion, version);
        resolve(acknowledged && !this.hasPendingWrites);
      };
      const timeout = setTimeout(() => finish(false), timeoutMs);
      this.pendingFlushes.set(requestId, finish);
      try {
        const encoder = encoding.createEncoder();
        encoding.writeVarUint(encoder, MSG_AGENT_FLUSH);
        encoding.writeVarString(encoder, requestId);
        ws.send(encoding.toUint8Array(encoder));
      } catch {
        finish(false);
      }
    });
  }

  async prepareDisconnect() {
    this.disconnecting = true;
    this.publish();
    const ready = await this.flush();
    this.disconnecting = false;
    this.publish();
    return ready;
  }

  destroy() {
    this.destroyed = true;
    globalThis.window?.removeEventListener('offline', this.handleOffline);
    globalThis.window?.removeEventListener('online', this.handleOnline);
    clearTimeout(this.flushTimer);
    [...this.pendingFlushes.values()].forEach((finish) => finish(false));
    this.provider?.destroy();
    this.undoManager.destroy();
    this.doc.destroy();
  }
}
