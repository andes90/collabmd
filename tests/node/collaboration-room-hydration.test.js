import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';
import { createCommentThreadSharedType } from '../../src/domain/comment-threads.js';
import {
  applySceneDiffToExcalidrawRoom,
  buildExcalidrawRoomScene,
  readExcalidrawReplaceGeneration,
  replaceExcalidrawRoomScene,
} from '../../src/domain/excalidraw-room-codec.js';

for (const name of ['note.md', 'diagram.mmd', 'diagram.puml', 'data.base', 'page.html', 'workspace.dsl']) {
  test(`CollaborationRoom reconciles offline text changes for ${name} without losing snapshot history`, async (t) => {
    const original = '# Heading\n\nAnchor\n\nOriginal footer\n';
    const external = '# Heading\n\nAnchor\n\nExternal footer\n';
    const previousDoc = new Y.Doc();
    const previousText = previousDoc.getText('codemirror');
    previousText.insert(0, original);
    const anchor = Y.createRelativePositionFromTypeIndex(previousText, original.indexOf('Anchor'));
    previousDoc.getArray('comments').push([createCommentThreadSharedType({
      id: 'preserved-thread',
      anchorKind: 'line',
      anchorStart: Y.relativePositionToJSON(anchor),
      anchorEnd: Y.relativePositionToJSON(Y.createRelativePositionFromTypeIndex(previousText, original.indexOf('Anchor') + 6)),
      anchorStartLine: 3,
      anchorEndLine: 3,
      anchorQuote: 'Anchor',
      messages: [{ id: 'message', body: 'Keep this discussion', userName: 'Reviewer' }],
    })]);
    const writes = [];
    const room = new CollaborationRoom({
      name,
      vaultFileStore: {
        async readCollaborationSnapshot() { return Y.encodeStateAsUpdate(previousDoc); },
        async readEditableVaultContent() { return external.replaceAll('\n', '\r\n'); },
        async readCommentThreads() { throw new Error('Snapshot comments should be retained'); },
        async persistCollaborationState(_path, state) { writes.push(state); return { ok: true }; },
      },
    });
    t.after(async () => { await room.destroy(); previousDoc.destroy(); });

    await room.hydrate();
    assert.equal(room.doc.getText('codemirror').toString(), external);
    assert.equal(room.doc.getArray('comments').get(0).get('id'), 'preserved-thread');
    assert.equal(Y.createAbsolutePositionFromRelativePosition(anchor, room.doc).index, external.indexOf('Anchor'));
    assert.equal(room.persistTimer, null);
    await room.persist();
    assert.equal(writes[0].includeContent, false);
    assert.equal(writes[0].commentThreads[0].id, 'preserved-thread');
    assert.equal(writes[0].commentThreads[0].messages[0].body, 'Keep this discussion');

    // A returning client with the old document must not duplicate or restore old text.
    Y.applyUpdate(previousDoc, Y.encodeStateAsUpdate(room.doc));
    assert.equal(previousText.toString(), external);
    room.doc.getText('codemirror').insert(external.length, 'Intentional edit\n');
    await room.persist();
    assert.equal(writes[1].includeContent, true);
    assert.equal(writes[1].content, `${external}Intentional edit\n`);
  });
}

test('CollaborationRoom retains a matching text snapshot unchanged despite disk CRLF', async (t) => {
  const previousDoc = new Y.Doc();
  previousDoc.getText('codemirror').insert(0, '# Unchanged\n');
  const snapshot = Y.encodeStateAsUpdate(previousDoc);
  const room = new CollaborationRoom({
    name: 'unchanged.md',
    vaultFileStore: {
      async readCollaborationSnapshot() { return snapshot; },
      async readEditableVaultContent() { return '# Unchanged\r\n'; },
    },
  });
  t.after(async () => { await room.destroy(); previousDoc.destroy(); });
  await room.hydrate();
  assert.deepEqual(Y.encodeStateAsUpdate(room.doc), snapshot);
  assert.equal(room.contentDirty, false);
});

