import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import {
  MSG_AGENT_FLUSH,
  MSG_AGENT_FLUSH_ACK,
  MSG_AWARENESS,
  MSG_SYNC,
} from './protocol.js';
import { CollaborationDocumentStore } from './collaboration-document-store.js';
import { logPerfEvent } from '../../config/perf-logging.js';
import { populateCommentThreads, serializeCommentThreads } from '../../../domain/comment-threads.js';
import { getVaultFileKind } from '../../../domain/file-kind.js';
import {
  applySceneDiffToExcalidrawRoom,
  EXCALIDRAW_APP_STATE_KEY,
  EXCALIDRAW_ELEMENTS_KEY,
  EXCALIDRAW_FILES_KEY,
  isExcalidrawRoomDocStructured,
  migrateLegacyExcalidrawRoomData,
  readLegacyExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
  serializeExcalidrawRoomScene,
  tryParseExcalidrawSceneJson,
} from '../../../domain/excalidraw-room-codec.js';
import { isDrawioLeaseRoom } from '../../../domain/drawio-room.js';
import { normalizeEditableText } from '../../../domain/editable-text.js';
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

function isExpectedSocketSendError(error) {
  const code = String(error?.code || '').toUpperCase();
  const message = String(error?.message || '');

  return code === 'EPIPE'
    || code === 'ECONNRESET'
    || /EPIPE|ECONNRESET|WebSocket is not open|readyState/i.test(message);
}

function cleanupDisconnectedClient(room, ws, clientState) {
  if (clientState?.transportCloseIssued) {
    return false;
  }

  if (clientState) {
    clientState.transportCloseIssued = true;
  }

  room?.removeClient?.(ws);

  try {
    ws.terminate?.();
  } catch {
    // Ignore termination errors while cleaning up disconnected clients.
  }

  return false;
}

