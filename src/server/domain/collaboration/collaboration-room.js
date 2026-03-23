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
import {
  isExcalidrawRoomDocStructured,
  migrateLegacyExcalidrawRoomData,
  readLegacyExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
  serializeExcalidrawRoomScene,
  tryParseExcalidrawSceneJson,
} from '../../../domain/excalidraw-room-codec.js';
import { isDrawioLeaseRoom } from '../../../domain/drawio-room.js';
import { normalizeWorkspaceEvent } from '../../../domain/workspace-change.js';
import { WORKSPACE_EVENT_MAX_MESSAGES, WORKSPACE_ROOM_NAME } from '../../../domain/workspace-room.js';

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

function isExcalidrawRoom(name) {
  return typeof name === 'string' && name.endsWith('.excalidraw');
}

function isWorkspaceRoom(name) {
  return name === WORKSPACE_ROOM_NAME;
}

function computeTextReplacement(currentContent, nextContent) {
  const currentText = String(currentContent ?? '');
  const nextText = String(nextContent ?? '');
  if (currentText === nextText) {
    return null;
  }

  let prefixLength = 0;
  const maxPrefix = Math.min(currentText.length, nextText.length);
  while (prefixLength < maxPrefix && currentText[prefixLength] === nextText[prefixLength]) {
    prefixLength += 1;
  }

  let currentSuffixLength = currentText.length;
  let nextSuffixLength = nextText.length;
  while (
    currentSuffixLength > prefixLength
    && nextSuffixLength > prefixLength
    && currentText[currentSuffixLength - 1] === nextText[nextSuffixLength - 1]
  ) {
    currentSuffixLength -= 1;
    nextSuffixLength -= 1;
  }

  return {
    deleteCount: currentSuffixLength - prefixLength,
    insertText: nextText.slice(prefixLength, nextSuffixLength),
    start: prefixLength,
  };
}

