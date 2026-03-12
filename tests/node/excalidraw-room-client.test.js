import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import { ExcalidrawRoomClient } from '../../src/client/infrastructure/excalidraw-room-client.js';

function createFakeAwareness() {
  const states = new Map();
  return {
    clientID: 1,
    getStates() {
      return states;
    },
    off() {},
    on() {},
    setLocalState(value) {
      this.localState = value;
    },
    setLocalStateField(key, value) {
      this.localState = {
        ...(this.localState || {}),
        [key]: value,
      };
      states.set(1, this.localState);
    },
  };
}

function createFakeProvider() {
  const listeners = new Map();
  return {
    awareness: createFakeAwareness(),
    destroy() {
      this.destroyed = true;
    },
    disconnect() {
      this.disconnected = true;
    },
    off(type, handler) {
      listeners.delete(`${type}:${handler}`);
    },
    on(type, handler) {
      listeners.set(`${type}:${handler}`, handler);
    },
    synced: true,
  };
}

function createScene(elementId, {
  color = '#ffffff',
} = {}) {
  return JSON.stringify({
    appState: {
      gridSize: null,
      viewBackgroundColor: color,
    },
    elements: [{
      id: elementId,
      isDeleted: false,
      type: 'rectangle',
      x: 0,
      y: 0,
      width: 100,
      height: 80,
    }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });
}

function parseElements(sceneJson) {
  return JSON.parse(sceneJson).elements.map((element) => element.id);
}

async function createConnectedClient({
  historyLimit,
  historyCaptureWindowMs,
  now = () => Date.now(),
  onRemoteSceneJson = () => {},
} = {}) {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    historyCaptureWindowMs,
    historyLimit,
    now,
    onRemoteSceneJson,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  return { client, provider, ydoc };
}

test('ExcalidrawRoomClient uses an empty scene when no file path is configured', async () => {
  const client = new ExcalidrawRoomClient({ vaultClient: {} });

  const scene = await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  assert.equal(scene.type, 'excalidraw');
  assert.match(client.getLastSceneJson(), /"type":"excalidraw"/);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: false,
    head: -1,
    length: 0,
  });
});

test('ExcalidrawRoomClient seeds and appends shared history during local scene sync', async () => {
  const remoteScenes = [];
  const { client, ydoc } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: false,
    head: 0,
    length: 1,
  });

  client.scheduleSceneSync(
    [{ id: 'shape-1', isDeleted: false }],
    { gridSize: 12, viewBackgroundColor: '#abcdef' },
    {},
  );

  assert.match(ydoc.getText('codemirror').toString(), /shape-1/);
  assert.match(client.getLastSceneJson(), /shape-1/);
  assert.deepEqual(remoteScenes, []);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: true,
    head: 1,
    length: 2,
  });
});

test('ExcalidrawRoomClient coalesces rapid local edits into one shared history entry', async () => {
  let currentTime = 1000;
  const { client } = await createConnectedClient({
    historyCaptureWindowMs: 500,
    now: () => currentTime,
  });

  client.commitSceneJson(createScene('shape-1'), {
    allowCoalesce: true,
    captureTime: currentTime,
    origin: 'test-1',
  });
  currentTime += 250;
  client.commitSceneJson(createScene('shape-2'), {
    allowCoalesce: true,
    captureTime: currentTime,
    origin: 'test-2',
  });

  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: true,
    head: 1,
    length: 2,
  });
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-2']);

  const didUndo = client.undoShared();
  assert.equal(didUndo, true);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: true,
    canUndo: false,
    head: 0,
    length: 2,
  });
  assert.deepEqual(parseElements(client.getActiveSharedHistorySnapshot()), []);
});

test('ExcalidrawRoomClient undo and redo move the shared history head without adding entries', async () => {
  const remoteScenes = [];
  const { client } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  client.commitSceneJson(createScene('shape-1', { color: '#111111' }), { origin: 'test-1' });
  client.commitSceneJson(createScene('shape-2', { color: '#222222' }), { origin: 'test-2' });
  assert.equal(client.getHistoryState().length, 3);

  assert.equal(client.undoShared(), true);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: true,
    canUndo: true,
    head: 1,
    length: 3,
  });
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);

  assert.equal(client.redoShared(), true);
  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: true,
    head: 2,
    length: 3,
  });
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-2']);
  assert.equal(remoteScenes.length >= 2, true);
  assert.equal(client.getHistoryState().length, 3);
});

test('ExcalidrawRoomClient drops redo history after undo followed by a new edit', async () => {
  const { client } = await createConnectedClient();

  client.commitSceneJson(createScene('shape-1'), { origin: 'test-1' });
  client.commitSceneJson(createScene('shape-2'), { origin: 'test-2' });

  assert.equal(client.undoShared(), true);
  assert.equal(client.canRedo(), true);

  client.commitSceneJson(createScene('shape-3'), { origin: 'test-3' });

  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: true,
    head: 2,
    length: 3,
  });
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-3']);
  assert.equal(client.redoShared(), false);
});

test('ExcalidrawRoomClient evicts old snapshots when the shared history reaches its limit', async () => {
  const { client } = await createConnectedClient({ historyLimit: 3 });

  client.commitSceneJson(createScene('shape-1'), { origin: 'test-1' });
  client.commitSceneJson(createScene('shape-2'), { origin: 'test-2' });
  client.commitSceneJson(createScene('shape-3'), { origin: 'test-3' });

  assert.deepEqual(client.getHistoryState(), {
    canRedo: false,
    canUndo: true,
    head: 2,
    length: 3,
  });
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-3']);

  assert.equal(client.undoShared(), true);
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-2']);
  assert.equal(client.undoShared(), true);
  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);
  assert.equal(client.canUndo(), false);
});

test('ExcalidrawRoomClient updates awareness fields for local user, pointer, and selection state', async () => {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();

  const rafCallbacks = [];
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    requestAnimationFrameFn: (callback) => {
      rafCallbacks.push(callback);
      return rafCallbacks.length;
    },
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async readFile() {
        return { content: JSON.stringify({ type: 'excalidraw', version: 2, source: 'collabmd', elements: [], appState: {}, files: {} }) };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  client.setLocalUser({ name: 'Updated Name' });
  client.syncLocalSelectionAwareness({ selectedElementIds: { shapeA: true } });
  client.scheduleLocalPointerAwareness({ button: 'down', pointer: { tool: 'laser', x: 10, y: 20 } });
  client.scheduleLocalViewportAwareness({ scrollX: 12, scrollY: 34, zoom: 1.5 });
  rafCallbacks[0]();
  rafCallbacks[1]();

  assert.equal(provider.awareness.localState.user.name, 'Updated Name');
  assert.deepEqual(provider.awareness.localState.selectedElementIds, { shapeA: true });
  assert.deepEqual(provider.awareness.localState.pointer, { tool: 'laser', x: 10, y: 20 });
  assert.equal(provider.awareness.localState.pointerButton, 'down');
  assert.deepEqual(provider.awareness.localState.viewport, { scrollX: 12, scrollY: 34, zoom: 1.5 });
});
