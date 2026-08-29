import test from 'node:test';
import assert from 'node:assert/strict';

import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';
import { RoomRegistry } from '../../src/server/domain/collaboration/room-registry.js';
import { createCommentThreadSharedType } from '../../src/domain/comment-threads.js';
import {
  EXCALIDRAW_META_KEY,
  EXCALIDRAW_SCHEMA_VERSION_KEY,
  buildExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
} from '../../src/domain/excalidraw-room-codec.js';

function createSocket({ bufferedAmount = 0 } = {}) {
  return {
    OPEN: 1,
    backpressureCloseIssued: false,
    bufferedAmount,
    closeCalls: [],
    readyState: 1,
    sent: [],
    send(payload, callback) {
      this.sent.push(payload);
      callback?.();
    },
    close(code, reason) {
      this.closeCalls.push({ code, reason });
      this.readyState = 2;
    },
    terminate() {
      this.readyState = 3;
    },
  };
}

function getSyncSubmessageType(payload) {
  const decoder = decoding.createDecoder(payload);
  const messageType = decoding.readVarUint(decoder);
  assert.equal(messageType, 0);
  return decoding.readVarUint(decoder);
}

test('CollaborationRoom hydrates once for concurrent joins', async () => {
  let readCount = 0;
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'hydration-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        readCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return '# persisted';
      },
      async persistCollaborationState() {},
    },
  });

  await Promise.all([room.addClient(createSocket()), room.addClient(createSocket())]);

  assert.equal(readCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), '# persisted');
});

test('CollaborationRoom retries hydration after a transient read failure', async () => {
  let readCount = 0;
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'retry-hydration-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        readCount += 1;
        if (readCount === 1) {
          throw new Error('temporary read failure');
        }

        return '# recovered';
      },
      async persistCollaborationState() {},
    },
  });

  await assert.rejects(room.hydrate(), /temporary read failure/);
  assert.equal(room.hydrated, false);

  await room.hydrate();

  assert.equal(readCount, 2);
  assert.equal(room.doc.getText('codemirror').toString(), '# recovered');
});

test('CollaborationRoom normalizes CRLF in memory without rewriting open-only content', async () => {
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'crlf.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return '# Title\r\n\r\nBody\r\n';
      },
      async persistCollaborationState(path, { content, ...options }) {
        if (options.includeContent) writes.push({ content, options, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  assert.equal(room.doc.getText('codemirror').toString(), '# Title\n\nBody\n');

  await room.persist();

  assert.equal(writes.length, 0);
});

test('CollaborationRoom writes LF content after an intentional text edit', async () => {
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'edited-crlf.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return '# Title\r\n\r\nBody\r\n';
      },
      async persistCollaborationState(path, { content, ...options }) {
        if (options.includeContent) writes.push({ content, options, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  room.doc.getText('codemirror').insert(room.doc.getText('codemirror').length, '\nEdited\n');
  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].content, '# Title\n\nBody\n\nEdited\n');
  assert.equal(writes[0].options?.includeContent, true);
});

test('CollaborationRoom skips content write when text returns to the in-memory baseline before persist', async () => {
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'undo-before-persist.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return '# Title\r\n';
      },
      async persistCollaborationState(path, { content, ...options }) {
        if (options.includeContent) writes.push({ content, options, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  const ytext = room.doc.getText('codemirror');
  ytext.insert(ytext.length, 'Draft');
  ytext.delete(ytext.length - 'Draft'.length, 'Draft'.length);
  await room.persist();

  assert.equal(writes.length, 0);
});

test('CollaborationRoom closes slow clients when buffered writes exceed the limit', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 4,
    name: 'backpressure-room',
    onEmpty: () => {},
    vaultFileStore: null,
  });

  const origin = createSocket();
  const slowClient = createSocket();

  await room.addClient(origin);
  await room.addClient(slowClient);

  const sentCountBeforeBroadcast = slowClient.sent.length;
  slowClient.bufferedAmount = 10;

  const clientDoc = new Y.Doc();
  clientDoc.getText('codemirror').insert(0, 'hello');
  Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(clientDoc), origin);

  assert.equal(slowClient.sent.length, sentCountBeforeBroadcast);
  assert.equal(slowClient.closeCalls.length, 1);
  assert.deepEqual(slowClient.closeCalls[0], {
    code: 1013,
    reason: 'Client too slow',
  });
});

