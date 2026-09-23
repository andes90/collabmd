import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import * as Y from 'yjs';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import {
  buildCanvasRoomDocument,
  CANVAS_META_KEY,
  CANVAS_NODES_KEY,
  isCanvasRoomDocStructured,
  replaceCanvasRoomDocument,
  resolveCanvasExternalConflict,
  updateCanvasNode,
} from '../../src/domain/canvas-room-codec.js';
import { getCollabMdContentCapability, isAgentCreatablePath, isAgentEditablePath } from '../../src/domain/collabmd-content-capabilities.js';
import { getVaultFileKind, isCanvasFilePath, stripVaultFileExtension } from '../../src/domain/file-kind.js';
import { MSG_AGENT_FLUSH, MSG_AGENT_FLUSH_ACK } from '../../src/domain/collaboration-protocol.js';
import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';
import { RoomRegistry } from '../../src/server/domain/collaboration/room-registry.js';
import { createWorkspaceTree } from '../../src/server/domain/workspace-state.js';
import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';

const CANVAS = { nodes: [{ id: 'a', type: 'text', x: 0, y: 0, width: 300, height: 160, text: 'Hello' }], extra: { z: 1, a: 2 } };

async function createRoom(t, { content = JSON.stringify(CANVAS), snapshot = null } = {}) {
  const state = { content, snapshot, writes: [] };
  const room = new CollaborationRoom({
    name: 'board.canvas',
    maxBufferedAmountBytes: 1024 * 1024,
    vaultFileStore: {
      async readEditableVaultContent() { return state.content; },
      async readCollaborationSnapshot() { return state.snapshot; },
      async writeCollaborationSnapshot(_path, value) { state.snapshot = value; return { ok: true }; },
      async persistCollaborationState(path, options) {
        state.writes.push({ path, ...options });
        if (options.includeContent) state.content = options.content;
        state.snapshot = options.snapshot;
        return { ok: true };
      },
    },
  });
  t.after(() => room.destroy());
  await room.hydrate();
  return { room, state };
}

function requestFlush(room, requestId = 'canvas-flush') {
  const socket = { OPEN: 1, readyState: 1, bufferedAmount: 0, sent: [], send(payload, callback) {
    this.sent.push(payload);
    callback?.();
  } };
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AGENT_FLUSH);
  encoding.writeVarString(encoder, requestId);
  room.handleMessage(socket, encoding.toUint8Array(encoder));
  return socket;
}

test('Canvas flush acknowledgement waits for queued content and snapshot writes', async (t) => {
  const { room, state } = await createRoom(t);
  const originalPersist = room.documentStore.persistState.bind(room.documentStore);
  const gates = [Promise.withResolvers(), Promise.withResolvers()];
  const started = [Promise.withResolvers(), Promise.withResolvers()];
  let writeCount = 0;
  room.documentStore.persistState = async (options) => {
    const index = writeCount++;
    started[index].resolve();
    await gates[index].promise;
    return originalPersist(options);
  };
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'First' }), 'client');
  const earlierPersist = room.persist();
  await started[0].promise;
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Second' }), 'client');
  const socket = requestFlush(room);
  assert.equal(socket.sent.length, 0);
  gates[0].resolve();
  await earlierPersist;
  await started[1].promise;
  assert.equal(socket.sent.length, 0);
  gates[1].resolve();
  await room.activePersistPromise;
  await new Promise(setImmediate);
  assert.equal(socket.sent.length, 1);
  const decoder = decoding.createDecoder(socket.sent[0]);
  assert.equal(decoding.readVarUint(decoder), MSG_AGENT_FLUSH_ACK);
  assert.equal(decoding.readVarString(decoder), 'canvas-flush');
  assert.equal(JSON.parse(state.content).nodes[0].text, 'Second');
  const snapshot = new Y.Doc();
  t.after(() => snapshot.destroy());
  Y.applyUpdate(snapshot, state.snapshot);
  assert.equal(buildCanvasRoomDocument(snapshot).nodes[0].text, 'Second');
});