test('CollaborationRoom reconciles an older disk Excalidraw revision without discarding comments', async (t) => {
  const previousDoc = new Y.Doc();
  replaceExcalidrawRoomScene(previousDoc, {
    elements: [{ id: 'shape', type: 'rectangle', x: 10, version: 100, versionNonce: 100 }],
  });
  previousDoc.getArray('comments').push([createCommentThreadSharedType({
    id: 'diagram-thread',
    anchorKind: 'diagram-element',
    elementId: 'shape',
    anchorPoint: { x: 10, y: 0 },
    anchorSnapshot: { type: 'rectangle', x: 10, y: 0, width: 100, height: 100 },
    messages: [{ id: 'message', body: 'Keep this discussion', userName: 'Reviewer' }],
  })]);
  const external = {
    elements: [{ id: 'shape', type: 'rectangle', x: 20, version: 1, versionNonce: 1 }],
    appState: { gridSize: 20 },
    files: { attachment: { id: 'attachment', dataURL: 'data:image/png;base64,AA==' } },
  };
  const writes = [];
  const room = new CollaborationRoom({
    name: 'drawing.excalidraw',
    vaultFileStore: {
      async readCollaborationSnapshot() { return Y.encodeStateAsUpdate(previousDoc); },
      async readEditableVaultContent() { return JSON.stringify(external, null, 2); },
      async persistCollaborationState(_path, state) { writes.push(state); return { ok: true }; },
    },
  });
  t.after(async () => { await room.destroy(); previousDoc.destroy(); });
  await room.hydrate();
  const scene = buildExcalidrawRoomScene(room.doc);
  assert.deepEqual(scene.elements, external.elements);
  assert.deepEqual(scene.files, external.files);
  assert.equal(scene.appState.gridSize, 20);
  assert.equal(room.doc.getArray('comments').get(0).get('id'), 'diagram-thread');
  assert.equal(room.persistTimer, null);
  await room.persist();
  assert.equal(writes[0].includeContent, false);
  assert.equal(writes[0].commentThreads[0].id, 'diagram-thread');
  Y.applyUpdate(previousDoc, Y.encodeStateAsUpdate(room.doc));
  assert.deepEqual(buildExcalidrawRoomScene(previousDoc), scene);

  room.doc.transact(() => {
    applySceneDiffToExcalidrawRoom(room.doc, {
      ...scene,
      elements: [{ ...scene.elements[0], x: 30, version: 2 }],
    });
  }, 'collaborator-edit');
  await room.persist();
  assert.equal(writes[1].includeContent, true);
  assert.equal(JSON.parse(writes[1].content).elements[0].x, 30);
});

test('CollaborationRoom keeps a semantically matching Excalidraw snapshot unchanged', async (t) => {
  const previousDoc = new Y.Doc();
  replaceExcalidrawRoomScene(previousDoc, {
    elements: [{ id: 'shape', type: 'rectangle', x: 10, version: 1, versionNonce: 1 }],
  });
  const scene = buildExcalidrawRoomScene(previousDoc);
  // Key order, JSON formatting, and source metadata are not scene changes.
  const external = { ...scene, source: 'https://excalidraw.com' };
  external.elements = scene.elements.map((element) => Object.fromEntries(Object.entries(element).reverse()));
  const snapshot = Y.encodeStateAsUpdate(previousDoc);
  const room = new CollaborationRoom({
    name: 'matching.excalidraw',
    vaultFileStore: {
      async readCollaborationSnapshot() { return snapshot; },
      async readEditableVaultContent() { return JSON.stringify(external, null, 2); },
    },
  });
  t.after(async () => { await room.destroy(); previousDoc.destroy(); });
  await room.hydrate();
  assert.deepEqual(Y.encodeStateAsUpdate(room.doc), snapshot);
});

test('CollaborationRoom preserves pending edits when an unchanged Excalidraw file has unsorted legacy elements', async (t) => {
  const scene = {
    elements: [
      { id: 'z', type: 'rectangle', x: 10, version: 1, versionNonce: 1 },
      { id: 'a', type: 'rectangle', x: 20, version: 1, versionNonce: 1 },
      { id: 'deleted', type: 'rectangle', isDeleted: true, version: 1, versionNonce: 1 },
    ],
  };
  const previousDoc = new Y.Doc();
  replaceExcalidrawRoomScene(previousDoc, scene);
  const snapshot = Y.encodeStateAsUpdate(previousDoc);
  const client = new Y.Doc();
  Y.applyUpdate(client, snapshot);
  const pendingElement = { ...scene.elements[0], x: 99, version: 2, versionNonce: 2 };
  applySceneDiffToExcalidrawRoom(client, { elements: [pendingElement] });
  let snapshotWrites = 0;
  const room = new CollaborationRoom({
    name: 'legacy-order.excalidraw',
    vaultFileStore: {
      async readCollaborationSnapshot() { return snapshot; },
      async readEditableVaultContent() { return JSON.stringify(scene); },
      async writeCollaborationSnapshot() { snapshotWrites += 1; return { ok: true }; },
    },
  });
  t.after(async () => { await room.destroy(); previousDoc.destroy(); client.destroy(); });
  await room.hydrate();
  assert.deepEqual(Y.encodeStateAsUpdate(room.doc), snapshot);
  assert.equal(readExcalidrawReplaceGeneration(room.doc), readExcalidrawReplaceGeneration(previousDoc));
  assert.equal(snapshotWrites, 0);
  Y.applyUpdate(room.doc, Y.encodeStateAsUpdate(client), 'returning-client');
  Y.applyUpdate(client, Y.encodeStateAsUpdate(room.doc));
  assert.deepEqual(buildExcalidrawRoomScene(room.doc).elements.find((element) => element.id === 'z'), pendingElement);
  assert.deepEqual(buildExcalidrawRoomScene(client), buildExcalidrawRoomScene(room.doc));
});