test('CollaborationRoom allows a single oversized initial sync frame from an empty buffer', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 4,
    name: 'initial-sync-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return 'x'.repeat(2048);
      },
      async persistCollaborationState() {},
    },
  });

  const client = createSocket();
  client.send = function send(payload, callback) {
    this.sent.push(payload);
    this.bufferedAmount = payload.byteLength;
    callback?.();
  };

  await room.addClient(client);

  assert.equal(client.sent.length, 1);
  assert.equal(getSyncSubmessageType(client.sent[0]), syncProtocol.messageYjsSyncStep2);
  assert.equal(client.closeCalls.length, 0);
});

test('CollaborationRoom cleans up disconnected clients after expected socket send errors', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'broken-pipe-room',
    onEmpty: () => {},
    vaultFileStore: null,
  });

  const origin = createSocket();
  const disconnectedClient = createSocket();
  disconnectedClient.terminateCalls = 0;
  disconnectedClient.terminate = function terminate() {
    this.terminateCalls += 1;
    this.readyState = 3;
  };
  disconnectedClient.send = function send(payload, callback) {
    this.sent.push(payload);
    callback?.(Object.assign(new Error('write EPIPE'), { code: 'EPIPE' }));
  };

  await room.addClient(origin);
  await room.addClient(disconnectedClient);

  const clientDoc = new Y.Doc();
  clientDoc.getText('codemirror').insert(0, 'hello');
  Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(clientDoc), origin);

  assert.equal(disconnectedClient.terminateCalls, 1);
  assert.equal(room.clients.has(disconnectedClient), false);
});

test('CollaborationRoom primes a collaboration snapshot after content hydration when none exists', async () => {
  const snapshotWrites = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'snapshot-prime.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readCollaborationSnapshot() {
        return null;
      },
      async readCommentThreads() {
        return [];
      },
      async readEditableVaultContent() {
        return '# Primed\n';
      },
      async writeCollaborationSnapshot(path, snapshot) {
        snapshotWrites.push({ path, snapshot });
        return { ok: true };
      },
      async persistCollaborationState() {},
    },
  });

  await room.hydrate();
  await Promise.resolve();

  assert.equal(room.doc.getText('codemirror').toString(), '# Primed\n');
  assert.equal(snapshotWrites.length, 1);
  assert.equal(snapshotWrites[0].path, 'snapshot-prime.md');
  assert.equal(snapshotWrites[0].snapshot instanceof Uint8Array, true);
});

test('CollaborationRoom replaces an invalid snapshot only after rebuilding persisted content', async () => {
  const snapshotWrites = [];
  let deletedSnapshotPath = null;
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'broken-snapshot.excalidraw',
    onEmpty: () => {},
    vaultFileStore: {
      async readCollaborationSnapshot() {
        return Uint8Array.from([1]);
      },
      async deleteCollaborationSnapshot(path) {
        deletedSnapshotPath = path;
        return { ok: true };
      },
      async readCommentThreads() {
        return [];
      },
      async readEditableVaultContent() {
        return '{"type":"excalidraw","version":2,"source":"collabmd","elements":[],"appState":{"gridSize":20,"viewBackgroundColor":"#ffffff"},"files":{}}';
      },
      async writeCollaborationSnapshot(path, snapshot) {
        snapshotWrites.push({ path, snapshot });
        return { ok: true };
      },
      async persistCollaborationState() {},
    },
  });

  await room.hydrate();
  await Promise.resolve();

  assert.equal(deletedSnapshotPath, null);
  assert.deepEqual(buildExcalidrawRoomScene(room.doc), {
    appState: { gridSize: 20, viewBackgroundColor: '#ffffff' },
    elements: [],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  assert.equal(snapshotWrites.length, 1);
  assert.equal(snapshotWrites[0].path, 'broken-snapshot.excalidraw');
  assert.equal(snapshotWrites[0].snapshot instanceof Uint8Array, true);
});

