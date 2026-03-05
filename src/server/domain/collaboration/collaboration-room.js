import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { MSG_AWARENESS, MSG_SYNC } from './protocol.js';

function closeSlowClient(ws, { maxBufferedAmountBytes, name }) {
  if (ws.backpressureCloseIssued) {
    return false;
  }

  ws.backpressureCloseIssued = true;
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
  if (ws.readyState !== ws.OPEN) {
    return false;
  }

  if (ws.bufferedAmount > maxBufferedAmountBytes) {
    return closeSlowClient(ws, { maxBufferedAmountBytes, name });
  }

  ws.send(payload, (error) => {
    if (error) {
      console.error(`[room:${name}] Failed to send websocket frame:`, error.message);
    }
  });

  if (ws.bufferedAmount > maxBufferedAmountBytes) {
    return closeSlowClient(ws, { maxBufferedAmountBytes, name });
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
  constructor({ name, maxBufferedAmountBytes, vaultFileStore, backlinkIndex, onEmpty }) {
    this.name = name;
    this.maxBufferedAmountBytes = maxBufferedAmountBytes;
    this.vaultFileStore = vaultFileStore;
    this.backlinkIndex = backlinkIndex;
    this.onEmpty = onEmpty;
    this.doc = new Y.Doc({ gc: true });
    this.awareness = new awarenessProtocol.Awareness(this.doc);
    this.clients = new Set();
    this.hydrated = false;
    this.hydratePromise = null;
    this.persistTimer = null;

    this.awareness.setLocalState(null);
    this.registerDocListeners();
  }

  async hydrate() {
    if (this.hydrated) {
      return;
    }

    if (!this.hydratePromise) {
      this.hydratePromise = (async () => {
        try {
          if (this.vaultFileStore) {
            const content = await this.vaultFileStore.readMarkdownFile(this.name);
            if (content !== null) {
              const ytext = this.doc.getText('codemirror');
              this.doc.transact(() => {
                ytext.insert(0, content);
              }, 'hydrate');
            }
          }
        } catch (error) {
          console.error(`[room:${this.name}] Failed to hydrate from disk: ${error.message}`);
        } finally {
          this.hydrated = true;
        }
      })();
    }

    await this.hydratePromise;
  }

  registerDocListeners() {
    this.doc.on('update', (update, origin) => {
      if (origin !== 'hydrate') {
        this.schedulePersist();
      }

      const encoder = encoding.createEncoder();
      encoding.writeVarUint(encoder, MSG_SYNC);
      syncProtocol.writeUpdate(encoder, update);
      const message = encoding.toUint8Array(encoder);

      for (const client of this.clients) {
        if (client !== origin) {
          try {
            sendMessage(client, message, this);
          } catch (error) {
            console.error(`[room:${this.name}] Failed to broadcast sync update:`, error.message);
          }
        }
      }
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

      for (const client of this.clients) {
        try {
          sendMessage(client, message, this);
        } catch (error) {
          console.error(`[room:${this.name}] Failed to broadcast awareness update:`, error.message);
        }
      }
    });
  }

  schedulePersist() {
    if (!this.vaultFileStore) {
      return;
    }

    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persist().catch((error) => {
        console.error(`[room:${this.name}] Failed to persist document:`, error.message);
      });
    }, 500);
  }

  async persist() {
    if (!this.vaultFileStore) {
      return;
    }

    const content = this.doc.getText('codemirror').toString();
    await this.vaultFileStore.writeMarkdownFile(this.name, content);

    // Keep the backlink index in sync with every save
    if (this.backlinkIndex) {
      this.backlinkIndex.updateFile(this.name, content);
    }
  }

  async addClient(ws) {
    await this.hydrate();

    ws.controlledClientIds = new Set();
    this.clients.add(ws);

    const syncEncoder = encoding.createEncoder();
    encoding.writeVarUint(syncEncoder, MSG_SYNC);
    syncProtocol.writeSyncStep1(syncEncoder, this.doc);
    sendMessage(ws, encoding.toUint8Array(syncEncoder), this);

    const awarenessStates = this.awareness.getStates();
    if (awarenessStates.size > 0) {
      const awarenessEncoder = encoding.createEncoder();
      encoding.writeVarUint(awarenessEncoder, MSG_AWARENESS);
      encoding.writeVarUint8Array(
        awarenessEncoder,
        awarenessProtocol.encodeAwarenessUpdate(this.awareness, Array.from(awarenessStates.keys())),
      );
      sendMessage(ws, encoding.toUint8Array(awarenessEncoder), this);
    }
  }

  removeClient(ws) {
    if (ws.controlledClientIds?.size) {
      awarenessProtocol.removeAwarenessStates(this.awareness, Array.from(ws.controlledClientIds), ws);
      ws.controlledClientIds.clear();
    }

    this.clients.delete(ws);

    if (this.clients.size > 0) {
      return;
    }

    clearTimeout(this.persistTimer);
    void this.persist().catch((error) => {
      console.error(`[room:${this.name}] Failed to persist final room state:`, error.message);
    });

    this.awareness.destroy();
    this.doc.destroy();
    this.onEmpty?.(this.name);
  }

  handleMessage(ws, rawData) {
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
            sendMessage(ws, encoding.toUint8Array(encoder), this);
          }
          break;
        }

        case MSG_AWARENESS: {
          const update = decoding.readVarUint8Array(decoder);
          const entries = readAwarenessEntries(update);

          for (const entry of entries) {
            if (entry.state === null) {
              ws.controlledClientIds.delete(entry.clientId);
            } else {
              ws.controlledClientIds.add(entry.clientId);
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
