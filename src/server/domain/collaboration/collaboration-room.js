import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { MSG_AWARENESS, MSG_SYNC } from './protocol.js';
import { CollaborationDocumentStore } from './collaboration-document-store.js';
import { RoomClientStateStore } from './room-client-state-store.js';
import { RoomPersistenceController } from './room-persistence-controller.js';
import { populateCommentThreads, serializeCommentThreads } from '../../../domain/comment-threads.js';

function closeSlowClient(ws, clientState, { maxBufferedAmountBytes, name }) {
  if (!clientState || clientState.backpressureCloseIssued) {
    return false;
  }

  clientState.backpressureCloseIssued = true;
  console.warn(
    `[room:${name}] Closing slow client after bufferedAmount=${ws.bufferedAmount} bytes exceeded ${maxBufferedAmountBytes} bytes`,
  );

  try {
    ws.close(1013, 'Client too slow');
  } catch {
    try {
      ws.terminate?.();
    } catch {
      // Ignore termination errors while shedding load.
    }
  }

  return false;
}

function sendMessage(ws, payload, { maxBufferedAmountBytes, name }) {
  const clientState = this?.getClientState?.(ws) ?? null;
  if (ws.readyState !== ws.OPEN) {
    return false;
  }

  const bufferedAmountBeforeSend = ws.bufferedAmount;

  if (bufferedAmountBeforeSend > maxBufferedAmountBytes) {
    return closeSlowClient(ws, clientState, { maxBufferedAmountBytes, name });
  }

  ws.send(payload, (error) => {
    if (error) {
      console.error(`[room:${name}] Failed to send websocket frame:`, error.message);
    }
  });

  if (bufferedAmountBeforeSend > 0 && ws.bufferedAmount > maxBufferedAmountBytes) {
    return closeSlowClient(ws, clientState, { maxBufferedAmountBytes, name });
  }

  return true;
}

function readAwarenessEntries(update) {
  const decoder = decoding.createDecoder(update);
  const count = decoding.readVarUint(decoder);
  const entries = [];

  for (let index = 0; index < count; index += 1) {
    const clientId = decoding.readVarUint(decoder);
    decoding.readVarUint(decoder);
    const state = JSON.parse(decoding.readVarString(decoder));

    entries.push({ clientId, state });
  }

  return entries;
}

export class CollaborationRoom {
  constructor({
    documentStore = null,
    name,
    idleGraceMs = 0,
    maxBufferedAmountBytes,
    vaultFileStore,
    backlinkIndex,
    onEmpty,
  }) {
    this.name = name;
    this.idleGraceMs = idleGraceMs;
    this.maxBufferedAmountBytes = maxBufferedAmountBytes;
    this.documentStore = documentStore ?? new CollaborationDocumentStore({
      backlinkIndex,
      name,
      vaultFileStore,
    });
    this.onEmpty = onEmpty;
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.clients = new Set();
    this.clientStates = new RoomClientStateStore();
    this.hydrated = false;
    this.hydratePromise = null;
    this.deleted = false;
    this.destroyed = false;
    this.cachedInitialSyncMessage = null;
    this.activePersistPromise = null;
    this.persistence = new RoomPersistenceController({
      idleGraceMs: this.idleGraceMs,
      onDestroy: () => {
        this.awareness.destroy();
        this.doc.destroy();
        this.onEmpty?.(this.name);
      },
      onPersist: () => this.persist(),
    });

    this.awareness.setLocalState(null);
    this.registerDocListeners();
  }

  async hydrate() {
    if (this.hydrated) {
      return;
    }

    if (!this.hydratePromise) {
      this.hydratePromise = (async () => {
        if (this.documentStore?.hasPersistence()) {
          const snapshot = await this.documentStore.readSnapshot();
          if (snapshot) {
            Y.applyUpdate(this.doc, snapshot, 'hydrate');
            this.hydrated = true;
            return;
          }

          const [content, commentThreads] = await Promise.all([
            this.documentStore.readContent(),
            this.documentStore.readCommentThreads(),
          ]);
          if (content !== null || commentThreads.length > 0) {
            const ytext = this.doc.getText('codemirror');
            const comments = this.doc.getArray('comments');
            this.doc.transact(() => {
              if (content !== null) {
                ytext.insert(0, content);
              }
              populateCommentThreads(comments, commentThreads);
            }, 'hydrate');

            void this.documentStore.writeSnapshot(Y.encodeStateAsUpdate(this.doc)).catch((error) => {
              console.error(`[room:${this.name}] Failed to prime collaboration snapshot: ${error.message}`);
            });
          }
        }

        this.hydrated = true;
      })().catch((error) => {
        this.hydratePromise = null;
        console.error(`[room:${this.name}] Failed to hydrate from disk: ${error.message}`);
        throw error;
      });
    }

    await this.hydratePromise;
  }

  registerDocListeners() {
    this.doc.on('update', (update, origin) => {
      this.cachedInitialSyncMessage = null;

      if (origin !== 'hydrate') {
        this.schedulePersist();
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      this.broadcastToClients(message, { excludeClient: origin, failureLabel: 'sync update' });
    });

    this.awareness.on('update', ({ added, updated, removed }) => {
      const changedClientIds = added.concat(updated, removed);

      if (changedClientIds.length === 0) {
        return;
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        encoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, changedClientIds),
      );
      const message = encoding.toUint8Array(encoder);

      this.broadcastToClients(message, { failureLabel: 'awareness update' });
    });
  }

  getClientState(ws) {
    return this.clientStates.get(ws);
  }