test('CollaborationRoom rejects an incompatible Excalidraw snapshot schema and rehydrates from the durable file', async () => {
  const staleDoc = new Y.Doc();
  replaceExcalidrawRoomScene(staleDoc, {
    appState: {},
    elements: [{ id: 'stale-shape', type: 'rectangle', version: 1, versionNonce: 1 }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  staleDoc.getMap(EXCALIDRAW_META_KEY).set(EXCALIDRAW_SCHEMA_VERSION_KEY, 999);
  const snapshotWrites = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'incompatible-snapshot.excalidraw',
    onEmpty: () => {},
    vaultFileStore: {
      async readCollaborationSnapshot() {
        return Y.encodeStateAsUpdate(staleDoc);
      },
      async readCommentThreads() {
        return [];
      },
      async readEditableVaultContent() {
        return JSON.stringify({
          appState: {},
          elements: [{ id: 'durable-shape', type: 'rectangle', version: 2, versionNonce: 2 }],
          files: {},
          source: 'collabmd',
          type: 'excalidraw',
          version: 2,
        });
      },
      async writeCollaborationSnapshot(path, snapshot) {
        snapshotWrites.push({ path, snapshot });
        return { ok: true };
      },
      async persistCollaborationState() {},
    },
  });

  await room.hydrate();

  assert.deepEqual(buildExcalidrawRoomScene(room.doc).elements.map((element) => element.id), ['durable-shape']);
  assert.equal(snapshotWrites.length, 1);
  assert.equal(snapshotWrites[0].path, 'incompatible-snapshot.excalidraw');
  staleDoc.destroy();
  await room.destroy();
});

test('CollaborationRoom reloads live room content from disk without scheduling a persist', async (t) => {
  let readCount = 0;
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'reload.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readCollaborationSnapshot() {
        return null;
      },
      async readCommentThreads() {
        return [];
      },
      async readEditableVaultContent() {
        readCount += 1;
        return readCount === 1 ? '# Before\n' : '# After\n';
      },
      async persistCollaborationState(path, { content }) {
        writes.push({ content, path });
      },
    },
  });

  t.after(() => room.destroy());
  await room.hydrate();
  assert.equal(room.doc.getText('codemirror').toString(), '# Before\n');

  await room.reloadFromDisk();

  assert.equal(room.doc.getText('codemirror').toString(), '# After\n');
  assert.deepEqual(writes, []);
});

test('CollaborationRoom preserves pending edits when external content changes elsewhere', async (t) => {
  const initial = '## A\nalpha\n\n## B\nbravo\n\n## C\ncharlie\n';
  let diskContent = initial;
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'concurrent.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readCollaborationSnapshot() {
        return null;
      },
      async readCommentThreads() {
        return [];
      },
      async readEditableVaultContent() {
        return diskContent;
      },
      async persistCollaborationState(_path, state) {
        writes.push(state);
      },
    },
  });

  t.after(() => room.destroy());
  await room.hydrate();
  const ytext = room.doc.getText('codemirror');
  ytext.insert(ytext.toString().indexOf('alpha') + 'alpha'.length, ' HUMAN');
  diskContent = initial.replace('charlie', 'charlie EXTERNAL');

  await room.reloadFromDisk();
  await room.persist();

  assert.equal(ytext.toString(), '## A\nalpha HUMAN\n\n## B\nbravo\n\n## C\ncharlie EXTERNAL\n');
  assert.equal(writes.at(-1).includeContent, true);
  assert.equal(writes.at(-1).content, ytext.toString());
});

test('CollaborationRoom reuses cached initial sync payload until the document changes', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'cached-sync-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return '# Cached\n';
      },
      async persistCollaborationState() {},
    },
  });

  const socketA = createSocket();
  const socketB = createSocket();
  const socketC = createSocket();

  await room.addClient(socketA);
  await room.addClient(socketB);
  assert.equal(socketA.sent.length, 1);
  assert.equal(socketB.sent.length, 1);
  assert.equal(socketA.sent[0], socketB.sent[0]);

  room.doc.transact(() => {
    room.doc.getText('codemirror').insert(room.doc.getText('codemirror').length, 'updated');
  }, 'test-cache-invalidate');

  await room.addClient(socketC);
  assert.equal(socketC.sent.length, 1);
  assert.notEqual(socketA.sent[0], socketC.sent[0]);
});

test('CollaborationRoom emits perf logs for hydrate and initial sync when enabled', async (t) => {
  const perfLogs = [];
  const originalConsoleInfo = console.info;
  console.info = (...args) => {
    perfLogs.push(args.join(' '));
  };
  t.after(() => {
    console.info = originalConsoleInfo;
  });

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'perf-room.md',
    onEmpty: () => {},
    perfLoggingEnabled: true,
    vaultFileStore: {
      async readCollaborationSnapshot() {
        return null;
      },
      async readCommentThreads() {
        return [];
      },
      async readEditableVaultContent() {
        return '# Perf\n';
      },
      async writeCollaborationSnapshot() {
        return { ok: true };
      },
      async persistCollaborationState() {},
    },
  });

  await room.addClient(createSocket());
  await Promise.resolve();

  const roomPerfLogs = perfLogs.filter((line) => line.includes('[perf][room:perf-room.md]'));
  assert.ok(roomPerfLogs.some((line) => line.includes('event=hydrate')));
  assert.ok(roomPerfLogs.some((line) => line.includes('event=initial-sync') && line.includes('bytes=')));
});