export class CollaborationRoom {
  constructor({
    documentStore = null,
    getHydrateDelayMs = null,
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
    this.getHydrateDelayMs = getHydrateDelayMs;
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
    this.debugMetrics = {
      hydrateCount: 0,
      initialSyncCount: 0,
      lastHydrate: null,
      lastInitialSyncAt: 0,
    };
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
        const startedAt = Date.now();
        let hydrateSource = 'empty';
        let snapshotExists = false;
        let snapshotValid = false;
        let commentThreadCount = 0;
        const hydrateDelayMs = Math.max(0, Number(this.getHydrateDelayMs?.() || 0));

        try {
          if (hydrateDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, hydrateDelayMs));
          }

          if (this.documentStore?.hasPersistence()) {
            const snapshot = await this.documentStore.readSnapshot();
            if (snapshot) {
              snapshotExists = true;
              try {
                if (isExcalidrawRoom(this.name)) {
                  const validationDoc = new Y.Doc({ gc: true });
                  try {
                    Y.applyUpdate(validationDoc, snapshot, 'hydrate');
                    if (!this.ensureStructuredExcalidrawState(validationDoc)) {
                      throw new Error('snapshot did not contain a valid structured Excalidraw scene');
                    }

                    Y.applyUpdate(this.doc, Y.encodeStateAsUpdate(validationDoc), 'hydrate');
                  } finally {
                    validationDoc.destroy();
                  }
                } else {
                  Y.applyUpdate(this.doc, snapshot, 'hydrate');
                }

                snapshotValid = true;
                hydrateSource = 'snapshot';
                this.hydrated = true;
                return;
              } catch (error) {
                console.warn(
                  `[room:${this.name}] Discarding invalid collaboration snapshot: ${error.message}`,
                );
                await this.documentStore.deleteSnapshot?.();
              }
            }

            const [content, commentThreads] = await Promise.all([
              this.documentStore.readContent(),
              this.documentStore.readCommentThreads(),
            ]);
            commentThreadCount = commentThreads.length;
            if (content !== null || commentThreads.length > 0) {
              hydrateSource = 'content';
              const ytext = this.doc.getText('codemirror');
              const comments = this.doc.getArray('comments');
              this.doc.transact(() => {
                if (isExcalidrawRoom(this.name)) {
                  const parsedScene = tryParseExcalidrawSceneJson(content);
                  if (parsedScene) {
                    migrateLegacyExcalidrawRoomData(this.doc, parsedScene);
                  } else if (content !== null) {
                    ytext.insert(0, content);
                  }
                } else if (content !== null) {
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
        } finally {
          if (this.hydrated) {
            this.debugMetrics.hydrateCount += 1;
            this.debugMetrics.lastHydrate = {
              commentThreadCount,
              durationMs: Date.now() - startedAt,
              snapshotExists,
              snapshotValid,
              source: hydrateSource,
            };
            console.info(
              `[perf][room:${this.name}] hydrate durationMs=${this.debugMetrics.lastHydrate.durationMs} source=${this.debugMetrics.lastHydrate.source} snapshotExists=${this.debugMetrics.lastHydrate.snapshotExists} snapshotValid=${this.debugMetrics.lastHydrate.snapshotValid} commentThreads=${this.debugMetrics.lastHydrate.commentThreadCount}`,
            );
          }
        }
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

      if (origin !== 'hydrate' && origin !== 'workspace-reconcile') {
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

    const previousPersistPromise = this.activePersistPromise;
    const persistPromise = (async () => {
      await previousPersistPromise?.catch(() => {});
      if (!this.documentStore?.hasPersistence() || this.deleted) {
        return;
      }

      const content = this.getPersistedContent();
      if (content === null) {
        console.warn(`[room:${this.name}] Skipping persist because the Excalidraw scene is invalid`);
        return;
      }
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

  async reloadFromDisk() {
    if (!this.documentStore?.hasPersistence() || this.deleted || this.destroyed) {
      return false;
    }

    const [content, commentThreads] = await Promise.all([
      this.documentStore.readContent(),
      this.documentStore.readCommentThreads(),
    ]);
    if (content === null) {
      this.markDeleted();
      await this.destroy();
      return false;
    }

    return this.applyExternalContent(content, {
      commentThreads,
      replaceCommentThreads: true,
    });
  }

  async applyExternalContent(content, {
    commentThreads = [],
    replaceCommentThreads = false,
  } = {}) {
    if (this.deleted || this.destroyed) {
      return { ok: false, reason: 'room-unavailable' };
    }

    const comments = this.doc.getArray('comments');
    if (isExcalidrawRoom(this.name)) {
      const parsedExcalidrawScene = tryParseExcalidrawSceneJson(content);
      if (!parsedExcalidrawScene) {
        return { ok: false, reason: 'invalid-excalidraw' };
      }

      this.doc.transact(() => {
        replaceExcalidrawRoomScene(this.doc, parsedExcalidrawScene);
        if (replaceCommentThreads) {
          if (comments.length > 0) {
            comments.delete(0, comments.length);
          }
          populateCommentThreads(comments, commentThreads);
        }
      }, 'workspace-reconcile');

      return { ok: true, highlightRange: null };
    }

    const ytext = this.doc.getText('codemirror');
    const replacement = computeTextReplacement(ytext.toString(), content);
    if (!replacement && !replaceCommentThreads) {
      return { highlightRange: null, ok: true, skipped: true };
    }

    this.doc.transact(() => {
      if (replacement?.deleteCount) {
        ytext.delete(replacement.start, replacement.deleteCount);
      }
      if (replacement?.insertText) {
        ytext.insert(replacement.start, replacement.insertText);
      }
      if (replaceCommentThreads) {
        if (comments.length > 0) {
          comments.delete(0, comments.length);
        }
        populateCommentThreads(comments, commentThreads);
      }
    }, 'workspace-reconcile');

    return {
      highlightRange: replacement
        ? {
          from: replacement.start,
          to: replacement.start + replacement.insertText.length,
        }
        : null,
      ok: true,
    };
  }

  applyExternalDeletion() {
    this.markDeleted();
    return this.destroy();
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
    this.debugMetrics.initialSyncCount += 1;
    this.debugMetrics.lastInitialSyncAt = Date.now();
    console.info(`[perf][room:${this.name}] send-initial-sync count=${this.debugMetrics.initialSyncCount}`);
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

    this.clearEphemeralExcalidrawHistory();
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

  clearEphemeralExcalidrawHistory() {
    if (!isExcalidrawRoom(this.name)) {
      return;
    }

    const historyEntries = this.doc.getArray('excalidraw-history');
    const historyState = this.doc.getMap('excalidraw-history-state');
    const hasHistoryEntries = historyEntries.length > 0;
    const hasHistoryState = historyState.size > 0;

    if (!hasHistoryEntries && !hasHistoryState) {
      return;
    }

    this.doc.transact(() => {
      if (historyEntries.length > 0) {
        historyEntries.delete(0, historyEntries.length);
      }

      Array.from(historyState.keys()).forEach((key) => {
        historyState.delete(key);
      });
    }, 'excalidraw-history-reset');
  }

  ensureStructuredExcalidrawState(doc = this.doc) {
    if (!isExcalidrawRoom(this.name)) {
      return true;
    }

    if (isExcalidrawRoomDocStructured(doc)) {
      return true;
    }

    const legacyScene = readLegacyExcalidrawRoomScene(doc);
    if (!legacyScene) {
      return false;
    }

    doc.transact(() => {
      migrateLegacyExcalidrawRoomData(doc, legacyScene);
    }, 'hydrate');
    return true;
  }

  getPersistedContent() {
    if (isWorkspaceRoom(this.name)) {
      return null;
    }

    if (isDrawioLeaseRoom(this.name)) {
      return null;
    }

    if (!isExcalidrawRoom(this.name)) {
      return this.doc.getText('codemirror').toString();
    }

    if (isExcalidrawRoomDocStructured(this.doc)) {
      return serializeExcalidrawRoomScene(this.doc);
    }

    const legacyScene = readLegacyExcalidrawRoomScene(this.doc);
    if (!legacyScene) {
      return null;
    }

    return JSON.stringify(legacyScene);
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

  replaceWorkspaceEntries(entries = new Map(), {
    generatedAt = Date.now(),
  } = {}) {
    if (!isWorkspaceRoom(this.name)) {
      return false;
    }

    const normalizedEntries = entries instanceof Map ? entries : new Map(entries);
    const entriesMap = this.doc.getMap('entries');
    const metaMap = this.doc.getMap('meta');

    this.doc.transact(() => {
      Array.from(entriesMap.keys()).forEach((key) => {
        if (!normalizedEntries.has(key)) {
          entriesMap.delete(key);
        }
      });

      normalizedEntries.forEach((entry, pathValue) => {
        entriesMap.set(pathValue, entry);
      });

      metaMap.set('lastSnapshotAt', generatedAt);
      metaMap.set('revision', Number(metaMap.get('revision') || 0) + 1);
    }, 'workspace-room-entries');

    return true;
  }

  applyWorkspaceEntryPatch({
    deletes = [],
    upserts = new Map(),
  } = {}, {
    generatedAt = Date.now(),
  } = {}) {
    if (!isWorkspaceRoom(this.name)) {
      return false;
    }

    const normalizedUpserts = upserts instanceof Map ? upserts : new Map(upserts);
    const normalizedDeletes = Array.from(new Set((deletes ?? []).filter(Boolean)));
    if (normalizedUpserts.size === 0 && normalizedDeletes.length === 0) {
      return false;
    }

    const entriesMap = this.doc.getMap('entries');
    const metaMap = this.doc.getMap('meta');

    this.doc.transact(() => {
      normalizedDeletes.forEach((pathValue) => {
        entriesMap.delete(pathValue);
      });

      normalizedUpserts.forEach((entry, pathValue) => {
        entriesMap.set(pathValue, entry);
      });

      metaMap.set('lastSnapshotAt', generatedAt);
      metaMap.set('revision', Number(metaMap.get('revision') || 0) + 1);
    }, 'workspace-room-entry-patch');

    return true;
  }

  publishWorkspaceEvent(event) {
    if (!isWorkspaceRoom(this.name)) {
      return null;
    }

    const normalizedEvent = normalizeWorkspaceEvent(event);
    if (!normalizedEvent) {
      return null;
    }

    const events = this.doc.getArray('events');
    const metaMap = this.doc.getMap('meta');
    this.doc.transact(() => {
      events.push([normalizedEvent]);
      const overflow = events.length - WORKSPACE_EVENT_MAX_MESSAGES;
      if (overflow > 0) {
        events.delete(0, overflow);
      }
      metaMap.set('lastEventAt', normalizedEvent.createdAt);
      metaMap.set('revision', Number(metaMap.get('revision') || 0) + 1);
    }, 'workspace-room-event');

    return normalizedEvent;
  }
}