test('Canvas flush withholds acknowledgement after failed persistence or for unavailable data', async (t) => {
  const { room, state } = await createRoom(t);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Pending' }), 'client');
  room.documentStore.vaultFileStore.persistCollaborationState = async () => ({ ok: false, error: 'Write failed' });
  const failed = requestFlush(room);
  await assert.rejects(room.activePersistPromise, /Write failed/);
  await new Promise(setImmediate);
  assert.equal(failed.sent.length, 0);
  assert.equal(JSON.parse(state.content).nodes[0].text, 'Hello');
  room.doc.getMap(CANVAS_NODES_KEY).get('a').set('width', 'invalid');
  assert.equal(requestFlush(room).sent.length, 0);
  room.deleted = true;
  assert.equal(requestFlush(room).sent.length, 0);
  const unavailable = new CollaborationRoom({ name: 'missing.canvas', maxBufferedAmountBytes: 1024 });
  t.after(() => unavailable.destroy());
  assert.equal(requestFlush(unavailable).sent.length, 0);
});

test('Canvas flush acknowledges preserved external conflicts only after their sidecar is saved', async (t) => {
  const { room, state } = await createRoom(t);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Local' }), 'client');
  state.content = '{external malformed';
  const gate = Promise.withResolvers();
  const started = Promise.withResolvers();
  const originalPersist = room.documentStore.persistState.bind(room.documentStore);
  room.documentStore.persistState = async (options) => {
    started.resolve();
    await gate.promise;
    return originalPersist(options);
  };
  const socket = requestFlush(room);
  await started.promise;
  assert.equal(socket.sent.length, 0);
  gate.resolve();
  await room.activePersistPromise;
  await new Promise(setImmediate);
  assert.equal(socket.sent.length, 1);
  assert.equal(state.content, '{external malformed');
  const snapshot = new Y.Doc();
  t.after(() => snapshot.destroy());
  Y.applyUpdate(snapshot, state.snapshot);
  assert.equal(snapshot.getMap(CANVAS_META_KEY).get('externalConflict').content, state.content);
  assert.equal(buildCanvasRoomDocument(snapshot).nodes[0].text, 'Local');
});

test('Canvas is recognized as editable Vault content with agent raw writes disabled', () => {
  assert.equal(getVaultFileKind('Board.CANVAS'), 'canvas');
  assert.equal(isCanvasFilePath('folder/board.canvas'), true);
  assert.equal(stripVaultFileExtension('board.canvas'), 'board');
  assert.equal(getCollabMdContentCapability('canvas').editable, true);
  assert.equal(isAgentEditablePath('board.canvas'), false);
  assert.equal(isAgentCreatablePath('board.canvas'), false);
});

test('Canvas hydration and sidecar persistence preserve exact file bytes until intentional edits', async (t) => {
  const bytes = '\r\n' + JSON.stringify(CANVAS, null, '\t').replaceAll('\n', '\r\n') + '\r\n';
  const { room, state } = await createRoom(t, { content: bytes });
  assert.equal(isCanvasRoomDocStructured(room.doc), true);
  assert.deepEqual(buildCanvasRoomDocument(room.doc), CANVAS);
  await room.persist();
  assert.equal(state.content, bytes);
  assert.equal(state.writes.every((write) => !write.includeContent), true);
  assert.equal(room.readEditableContent(), null);
  assert.throws(() => room.applyExactTextChanges([{ from: 0, to: 0, insert: 'bad' }]), /unavailable/);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Edited' }), 'client');
  assert.equal(room.contentDirty, true);
  await room.persist();
  assert.equal(JSON.parse(state.content).nodes[0].text, 'Edited');
  assert.equal(state.content.includes('\r'), false);
  assert.equal(state.content.includes('schemaVersion'), false);
  const { room: reopened } = await createRoom(t, { content: state.content, snapshot: state.snapshot });
  assert.equal(buildCanvasRoomDocument(reopened.doc).nodes[0].text, 'Edited');
});