test('CollaborationRoom saves reconciled text before sync so a second restart cannot duplicate it', async (t) => {
  const seed = new Y.Doc();
  seed.getText('codemirror').insert(0, 'old\n');
  let snapshot = Y.encodeStateAsUpdate(seed);
  let savedContent = null;
  const store = {
    async readCollaborationSnapshot() { return snapshot; },
    async readEditableVaultContent() { return 'external\n'; },
    async writeCollaborationSnapshot(_path, value) { snapshot = value; return { ok: true }; },
    async persistCollaborationState(_path, state) {
      if (state.includeContent) savedContent = state.content;
      return { ok: true };
    },
  };
  const first = new CollaborationRoom({ name: 'restart.md', vaultFileStore: store });
  const second = new CollaborationRoom({ name: 'restart.md', vaultFileStore: store });
  const client = new Y.Doc();
  t.after(async () => { await first.destroy(); await second.destroy(); seed.destroy(); client.destroy(); });
  await first.hydrate();
  Y.applyUpdate(client, Y.encodeStateAsUpdate(first.doc));
  assert.equal(client.getText('codemirror').toString(), 'external\n');
  // Stop without a final persist, as happens after a process crash.
  await first.destroy();
  await second.hydrate();
  Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(client), 'returning-client');
  Y.applyUpdate(client, Y.encodeStateAsUpdate(second.doc));
  assert.equal(client.getText('codemirror').toString(), 'external\n');
  assert.equal(second.doc.getText('codemirror').toString(), 'external\n');
  await second.persist();
  assert.equal(savedContent, null);
});

test('CollaborationRoom withholds sync until a reconciled snapshot is saved and retries a failed save', async (t) => {
  const seed = new Y.Doc();
  seed.getText('codemirror').insert(0, 'old\n');
  seed.getArray('comments').push([new Y.Map([['id', 'retained-thread']])]);
  let snapshot = Y.encodeStateAsUpdate(seed);
  let finishWrite;
  let writes = 0;
  const sent = [];
  const room = new CollaborationRoom({
    name: 'snapshot-save-failure.md',
    vaultFileStore: {
      async readCollaborationSnapshot() { return snapshot; },
      async readEditableVaultContent() { return 'external\n'; },
      async readCommentThreads() { throw new Error('Must not fall back after a save failure'); },
      async writeCollaborationSnapshot(_path, value) {
        writes += 1;
        if (writes === 1) return new Promise((resolve) => { finishWrite = resolve; });
        snapshot = value;
        return { ok: true };
      },
    },
  });
  t.after(async () => { await room.destroy(); seed.destroy(); });
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send(payload, callback) { sent.push(payload); callback?.(); },
  };
  const firstJoin = room.addClient(socket);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(writes, 1);
  assert.equal(room.hydrated, false);
  assert.equal(room.clients.size, 0);
  assert.equal(sent.length, 0);
  finishWrite({ ok: false, error: 'Injected snapshot write failure' });
  await assert.rejects(firstJoin, /Injected snapshot write failure/);
  assert.equal(room.doc.getText('codemirror').toString(), '');
  assert.equal(room.doc.getArray('comments').length, 0);
  await room.addClient(socket);
  assert.equal(room.hydrated, true);
  assert.equal(room.doc.getText('codemirror').toString(), 'external\n');
  assert.equal(room.doc.getArray('comments').get(0).get('id'), 'retained-thread');
  assert.equal(sent.length, 1);
  const restored = new Y.Doc();
  t.after(() => restored.destroy());
  Y.applyUpdate(restored, snapshot);
  assert.equal(restored.getText('codemirror').toString(), 'external\n');
});