function sendMessage(ws, payload, { maxBufferedAmountBytes, name }) {
  const clientState = this?.getClientState?.(ws) ?? null;
  if (ws.readyState !== ws.OPEN) {
    return cleanupDisconnectedClient(this, ws, clientState);
  }

  const bufferedAmountBeforeSend = ws.bufferedAmount;

  if (bufferedAmountBeforeSend > maxBufferedAmountBytes) {
    return closeSlowClient(ws, clientState, { maxBufferedAmountBytes, name });
  }

  ws.send(payload, (error) => {
    if (error) {
      if (isExpectedSocketSendError(error)) {
        cleanupDisconnectedClient(this, ws, clientState);
        return;
      }

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
  return getVaultFileKind(name) === 'excalidraw';
}

function isWorkspaceRoom(name) {
  return name === WORKSPACE_ROOM_NAME;
}


function isContentCleanOrigin(origin) {
  return origin === 'hydrate'
    || origin === 'workspace-reconcile'
    || origin === 'excalidraw-history-reset';
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

function reconcileTextContent(baselineContent, currentContent, externalContent) {
  const localReplacement = computeTextReplacement(baselineContent, currentContent);
  const externalReplacement = computeTextReplacement(baselineContent, externalContent);
  if (!externalReplacement) {
    return { content: currentContent, preservesPendingChanges: true };
  }

  const localEnd = localReplacement.start + localReplacement.deleteCount;
  const externalEnd = externalReplacement.start + externalReplacement.deleteCount;
  let externalStart;
  if (localEnd <= externalReplacement.start) {
    externalStart = externalReplacement.start
      + localReplacement.insertText.length
      - localReplacement.deleteCount;
  } else if (externalEnd <= localReplacement.start) {
    externalStart = externalReplacement.start;
  } else {
    return { content: externalContent, preservesPendingChanges: false };
  }

  return {
    content: currentContent.slice(0, externalStart)
      + externalReplacement.insertText
      + currentContent.slice(externalStart + externalReplacement.deleteCount),
    preservesPendingChanges: true,
  };
}

export class CollaborationRoom {
  constructor({
    documentStore = null,
    getHydrateDelayMs = null,
    name,
    idleGraceMs = 0,
    maxInitialSyncBytes = 16_777_216,
    maxBufferedAmountBytes,
    perfLoggingEnabled = false,
    vaultFileStore,
    backlinkIndex,
    onEmpty,
  }) {
    this.name = name;
    this.idleGraceMs = idleGraceMs;
    this.maxInitialSyncBytes = maxInitialSyncBytes;
    this.maxBufferedAmountBytes = maxBufferedAmountBytes;
    this.perfLoggingEnabled = perfLoggingEnabled;
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
    this.clientStates = new WeakMap();
    this.hydrated = false;
    this.hydratePromise = null;
    this.deleted = false;
    this.destroyed = false;
    this.cachedInitialSyncMessage = null;
    this.activePersistPromise = null;
    this.persistedContentBaseline = null;
    this.contentDirty = false;
    this.debugMetrics = {
      hydrateCount: 0,
      initialSyncCount: 0,
      lastHydrate: null,
      lastInitialSyncAt: 0,
    };
    this.persistTimer = null;
    this.destroyTimer = null;
    this.finalizePromise = null;
    this.shutdownGeneration = 0;

    this.awareness.setLocalState(null);
    this.registerDocListeners();
    this.registerContentDirtyListeners();
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
        let snapshotNeedsReplacement = false;
        let snapshotValid = false;
        let commentThreadCount = 0;
        let snapshotReadDurationMs = 0;
        let contentFallbackDurationMs = 0;
        const hydrateDelayMs = Math.max(0, Number(this.getHydrateDelayMs?.() || 0));

        try {
          if (hydrateDelayMs > 0) {
            await new Promise((resolve) => setTimeout(resolve, hydrateDelayMs));
          }

          if (this.documentStore?.hasPersistence()) {
            const snapshotReadStartedAt = Date.now();
            const snapshot = await this.documentStore.readSnapshot();
            snapshotReadDurationMs = Date.now() - snapshotReadStartedAt;
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
                  `[room:${this.name}] Ignoring invalid collaboration snapshot until durable content is rehydrated: ${error.message}`,
                );
                snapshotNeedsReplacement = true;
              }
            }

            const fallbackStartedAt = Date.now();
            const [content, commentThreads] = await Promise.all([
              this.documentStore.readContent(),
              this.documentStore.readCommentThreads(),
            ]);
            contentFallbackDurationMs = Date.now() - fallbackStartedAt;
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
                  ytext.insert(0, normalizeEditableText(content));
                }
                populateCommentThreads(comments, commentThreads);
              }, 'hydrate');

              const replacementSnapshot = Y.encodeStateAsUpdate(this.doc);
              if (snapshotNeedsReplacement) {
                await this.documentStore.writeSnapshot(replacementSnapshot);
              } else {
                void this.documentStore.writeSnapshot(replacementSnapshot).catch((error) => {
                  console.error(`[room:${this.name}] Failed to prime collaboration snapshot: ${error.message}`);
                });
              }
            }
          }

          this.hydrated = true;
        } finally {
          if (this.hydrated) {
            this.resetContentBaseline();
            this.debugMetrics.hydrateCount += 1;
            this.debugMetrics.lastHydrate = {
              commentThreadCount,
              contentFallbackDurationMs,
              durationMs: Date.now() - startedAt,
              snapshotReadDurationMs,
              snapshotExists,
              snapshotValid,
              source: hydrateSource,
            };
            logPerfEvent(this.perfLoggingEnabled, `room:${this.name}`, {
              commentThreads: this.debugMetrics.lastHydrate.commentThreadCount,
              contentFallbackDurationMs: this.debugMetrics.lastHydrate.contentFallbackDurationMs,
              durationMs: this.debugMetrics.lastHydrate.durationMs,
              event: 'hydrate',
              snapshotExists: this.debugMetrics.lastHydrate.snapshotExists,
              snapshotReadDurationMs: this.debugMetrics.lastHydrate.snapshotReadDurationMs,
              snapshotValid: this.debugMetrics.lastHydrate.snapshotValid,
              source: this.debugMetrics.lastHydrate.source,
            });
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

  registerContentDirtyListeners() {
    const markFromTransaction = (transaction) => {
      if (isContentCleanOrigin(transaction?.origin)) {
        return;
      }

      this.refreshContentDirty();
    };

    if (isExcalidrawRoom(this.name)) {
      this.doc.getMap(EXCALIDRAW_ELEMENTS_KEY).observeDeep((_events, transaction) => {
        markFromTransaction(transaction);
      });
      this.doc.getMap(EXCALIDRAW_FILES_KEY).observe((_event, transaction) => {
        markFromTransaction(transaction);
      });
      this.doc.getMap(EXCALIDRAW_APP_STATE_KEY).observe((_event, transaction) => {
        markFromTransaction(transaction);
      });
      return;
    }

    this.doc.getText('codemirror').observe((_event, transaction) => {
      markFromTransaction(transaction);
    });
  }

  resetContentBaseline() {
    this.persistedContentBaseline = this.getPersistedContent();
    this.contentDirty = false;
  }

  refreshContentDirty() {
    const content = this.getPersistedContent();
    this.contentDirty = content !== null && content !== this.persistedContentBaseline;
    return this.contentDirty;
  }

  getClientState(ws) {
    return this.clientStates.get(ws) ?? null;
  }

  ensureClientState(ws) {
    const existingState = this.getClientState(ws);
    if (existingState) {
      existingState.backpressureCloseIssued = false;
      existingState.transportCloseIssued = false;
      return existingState;
    }

    const state = {
      backpressureCloseIssued: false,
      controlledClientIds: new Set(),
      transportCloseIssued: false,
    };
    this.clientStates.set(ws, state);
    return state;
  }

  deleteClientState(ws) {
    this.clientStates.delete(ws);
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

    clearTimeout(this.persistTimer);
    this.persistTimer = setTimeout(() => {
      this.persist().catch((error) => {
        console.error(`[room:${this.name}] Failed to persist document:`, error.message);
      });
    }, 500);
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
      const includeContent = this.refreshContentDirty();
      const commentThreads = serializeCommentThreads(this.doc.getArray('comments'));
      await this.documentStore.persistState({
        commentThreads,
        content,
        includeContent,
        snapshot: Y.encodeStateAsUpdate(this.doc),
      });
      if (includeContent) {
        this.persistedContentBaseline = content;
        this.refreshContentDirty();
      }
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

      this.resetContentBaseline();
      return { ok: true, highlightRange: null };
    }

    const ytext = this.doc.getText('codemirror');
    const currentContent = ytext.toString();
    const normalizedContent = normalizeEditableText(content);
    const reconciliation = this.refreshContentDirty() && this.persistedContentBaseline !== null
      ? reconcileTextContent(this.persistedContentBaseline, currentContent, normalizedContent)
      : { content: normalizedContent, preservesPendingChanges: false };
    const replacement = computeTextReplacement(currentContent, reconciliation.content);
    const skipped = !replacement && !replaceCommentThreads;
    if (!skipped) {
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
    }

    if (reconciliation.preservesPendingChanges) {
      this.persistedContentBaseline = normalizedContent;
      this.refreshContentDirty();
      this.schedulePersist();
    } else {
      this.resetContentBaseline();
    }
    return {
      highlightRange: replacement
        ? {
          from: replacement.start,
          to: replacement.start + replacement.insertText.length,
        }
        : null,
      ok: true,
      ...(skipped && { skipped: true }),
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

  cancelPersistenceTimers() {
    this.shutdownGeneration += 1;
    clearTimeout(this.persistTimer);
    clearTimeout(this.destroyTimer);
    this.persistTimer = null;
    this.destroyTimer = null;
  }

  markDeleted() {
    this.deleted = true;
    this.cancelPersistenceTimers();
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
    const initialSyncMessage = this.getInitialSyncMessage();
    const initialSyncBytes = initialSyncMessage.byteLength;
    if (initialSyncBytes > this.maxInitialSyncBytes) {
      console.warn(
        `[room:${this.name}] Initial sync payload is ${initialSyncBytes} bytes, exceeding ${this.maxInitialSyncBytes} bytes`,
      );
    }
    logPerfEvent(this.perfLoggingEnabled, `room:${this.name}`, {
      bytes: initialSyncBytes,
      count: this.debugMetrics.initialSyncCount,
      event: 'initial-sync',
      exceedsLimit: initialSyncBytes > this.maxInitialSyncBytes,
    });
    return sendMessage.call(this, ws, initialSyncMessage, this);
  }

  async addClient(ws, { sendInitialSync: shouldSendInitialSync = true } = {}) {
    this.shutdownGeneration += 1;
    clearTimeout(this.destroyTimer);
    this.destroyTimer = null;
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
    this.cancelPersistenceTimers();
    await Promise.allSettled([
      this.finalizePromise,
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
    if (this.clients.size > 0 || this.finalizePromise) {
      return;
    }

    const generation = ++this.shutdownGeneration;
    this.finalizePromise = (async () => {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;

      try {
        await this.persist();
      } catch (error) {
        console.error(`[room:${this.name}] Failed to persist final room state:`, error.message);
      }

      if (this.clients.size > 0 || generation !== this.shutdownGeneration) {
        return;
      }

      this.destroyTimer = setTimeout(() => {
        if (this.clients.size > 0 || generation !== this.shutdownGeneration) {
          return;
        }

        this.awareness.destroy();
        this.doc.destroy();
        this.onEmpty?.(this.name);
      }, this.idleGraceMs);
      this.destroyTimer.unref?.();
    })().finally(() => {
      this.finalizePromise = null;
    });

    return this.finalizePromise;
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

  isHydrated() {
    return this.hydrated;
  }

  readEditableContent() {
    if (!this.hydrated || this.deleted || this.destroyed || isExcalidrawRoom(this.name)) {
      return null;
    }
    return this.doc.getText('codemirror').toString();
  }

  applyExactTextChanges(changes, { origin = 'agent' } = {}) {
    if (!this.hydrated || this.deleted || this.destroyed || isExcalidrawRoom(this.name)) {
      throw new Error('The collaborative document is unavailable');
    }
    const ytext = this.doc.getText('codemirror');
    this.doc.transact(() => {
      for (let index = changes.length - 1; index >= 0; index -= 1) {
        const change = changes[index];
        if (change.to > change.from) {
          ytext.delete(change.from, change.to - change.from);
        }
        if (change.insert) {
          ytext.insert(change.from, change.insert);
        }
      }
    }, origin);
    return changes.length;
  }

  applyExcalidrawScene(scene, { origin = 'agent' } = {}) {
    if (!this.hydrated || this.deleted || this.destroyed || !isExcalidrawRoom(this.name)) {
      throw new Error('The collaborative Excalidraw document is unavailable');
    }
    let changed = false;
    this.doc.transact(() => {
      changed = applySceneDiffToExcalidrawRoom(this.doc, scene);
    }, origin);
    return changed;
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

        case MSG_AGENT_FLUSH: {
          const requestId = decoding.readVarString(decoder);
          if (!requestId || requestId.length > 128) {
            break;
          }

          const encoder = encoding.createEncoder();
          encoding.writeVarUint(encoder, MSG_AGENT_FLUSH_ACK);
          encoding.writeVarString(encoder, requestId);
          sendMessage.call(this, ws, encoding.toUint8Array(encoder), this);
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