test('CollaborationRoom logs oversized initial sync payloads', async (t) => {
  const warnings = [];
  const originalConsoleWarn = console.warn;
  console.warn = (...args) => {
    warnings.push(args.join(' '));
  };
  t.after(() => {
    console.warn = originalConsoleWarn;
  });

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024 * 1024,
    maxInitialSyncBytes: 64,
    name: 'large-sync-room.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return 'large '.repeat(128);
      },
      async persistCollaborationState() {},
    },
  });

  await room.addClient(createSocket());

  assert.ok(warnings.some((line) => (
    line.includes('[room:large-sync-room.md]')
    && line.includes('Initial sync payload')
    && line.includes('exceeding 64 bytes')
  )));
});

test('CollaborationRoom persists markdown comment threads without rewriting unchanged content', async () => {
  const writes = [];
  const commentWrites = [];
  const persistedThreads = [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorKind: 'line',
    anchorQuote: 'Hello from room.',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 3,
    createdAt: 1,
    createdByColor: '#818cf8',
    createdByName: 'Andes',
    createdByPeerId: 'peer-1',
    id: 'thread-1',
    messages: [{
      body: 'Initial thread',
      createdAt: 1,
      id: 'comment-1',
      peerId: 'peer-1',
      reactions: [{
        emoji: '👍',
        users: [{
          reactedAt: 1,
          userColor: '#818cf8',
          userId: 'user-1',
          userName: 'Andes',
        }],
      }],
      userColor: '#818cf8',
      userName: 'Andes',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  }];

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'notes.md',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return '# Notes\n\nHello from room.\n';
      },
      async readCommentThreads(path) {
        assert.equal(path, 'notes.md');
        return persistedThreads;
      },
      async persistCollaborationState(path, { commentThreads, content, includeContent, ...options }) {
        commentWrites.push({ path, threads: commentThreads });
        if (includeContent) writes.push({ content, options, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  const hydratedThreads = room.doc.getArray('comments').toArray();
  assert.equal(hydratedThreads.length, 1);
  assert.equal(hydratedThreads[0].get('id'), 'thread-1');
  assert.deepEqual(hydratedThreads[0].get('messages').toArray()[0].reactions, [{
    emoji: '👍',
    users: [{
      reactedAt: 1,
      userColor: '#818cf8',
      userId: 'user-1',
      userName: 'Andes',
    }],
  }]);

  room.doc.transact(() => {
    const comments = room.doc.getArray('comments');
    const hydratedThread = comments.toArray()[0];
    hydratedThread.get('messages').push([{
      body: 'Follow-up',
      createdAt: 2,
      id: 'comment-2',
      peerId: 'peer-2',
      userColor: '#22c55e',
      userName: 'Collaborator',
    }]);
    comments.push([createCommentThreadSharedType({
      anchorEnd: { assoc: 0, type: null },
      anchorEndLine: 2,
      anchorKind: 'line',
      anchorQuote: 'Notes',
      anchorStart: { assoc: 0, type: null },
      anchorStartLine: 1,
      createdAt: 3,
      createdByColor: '#f97316',
      createdByName: 'Reviewer',
      createdByPeerId: 'peer-3',
      id: 'thread-2',
      messages: [{
        body: 'Second thread',
        createdAt: 3,
        id: 'comment-3',
        peerId: 'peer-3',
        userColor: '#f97316',
        userName: 'Reviewer',
      }],
    })]);
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 0);
  assert.equal(commentWrites.length, 1);
  assert.equal(commentWrites[0].path, 'notes.md');
  assert.equal(commentWrites[0].threads.length, 2);
  assert.equal(commentWrites[0].threads[0].messages.length, 2);
  assert.equal(commentWrites[0].threads[0].messages[0].reactions[0].emoji, '👍');
  assert.equal(commentWrites[0].threads[1].id, 'thread-2');
});

test('CollaborationRoom hydrates and persists Excalidraw rooms regardless of extension case', async () => {
  const initialScene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-1' }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  const updatedScene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-updated', isDeleted: false, type: 'rectangle', x: 0, y: 0, width: 100, height: 80 }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  let readExcalidrawCount = 0;
  const writes = [];
  let backlinkUpdates = 0;

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram.EXCALIDRAW',
    onEmpty: () => {},
    backlinkIndex: {
      updateFile() {
        backlinkUpdates += 1;
      },
    },
    vaultFileStore: {
      async readEditableVaultContent(path) {
        readExcalidrawCount += 1;
        assert.equal(path, 'diagram.EXCALIDRAW');
        return initialScene;
      },
      async persistCollaborationState(path, { content }) {
        writes.push({ content, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  assert.equal(readExcalidrawCount, 1);
  assert.deepEqual(buildExcalidrawRoomScene(room.doc).elements.map((element) => element.id), ['shape-1']);

  room.doc.transact(() => {
    replaceExcalidrawRoomScene(room.doc, JSON.parse(updatedScene));
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram.EXCALIDRAW');
  assert.deepEqual(JSON.parse(writes[0].content), JSON.parse(updatedScene));
  assert.equal(backlinkUpdates, 0);
});

test('CollaborationRoom keeps Excalidraw comments in the collaboration sidecar', async () => {
  const writes = [];
  const diagramThread = {
    anchorKind: 'diagram-element',
    anchorPoint: { x: 140, y: 80 },
    anchorQuote: 'Architecture node',
    anchorSnapshot: {
      height: 40,
      text: 'Architecture node',
      type: 'rectangle',
      width: 80,
      x: 100,
      y: 60,
    },
    createdAt: 1,
    createdByColor: '',
    createdByName: 'Andes',
    createdByPeerId: '',
    elementId: 'shape-1',
    id: 'thread-diagram',
    messages: [{
      body: 'Add the owner here',
      createdAt: 1,
      id: 'comment-diagram',
      peerId: '',
      reactions: [],
      userColor: '',
      userName: 'Andes',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  };
  const scene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-1', type: 'rectangle', x: 100, y: 60, width: 80, height: 40 }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram-comments.excalidraw',
    onEmpty: () => {},
    vaultFileStore: {
      async readCommentThreads() {
        return [diagramThread];
      },
      async readEditableVaultContent() {
        return scene;
      },
      async persistCollaborationState(path, payload) {
        writes.push({ path, ...payload });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  assert.equal(room.doc.getArray('comments').length, 1);
  assert.equal(room.doc.getArray('comments').get(0).get('elementId'), 'shape-1');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram-comments.excalidraw');
  assert.equal(writes[0].includeContent, false);
  assert.deepEqual(writes[0].commentThreads, [diagramThread]);
  assert.equal(JSON.parse(writes[0].content).comments, undefined);
});

test('CollaborationRoom keeps the latest excalidraw state available while final persist is still running', async () => {
  const initialScene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
  const updatedScene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-live', type: 'ellipse' }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });

  let persistedScene = initialScene;
  let releaseFirstPersist = null;
  let firstPersistStarted = null;
  const firstPersistStartedPromise = new Promise((resolve) => {
    firstPersistStarted = resolve;
  });
  let writes = 0;

  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => new CollaborationRoom({
      maxBufferedAmountBytes: 1024,
      name,
      onEmpty,
      vaultFileStore: {
        async readEditableVaultContent(path) {
          assert.equal(path, 'diagram.excalidraw');
          return persistedScene;
        },
        async persistCollaborationState(path, { content }) {
          assert.equal(path, 'diagram.excalidraw');
          writes += 1;

          if (writes === 1) {
            firstPersistStarted();
            await new Promise((resolve) => {
              releaseFirstPersist = () => {
                persistedScene = content;
                resolve();
              };
            });
            return;
          }

          persistedScene = content;
        },
      },
    }),
  });

  const room = roomRegistry.getOrCreate('diagram.excalidraw');
  await room.hydrate();
  assert.deepEqual(buildExcalidrawRoomScene(room.doc).elements, []);

  room.doc.transact(() => {
    replaceExcalidrawRoomScene(room.doc, JSON.parse(updatedScene));
  }, 'test-live-update');

  const socketA = createSocket();
  socketA.controlledClientIds = new Set();
  room.clients.add(socketA);
  room.removeClient(socketA);

  await firstPersistStartedPromise;
  assert.equal(roomRegistry.get('diagram.excalidraw'), room);

  const reconnectingRoom = roomRegistry.getOrCreate('diagram.excalidraw');
  assert.equal(reconnectingRoom, room);

  const socketB = createSocket();
  await reconnectingRoom.addClient(socketB);
  assert.deepEqual(buildExcalidrawRoomScene(reconnectingRoom.doc).elements.map((element) => element.id), ['shape-live']);
  assert.equal(persistedScene, initialScene);

  releaseFirstPersist();
  await Promise.resolve();
  assert.equal(roomRegistry.get('diagram.excalidraw'), reconnectingRoom);

  reconnectingRoom.removeClient(socketB);
  await Promise.resolve();
});

test('CollaborationRoom persists updates that arrive during an active persist', async () => {
  let releaseFirstPersist;
  let signalFirstPersistStarted;
  const firstPersistStarted = new Promise((resolve) => {
    signalFirstPersistStarted = resolve;
  });
  const firstPersistBlocked = new Promise((resolve) => {
    releaseFirstPersist = resolve;
  });
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'notes.md',
    onEmpty: () => {},
    vaultFileStore: {
      async persistCollaborationState(_path, payload) {
        writes.push(payload);
        if (writes.length === 1) {
          signalFirstPersistStarted();
          await firstPersistBlocked;
        }
        return { ok: true };
      },
      async readEditableVaultContent() {
        return '# persisted\n';
      },
    },
  });

  await room.hydrate();
  const text = room.doc.getText('codemirror');
  text.insert(text.length, 'first\n');
  const firstPersist = room.persist();
  await firstPersistStarted;

  text.insert(text.length, 'second\n');
  const secondPersist = room.persist();
  releaseFirstPersist();
  await Promise.all([firstPersist, secondPersist]);

  assert.equal(writes.length, 2);
  assert.equal(writes[0].includeContent, true);
  assert.equal(writes[0].content, '# persisted\nfirst\n');
  assert.equal(writes[1].includeContent, true);
  assert.equal(writes[1].content, '# persisted\nfirst\nsecond\n');
});

test('CollaborationRoom serializes overlapping persists for the same room', async () => {
  let concurrentPersists = 0;
  let maxConcurrentPersists = 0;
  let persistCalls = 0;
  let releaseFirstPersist = null;
  const firstPersistStarted = new Promise((resolve) => {
    releaseFirstPersist = resolve;
  });

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'notes.md',
    onEmpty: () => {},
    vaultFileStore: {
      async persistCollaborationState(path) {
        assert.equal(path, 'notes.md');
        persistCalls += 1;
        concurrentPersists += 1;
        maxConcurrentPersists = Math.max(maxConcurrentPersists, concurrentPersists);

        if (persistCalls === 1) {
          await firstPersistStarted;
        }

        concurrentPersists -= 1;
        return { ok: true };
      },
      async readEditableVaultContent() {
        return '# persisted\n';
      },
    },
  });

  await room.hydrate();
  room.doc.getText('codemirror').insert(0, 'next\n');

  const firstPersistPromise = room.persist();
  await Promise.resolve();
  const secondPersistPromise = room.persist();
  await Promise.resolve();

  releaseFirstPersist();
  await Promise.all([firstPersistPromise, secondPersistPromise]);

  assert.equal(persistCalls, 2);
  assert.equal(maxConcurrentPersists, 1);
});

test('CollaborationRoom still releases the room after duplicate client removal', async () => {
  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => new CollaborationRoom({
      idleGraceMs: 0,
      maxBufferedAmountBytes: 1024,
      name,
      onEmpty,
      vaultFileStore: {
        async readEditableVaultContent() {
          return '# persisted\n';
        },
        async persistCollaborationState() {
          return { ok: true };
        },
      },
    }),
  });

  const room = roomRegistry.getOrCreate('notes.md');
  const socket = createSocket();

  await room.addClient(socket);
  room.removeClient(socket);
  room.removeClient(socket);

  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(roomRegistry.get('notes.md'), undefined);
});

test('CollaborationRoom does not persist malformed legacy excalidraw room text over a valid file', async () => {
  const writes = [];
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'broken-room.excalidraw',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return JSON.stringify({
          appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
          elements: [{ id: 'shape-live', type: 'ellipse' }],
          files: {},
          source: 'collabmd',
          type: 'excalidraw',
          version: 2,
        });
      },
      async persistCollaborationState(path, { content }) {
        writes.push({ path, content });
      },
    },
  });

  room.doc.getText('codemirror').insert(0, '{"broken":');

  await room.persist();

  assert.deepEqual(writes, []);
});

test('CollaborationRoom clears ephemeral Excalidraw history after the last client disconnects', async () => {
  const scene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#222222' },
    elements: [{ id: 'shape-live' }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram.excalidraw',
    onEmpty: () => {},
    vaultFileStore: {
      async readEditableVaultContent() {
        return scene;
      },
      async persistCollaborationState() {},
    },
  });

  await room.hydrate();
  room.doc.transact(() => {
    room.doc.getArray('excalidraw-history').insert(0, [scene, `${scene}-next`]);
    room.doc.getMap('excalidraw-history-state').set('head', 1);
  }, 'test');

  const socket = createSocket();
  await room.addClient(socket);
  room.removeClient(socket);

  assert.deepEqual(buildExcalidrawRoomScene(room.doc).elements.map((element) => element.id), ['shape-live']);
  assert.equal(room.doc.getArray('excalidraw-history').length, 0);
  assert.equal(room.doc.getMap('excalidraw-history-state').size, 0);
});