  ensureClientState(ws) {
    const existingState = this.getClientState(ws);
    if (existingState) {
      existingState.backpressureCloseIssued = false;
      return existingState;
    }

    return this.clientStates.register(ws);
  }

  deleteClientState(ws) {
    this.clientStates.unregister(ws);
  }

  broadcastToClients(message, { excludeClient = null, failureLabel = 'frame' } = {}) {
    for (const client of this.clients) {
      if (client === excludeClient) {
        continue;
      }

      try {
        sendMessage.call(this, client, message, this);
      } catch (error) {
        console.error(`[room:${this.name}] Failed to broadcast ${failureLabel}:`, error.message);
      }
    }
  }

  schedulePersist() {
    if (!this.documentStore?.hasPersistence()) {
      return;
    }

    this.persistence.schedulePersist(async () => {
      this.persist().catch((error) => {
        console.error(`[room:${this.name}] Failed to persist document:`, error.message);
      });
    });
  }

  async persist() {
    if (!this.documentStore?.hasPersistence() || this.deleted) {
      return;
    }

    const persistPromise = (async () => {
      const content = this.doc.getText('codemirror').toString();
      const commentThreads = serializeCommentThreads(this.doc.getArray('comments'));
      await this.documentStore.persistState({
        commentThreads,
        content,
        snapshot: Y.encodeStateAsUpdate(this.doc),
      });
    })();

    const trackedPromise = persistPromise.finally(() => {
      if (this.activePersistPromise === trackedPromise) {
        this.activePersistPromise = null;
      }
    });
    this.activePersistPromise = trackedPromise;
    await trackedPromise;
  }

  rename(nextName) {
    if (!nextName || nextName === this.name) {
      return;
    }

    this.name = nextName;
    this.documentStore?.rename(nextName);
  }

  markDeleted() {
    this.deleted = true;
    this.persistence.cancelAll();
    if (this.clients.size === 0) {
      this.finalizeIfIdle();
    }
  }

  unmarkDeleted() {
    this.deleted = false;
  }

  isDeleted() {
    return this.deleted;
  }

  getInitialSyncMessage() {
    if (this.cachedInitialSyncMessage) {
      return this.cachedInitialSyncMessage;
    }

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    encoding.writeVarUint(syncEncoder, syncProtocol.messageYjsSyncStep2);
    encoding.writeVarUint8Array(syncEncoder, Y.encodeStateAsUpdate(this.doc));
    this.cachedInitialSyncMessage = encoding.toUint8Array(syncEncoder);
    return this.cachedInitialSyncMessage;
  }

  sendInitialSync(ws) {
    return sendMessage.call(this, ws, this.getInitialSyncMessage(), this);
  }

  async addClient(ws, { sendInitialSync: shouldSendInitialSync = true } = {}) {
    this.persistence.markActivity();
    await this.hydrate();

    this.ensureClientState(ws);
    this.clients.add(ws);

    if (shouldSendInitialSync) {
      this.sendInitialSync(ws);
    }

    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(awarenessStates.keys())),
      );
      sendMessage.call(this, ws, encoding.toUint8Array(awarenessEncoder), this);
    }
  }

  removeClient(ws) {
    if (this.destroyed) {
      this.clients.delete(ws);
      this.deleteClientState(ws);
      return;
    }

    const clientState = this.getClientState(ws);
    if (clientState?.controlledClientIds.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(clientState.controlledClientIds), ws);
      clientState.controlledClientIds.clear();
    }

    this.clients.delete(ws);
    this.deleteClientState(ws);

    if (this.clients.size > 0) {
      return;
    }

    this.finalizeIfIdle();
  }

  async destroy() {
    if (this.destroyed) {
      return;
    }

    this.destroyed = true;
    this.persistence.cancelAll();
    await Promise.allSettled([
      this.persistence.finalizePromise,
      this.activePersistPromise,
    ]);

    for (const client of this.clients) {
      try {
        client.close(1001, 'Room reset');
      } catch {
        try {
          client.terminate?.();
        } catch {
          // Ignore shutdown errors while force-resetting rooms.
        }
      }
    }

    this.clients.clear();
    this.awareness.destroy();
    this.doc.destroy();
  }

  finalizeIfIdle() {
    return this.persistence.finalizeIfIdle({
      isIdle: () => this.clients.size === 0,
      onPersistError: (error) => {
        console.error(`[room:${this.name}] Failed to persist final room state:`, error.message);
      },
    });
  }

  handleMessage(ws, rawData) {
    if (this.destroyed) {
      return;
    }

    const message = new Uint8Array(rawData);

    try {
      const decoder = decoding.createDecoder(message);
      const messageType = decoding.readVarUint(decoder);

      switch (messageType) {
        case MSG_SYNC: {
          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_SYNC);
          syncProtocol.readSyncMessage(decoder, encoder, this.doc, ws);

          if (encoding.length(encoder) > 1) {
            sendMessage.call(this, ws, encoding.toUint8Array(encoder), this);
          }
          break;
        }

        case MSG_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          const entries = readAwarenessEntries(update);
          const clientState = this.ensureClientState(ws);

          for (const entry of entries) {
            if (entry.state === null) {
              clientState.controlledClientIds.delete(entry.clientId);
            } else {
              clientState.controlledClientIds.add(entry.clientId);
            }
          }

          awarenessProtocol.applyAwarenessUpdate(this.awareness, update, ws);
          break;
        }

        default:
          console.warn(`[room:${this.name}] Unsupported message type: ${messageType}`);
      }
    } catch (error) {
      console.error(`[room:${this.name}] Failed to handle message:`, error.message);
    }
  }
}
