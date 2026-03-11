import test from 'node:test';
import assert from 'node:assert/strict';

import * as decoding from 'lib0/decoding';
import * as syncProtocol from 'y-protocols/sync';
import * as Y from 'yjs';

import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';
import { RoomRegistry } from '../../src/server/domain/collaboration/room-registry.js';
import { createCommentThreadSharedType } from '../../src/domain/comment-threads.js';

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
      async readMarkdownFile() {
        readCount += 1;
        await new Promise((resolve) => setTimeout(resolve, 25));
        return '# persisted';
      },
      async writeMarkdownFile() {},
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
      async readMarkdownFile() {
        readCount += 1;
        if (readCount === 1) {
          throw new Error('temporary read failure');
        }

        return '# recovered';
      },
      async writeMarkdownFile() {},
    },
  });

  await assert.rejects(room.hydrate(), /temporary read failure/);
  assert.equal(room.hydrated, false);

  await room.hydrate();

  assert.equal(readCount, 2);
  assert.equal(room.doc.getText('codemirror').toString(), '# recovered');
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
      async readMarkdownFile() {
        return 'x'.repeat(2048);
      },
      async writeMarkdownFile() {},
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
      async readMarkdownFile() {
        return '# Primed\n';
      },
      async writeCollaborationSnapshot(path, snapshot) {
        snapshotWrites.push({ path, snapshot });
        return { ok: true };
      },
      async writeMarkdownFile() {},
    },
  });

  await room.hydrate();
  await Promise.resolve();

  assert.equal(room.doc.getText('codemirror').toString(), '# Primed\n');
  assert.equal(snapshotWrites.length, 1);
  assert.equal(snapshotWrites[0].path, 'snapshot-prime.md');
  assert.equal(snapshotWrites[0].snapshot instanceof Uint8Array, true);
});

test('CollaborationRoom reuses cached initial sync payload until the document changes', async () => {
  const room = new CollaborationRoom({
    maxBufferedAmountBytes: 1024,
    name: 'cached-sync-room',
    onEmpty: () => {},
    vaultFileStore: {
      async readMarkdownFile() {
        return '# Cached\n';
      },
      async writeMarkdownFile() {},
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

test('CollaborationRoom hydrates and persists markdown comment threads', async () => {
  const writes = [];
  const commentWrites = [];
  const persistedThreads = [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorExcerpt: 'Hello from room.',
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
      async readMarkdownFile() {
        return '# Notes\n\nHello from room.\n';
      },
      async readCommentThreads(path) {
        assert.equal(path, 'notes.md');
        return persistedThreads;
      },
      async writeCommentThreads(path, threads) {
        commentWrites.push({ path, threads });
        return { ok: true };
      },
      async writeMarkdownFile(path, content, options) {
        writes.push({ content, options, path });
        return { ok: true };
      },
    },
  });

  await room.hydrate();
  const hydratedThreads = room.doc.getArray('comments').toArray();
  assert.equal(hydratedThreads.length, 1);
  assert.equal(hydratedThreads[0].get('id'), 'thread-1');

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
      anchorExcerpt: 'Notes',
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

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'notes.md');
  assert.equal(writes[0].options?.invalidateCollaborationSnapshot, false);
  assert.equal(commentWrites.length, 1);
  assert.equal(commentWrites[0].path, 'notes.md');
  assert.equal(commentWrites[0].threads.length, 2);
  assert.equal(commentWrites[0].threads[0].messages.length, 2);
  assert.equal(commentWrites[0].threads[1].id, 'thread-2');
});

test('CollaborationRoom hydrates and persists excalidraw rooms via excalidraw file APIs', async () => {
  const initialScene = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-1' }],
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
    name: 'diagram.excalidraw',
    onEmpty: () => {},
    backlinkIndex: {
      updateFile() {
        backlinkUpdates += 1;
      },
    },
    vaultFileStore: {
      async readExcalidrawFile(path) {
        readExcalidrawCount += 1;
        assert.equal(path, 'diagram.excalidraw');
        return initialScene;
      },
      async readMarkdownFile() {
        throw new Error('readMarkdownFile should not be called for .excalidraw rooms');
      },
      async writeExcalidrawFile(path, content) {
        writes.push({ content, path });
        return { ok: true };
      },
      async writeMarkdownFile() {
        throw new Error('writeMarkdownFile should not be called for .excalidraw rooms');
      },
    },
  });

  await room.hydrate();
  assert.equal(readExcalidrawCount, 1);
  assert.equal(room.doc.getText('codemirror').toString(), initialScene);

  room.doc.transact(() => {
    const text = room.doc.getText('codemirror');
    text.delete(0, text.length);
    text.insert(0, `${initialScene}-updated`);
  }, 'test');

  await room.persist();

  assert.equal(writes.length, 1);
  assert.equal(writes[0].path, 'diagram.excalidraw');
  assert.equal(writes[0].content, `${initialScene}-updated`);
  assert.equal(backlinkUpdates, 0);
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
        async readExcalidrawFile(path) {
          assert.equal(path, 'diagram.excalidraw');
          return persistedScene;
        },
        async writeExcalidrawFile(path, content) {
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
  assert.equal(room.doc.getText('codemirror').toString(), initialScene);

  room.doc.transact(() => {
    const ytext = room.doc.getText('codemirror');
    ytext.delete(0, ytext.length);
    ytext.insert(0, updatedScene);
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
  assert.equal(reconnectingRoom.doc.getText('codemirror').toString(), updatedScene);
  assert.equal(persistedScene, initialScene);

  releaseFirstPersist();
  await Promise.resolve();
  assert.equal(roomRegistry.get('diagram.excalidraw'), reconnectingRoom);

  reconnectingRoom.removeClient(socketB);
  await Promise.resolve();
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
      async readPlantUmlFile(path) {
        readPlantUmlCount += 1;
        assert.equal(path, 'diagram.puml');
        return initialDiagram;
      },
      async readMarkdownFile() {
        throw new Error('readMarkdownFile should not be called for .puml rooms');
      },
      async writePlantUmlFile(path, content) {
        writes.push({ content, path });
        return { ok: true };
      },
      async writeMarkdownFile() {
        throw new Error('writeMarkdownFile should not be called for .puml rooms');
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
      async readMermaidFile(path) {
        readMermaidCount += 1;
        assert.equal(path, 'diagram.mmd');
        return initialDiagram;
      },
      async readMarkdownFile() {
        throw new Error('readMarkdownFile should not be called for .mmd rooms');
      },
      async writeMermaidFile(path, content) {
        writes.push({ content, path });
        return { ok: true };
      },
      async writeMarkdownFile() {
        throw new Error('writeMarkdownFile should not be called for .mmd rooms');
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
      async readPlantUmlFile(path) {
        readPlantUmlCount += 1;
        assert.equal(path, 'diagram.plantuml');
        return initialDiagram;
      },
      async readMarkdownFile() {
        throw new Error('readMarkdownFile should not be called for .plantuml rooms');
      },
      async writePlantUmlFile(path, content) {
        writes.push({ content, path });
        return { ok: true };
      },
      async writeMarkdownFile() {
        throw new Error('writeMarkdownFile should not be called for .plantuml rooms');
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