test('Canvas invalid input and invalid snapshots cannot overwrite file content as an empty document', async (t) => {
  const { room, state } = await createRoom(t, { content: '{broken', snapshot: Uint8Array.of(1, 2, 3) });
  assert.equal(isCanvasRoomDocStructured(room.doc), false);
  assert.equal(room.doc.getMap(CANVAS_META_KEY).get('invalidContent'), true);
  await room.persist();
  assert.equal(state.content, '{broken');
  assert.equal(state.writes.length, 0);
  state.content = JSON.stringify(CANVAS);
  await room.reloadFromDisk();
  assert.deepEqual(buildCanvasRoomDocument(room.doc), CANVAS);
  assert.equal(state.writes.some((write) => write.includeContent), false);
});

test('Canvas validates snapshots and reads offline filesystem changes before reusing one', async (t) => {
  const oldDoc = new Y.Doc();
  t.after(() => oldDoc.destroy());
  oldDoc.transact(() => replaceCanvasRoomDocument(oldDoc, CANVAS));
  const external = structuredClone(CANVAS);
  external.nodes[0].text = 'Changed while stopped';
  const { room, state } = await createRoom(t, { content: JSON.stringify(external), snapshot: Y.encodeStateAsUpdate(oldDoc) });
  assert.deepEqual(buildCanvasRoomDocument(room.doc), external);
  await room.persist();
  assert.equal(state.writes.some((write) => write.includeContent), false);
  oldDoc.getMap(CANVAS_NODES_KEY).get('a').set('width', 'invalid');
  const recovered = await createRoom(t, { snapshot: Y.encodeStateAsUpdate(oldDoc) });
  assert.deepEqual(buildCanvasRoomDocument(recovered.room.doc), CANVAS);
  recovered.room.doc.getMap(CANVAS_NODES_KEY).get('a').set('width', 'invalid');
  await recovered.room.persist();
  assert.equal(recovered.state.writes.length, 0);
});

test('Canvas adopts clean external changes without content saves and merges pending independent fields', async (t) => {
  const { room, state } = await createRoom(t);
  const external = structuredClone(CANVAS);
  external.nodes[0].color = '4';
  state.content = JSON.stringify(external, null, '\t');
  await room.reloadFromDisk();
  assert.deepEqual(buildCanvasRoomDocument(room.doc), external);
  assert.equal(state.writes.some((write) => write.includeContent), false);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { x: 40 }), 'client');
  external.nodes[0].text = 'External typing';
  state.content = JSON.stringify(external);
  const result = await room.reloadFromDisk();
  assert.equal(result.conflict, false);
  assert.equal(buildCanvasRoomDocument(room.doc).nodes[0].x, 40);
  assert.equal(buildCanvasRoomDocument(room.doc).nodes[0].text, 'External typing');
  await room.persist();
  assert.equal(JSON.parse(state.content).nodes[0].x, 40);
  assert.equal(JSON.parse(state.content).nodes[0].text, 'External typing');
});

test('Canvas preserves pending and conflicting external versions through snapshot reopen and explicit resolution', async (t) => {
  const { room, state } = await createRoom(t);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Local' }), 'client');
  const external = structuredClone(CANVAS);
  external.nodes[0].text = 'External';
  state.content = JSON.stringify(external);
  await room.reloadFromDisk();
  await room.persist();
  assert.equal(buildCanvasRoomDocument(room.doc).nodes[0].text, 'Local');
  assert.equal(JSON.parse(state.content).nodes[0].text, 'External');
  assert.equal(state.writes.every((write) => !write.includeContent), true);
  const reopened = await createRoom(t, { content: state.content, snapshot: state.snapshot });
  assert.equal(buildCanvasRoomDocument(reopened.room.doc).nodes[0].text, 'Local');
  reopened.room.doc.transact(() => resolveCanvasExternalConflict(reopened.room.doc, 'local'), 'client');
  await reopened.room.persist();
  assert.equal(JSON.parse(reopened.state.content).nodes[0].text, 'Local');
  room.doc.transact(() => resolveCanvasExternalConflict(room.doc, 'external'), 'client');
  await room.persist();
  assert.equal(buildCanvasRoomDocument(room.doc).nodes[0].text, 'External');
  assert.equal(state.writes.every((write) => !write.includeContent), true);
});