test('CollaborationRoom hydrates and persists PlantUML rooms via PlantUML file APIs', async () => {
  const initialDiagram = '@startuml\nAlice -> Bob: Hello\n@enduml\n';
  let readPlantUmlCount = 0;
  const writes = [];
  let backlinkUpdates = 0;

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram.puml',
    onEmpty: () => {},
    backlinkIndex: {
      updateFile() {
        backlinkUpdates += 1;
      },
    },
    vaultFileStore: {
      async readEditableVaultContent(path) {
        readPlantUmlCount += 1;
        assert.equal(path, 'diagram.puml');
        return initialDiagram;
      },
      async persistCollaborationState(path, { content }) {
        writes.push({ content, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  assert.equal(readPlantUmlCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), initialDiagram);

  room.doc.transact(() => {
    const text = room.doc.getText('codemirror');
    text.delete(0, text.length);
    text.insert(0, `${initialDiagram}' comment\n`);
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram.puml');
  assert.equal(writes[0].content, `${initialDiagram}' comment\n`);
  assert.equal(backlinkUpdates, 0);
});

test('CollaborationRoom hydrates and persists Mermaid rooms via Mermaid file APIs', async () => {
  const initialDiagram = 'flowchart TD\n  A --> B\n';
  let readMermaidCount = 0;
  const writes = [];

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram.mmd',
    onEmpty: () => {},
    backlinkIndex: {
      updateFile() {
        throw new Error('backlink index should not be updated for Mermaid files');
      },
    },
    vaultFileStore: {
      async readEditableVaultContent(path) {
        readMermaidCount += 1;
        assert.equal(path, 'diagram.mmd');
        return initialDiagram;
      },
      async persistCollaborationState(path, { content }) {
        writes.push({ content, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  assert.equal(readMermaidCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), initialDiagram);

  room.doc.transact(() => {
    const text = room.doc.getText('codemirror');
    text.delete(0, text.length);
    text.insert(0, `${initialDiagram}  B --> C\n`);
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram.mmd');
  assert.equal(writes[0].content, `${initialDiagram}  B --> C\n`);
});

test('CollaborationRoom hydrates and persists .plantuml rooms via PlantUML file APIs', async () => {
  const initialDiagram = '@startuml\nAlice -> Bob: Hello\n@enduml\n';
  let readPlantUmlCount = 0;
  const writes = [];

  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'diagram.plantuml',
    onEmpty: () => {},
    backlinkIndex: {
      updateFile() {
        throw new Error('backlink index should not be updated for PlantUML files');
      },
    },
    vaultFileStore: {
      async readEditableVaultContent(path) {
        readPlantUmlCount += 1;
        assert.equal(path, 'diagram.plantuml');
        return initialDiagram;
      },
      async persistCollaborationState(path, { content }) {
        writes.push({ content, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  assert.equal(readPlantUmlCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), initialDiagram);

  room.doc.transact(() => {
    const text = room.doc.getText('codemirror');
    text.delete(0, text.length);
    text.insert(0, `${initialDiagram}' comment\n`);
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram.plantuml');
  assert.equal(writes[0].content, `${initialDiagram}' comment\n`);
});