for (const failure of ['read-error', 'missing-file', 'invalid-excalidraw']) {
  test(`CollaborationRoom retries snapshot hydration safely after ${failure}`, async (t) => {
    const previousDoc = new Y.Doc();
    const isExcalidraw = failure === 'invalid-excalidraw';
    if (isExcalidraw) replaceExcalidrawRoomScene(previousDoc, { elements: [{ id: 'stale-shape' }] });
    else previousDoc.getText('codemirror').insert(0, 'Stale snapshot');
    let failRead = true;
    let writes = 0;
    const room = new CollaborationRoom({
      name: isExcalidraw ? 'retry.excalidraw' : 'retry.md',
      vaultFileStore: {
        async readCollaborationSnapshot() { return Y.encodeStateAsUpdate(previousDoc); },
        async readEditableVaultContent() {
          if (failRead) {
            if (failure === 'read-error') throw new Error('Temporary read failure');
            return failure === 'missing-file' ? null : '{broken';
          }
          return isExcalidraw ? JSON.stringify({ elements: [{ id: 'disk-shape' }] }) : 'Disk content';
        },
        async writeCollaborationSnapshot() { writes += 1; return { ok: true }; },
        async persistCollaborationState() { writes += 1; return { ok: true }; },
      },
    });
    t.after(async () => { await room.destroy(); previousDoc.destroy(); });
    await assert.rejects(room.hydrate(), /Temporary read failure|Vault file is unavailable|Invalid Excalidraw file content/);
    assert.equal(room.hydrated, false);
    assert.equal(room.doc.getText('codemirror').toString(), '');
    assert.equal(writes, 0);
    failRead = false;
    await room.hydrate();
    assert.equal(room.hydrated, true);
    if (isExcalidraw) assert.equal(buildExcalidrawRoomScene(room.doc).elements[0].id, 'disk-shape');
    else assert.equal(room.doc.getText('codemirror').toString(), 'Disk content');
  });
}

for (const snapshot of [null, Uint8Array.of(1)]) {
  test(`CollaborationRoom retries initial snapshot creation from ${snapshot ? 'invalid snapshot' : 'disk content'} before sync`, async (t) => {
    let storedSnapshot = snapshot;
    let attempts = 0;
    const room = new CollaborationRoom({
      name: 'initial-retry.md',
      vaultFileStore: {
        async readCollaborationSnapshot() { return storedSnapshot; },
        async readEditableVaultContent() { return '# Current disk content\r\n'; },
        async writeCollaborationSnapshot(_path, value) {
          attempts += 1;
          if (attempts < 3) return { ok: false, error: 'Temporary write failure' };
          storedSnapshot = value;
          return { ok: true };
        },
      },
    });
    const restored = new Y.Doc();
    t.after(async () => { await room.destroy(); restored.destroy(); });
    await room.hydrate();
    assert.equal(attempts, 3);
    assert.equal(room.doc.getText('codemirror').toString(), '# Current disk content\n');
    Y.applyUpdate(restored, storedSnapshot);
    assert.equal(restored.getText('codemirror').toString(), '# Current disk content\n');
    assert.equal(room.persistTimer, null);
  });
}

test('CollaborationRoom propagates exhausted initial snapshot retries and can reopen without duplicate text or comments', async (t) => {
  let failWrite = true;
  let attempts = 0;
  let storedSnapshot = null;
  let content = '# Initial\n';
  const sent = [];
  const room = new CollaborationRoom({
    name: 'initial-write-failure.md',
    vaultFileStore: {
      async readCollaborationSnapshot() { return storedSnapshot; },
      async readEditableVaultContent() { return content; },
      async readCommentThreads() {
        return [{
          id: 'persisted-thread',
          anchorKind: 'line',
          anchorStart: { type: null, assoc: 0 },
          anchorEnd: { type: null, assoc: 0 },
          anchorStartLine: 1,
          anchorEndLine: 1,
          messages: [{ id: 'message', body: 'Keep this comment', userName: 'Reviewer' }],
        }];
      },
      async writeCollaborationSnapshot(_path, value) {
        attempts += 1;
        if (failWrite) return { ok: false, error: 'Persistent write failure' };
        storedSnapshot = value;
        return { ok: true };
      },
    },
  });
  const restored = new Y.Doc();
  t.after(async () => { await room.destroy(); restored.destroy(); });
  const socket = {
    OPEN: 1,
    readyState: 1,
    bufferedAmount: 0,
    send(payload, callback) { sent.push(payload); callback?.(); },
  };
  await assert.rejects(room.addClient(socket), /Persistent write failure/);
  assert.equal(attempts, 3);
  assert.equal(room.hydrated, false);
  assert.equal(room.clients.size, 0);
  assert.equal(sent.length, 0);
  assert.equal(room.doc.getText('codemirror').toString(), '');
  assert.equal(room.doc.getArray('comments').length, 0);

  failWrite = false;
  content = '# Changed on disk\n';
  await room.addClient(socket);
  assert.equal(attempts, 4);
  assert.equal(room.doc.getText('codemirror').toString(), content);
  assert.equal(room.doc.getArray('comments').length, 1);
  assert.equal(sent.length, 1);
  Y.applyUpdate(restored, storedSnapshot);
  assert.equal(restored.getText('codemirror').toString(), content);
  assert.equal(restored.getArray('comments').get(0).get('id'), 'persisted-thread');
});