test('Canvas save notices an external change before its watcher event and preserves malformed external bytes', async (t) => {
  const { room, state } = await createRoom(t);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Local' }), 'client');
  state.content = '{external invalid';
  await room.persist();
  assert.equal(state.content, '{external invalid');
  assert.equal(room.doc.getMap(CANVAS_META_KEY).get('externalConflict').invalid, true);
  assert.throws(() => resolveCanvasExternalConflict(room.doc, 'external'), { code: 'CANVAS_INVALID' });
  room.doc.transact(() => resolveCanvasExternalConflict(room.doc, 'local'), 'client');
  await room.persist();
  assert.equal(JSON.parse(state.content).nodes[0].text, 'Local');
});

test('Canvas rooms preserve identity on renames and cannot resurrect externally deleted content', async (t) => {
  const { room, state } = await createRoom(t);
  const registry = new RoomRegistry({ createRoom: () => room });
  registry.getOrCreate('board.canvas');
  assert.equal(registry.rename('board.canvas', 'renamed.canvas'), true);
  assert.equal(registry.get('renamed.canvas'), room);
  assert.equal(room.name, 'renamed.canvas');
  assert.equal(registry.rename('renamed.canvas', 'renamed.md'), false);
  room.doc.transact(() => updateCanvasNode(room.doc, 'a', { text: 'Pending' }), 'client');
  state.content = null;
  await room.persist();
  assert.equal(room.isDeleted(), true);
  assert.equal(state.content, null);
  assert.equal(state.writes.length, 0);
});

test('Canvas filesystem persistence validates all writes and follows rename and deletion sidecars', async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-canvas-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  const store = new VaultFileStore({ vaultDir });
  const content = '\r\n' + JSON.stringify(CANVAS) + '\r\n';
  assert.equal((await store.createFile('board.canvas', content)).ok, true);
  assert.equal((await store.createFile('upload.canvas', Buffer.from(content))).ok, true);
  assert.equal((await store.createFile('invalid-utf8.canvas', Buffer.from([123, 255, 125]))).ok, false);
  const tree = createWorkspaceTree((await store.scanWorkspaceState()).entries);
  assert.equal(tree[0].type, 'canvas');
  const before = await stat(join(vaultDir, 'board.canvas'));
  assert.equal((await store.persistCollaborationState('board.canvas', { includeContent: false, snapshot: Uint8Array.of(1) })).ok, true);
  assert.equal((await stat(join(vaultDir, 'board.canvas'))).mtimeMs, before.mtimeMs);
  assert.equal(await store.readEditableVaultContent('board.canvas'), content);
  assert.equal((await store.createFile('invalid.canvas', '')).ok, false);
  assert.equal((await store.writeEditableVaultContent('board.canvas', '{bad')).ok, false);
  assert.equal((await store.persistCollaborationState('board.canvas', { content: '{bad' })).ok, false);
  assert.equal((await store.renameFile('board.canvas', 'board.md')).ok, false);
  assert.equal((await store.renameFile('board.canvas', 'renamed.canvas')).ok, true);
  assert.equal(await readFile(join(vaultDir, 'renamed.canvas'), 'utf8'), content);
  assert.deepEqual(await store.readCollaborationSnapshot('renamed.canvas'), Uint8Array.of(1));
  await writeFile(join(vaultDir, 'renamed.canvas'), '{external malformed');
  assert.equal(await store.readEditableVaultContent('renamed.canvas'), '{external malformed');
  assert.equal((await store.deleteFile('renamed.canvas')).ok, true);
  assert.equal(await store.readCollaborationSnapshot('renamed.canvas'), null);
});
