import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';
import * as decoding from 'lib0/decoding';
import * as encoding from 'lib0/encoding';

import { buildExcalidrawRoomScene, replaceExcalidrawRoomScene } from '../../src/domain/excalidraw-room-codec.js';
import {
  MSG_AGENT_FLUSH,
  MSG_AGENT_FLUSH_ACK,
} from '../../src/domain/collaboration-protocol.js';
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
    emit(type, payload) {
      if (type === 'sync') {
        this.synced = Boolean(payload);
      }
      listeners.get(type)?.forEach((handler) => handler(payload));
    },
    off(type, handler) {
      listeners.get(type)?.delete(handler);
    },
    on(type, handler) {
      if (!listeners.has(type)) {
        listeners.set(type, new Set());
      }
      listeners.get(type).add(handler);
    },
    messageHandlers: [],
    synced: true,
    ws: {
      OPEN: 1,
      bufferedAmount: 0,
      readyState: 1,
      send() {},
    },
  };
}

function createScene(elementId, {
  color = '#ffffff',
  isDeleted = false,
  version = 1,
  versionNonce = 1,
} = {}) {
  return JSON.stringify({
    appState: {
      gridSize: null,
      viewBackgroundColor: color,
    },
    elements: [{
      id: elementId,
      isDeleted,
      type: 'rectangle',
      version,
      versionNonce,
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
  now = () => Date.now(),
  onCommentThreadsChange = () => {},
  onRemoteSceneJson = () => {},
  setTimeoutFn = (callback) => {
    callback();
    return 1;
  },
} = {}) {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    now,
    onCommentThreadsChange,
    onRemoteSceneJson,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn,
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

test('ExcalidrawRoomClient waits for the server to acknowledge ordered room writes', async () => {
  const { client, provider } = await createConnectedClient({
    setTimeoutFn: (callback, delay) => setTimeout(callback, delay),
  });
  const sentMessages = [];
  provider.ws.send = (payload) => {
    sentMessages.push(payload);
    const requestDecoder = decoding.createDecoder(payload);
    assert.equal(decoding.readVarUint(requestDecoder), MSG_AGENT_FLUSH);
    const requestId = decoding.readVarString(requestDecoder);
    const ackEncoder = encoding.createEncoder();
    encoding.writeVarUint(ackEncoder, MSG_AGENT_FLUSH_ACK);
    encoding.writeVarString(ackEncoder, requestId);
    const ackDecoder = decoding.createDecoder(encoding.toUint8Array(ackEncoder));
    decoding.readVarUint(ackDecoder);
    provider.messageHandlers[MSG_AGENT_FLUSH_ACK]?.(
      encoding.createEncoder(),
      ackDecoder,
      provider,
    );
  };

  assert.equal(typeof provider.messageHandlers[MSG_AGENT_FLUSH_ACK], 'function');
  const flushPromise = client.waitForServerFlush();
  assert.equal(sentMessages.length, 1);
  const result = await flushPromise;

  assert.deepEqual(result, { status: 'acknowledged' });
  assert.equal(sentMessages.length, 1);
  client.disconnect();
});

test('ExcalidrawRoomClient uses an empty scene when no file path is configured', async () => {
  const client = new ExcalidrawRoomClient({ vaultClient: {} });

  const scene = await client.connect({
    initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
  });

  assert.equal(scene.type, 'excalidraw');
  assert.match(client.getLastSceneJson(), /"type":"excalidraw"/);
});

test('ExcalidrawRoomClient marks disk/agent scene replaces as authoritative', async () => {
  const remoteCalls = [];
  const { client, ydoc } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson, meta = {}) => {
      remoteCalls.push({
        authoritative: Boolean(meta.authoritative),
        ids: parseElements(sceneJson),
      });
    },
  });

  remoteCalls.length = 0;
  ydoc.transact(() => {
    replaceExcalidrawRoomScene(ydoc, JSON.parse(createScene('agent-shape')));
  }, 'workspace-reconcile');

  assert.equal(remoteCalls.length, 1);
  assert.equal(remoteCalls[0].authoritative, true);
  assert.deepEqual(remoteCalls[0].ids, ['agent-shape']);
  client.disconnect();
});

test('ExcalidrawRoomClient syncs local scene updates into the structured room state', async () => {
  const remoteScenes = [];
  const { client, ydoc } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  client.scheduleSceneSync(
    [{ id: 'shape-1', isDeleted: false }],
    { gridSize: 12, viewBackgroundColor: '#abcdef' },
    {},
  );

  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id), ['shape-1']);
  assert.match(client.getLastSceneJson(), /shape-1/);
  assert.deepEqual(remoteScenes, []);
});

test('ExcalidrawRoomClient does not echo a shared scene application as a local edit', async () => {
  const { client, ydoc } = await createConnectedClient();
  client.beginApplyingSharedSnapshot();
  const scheduled = client.scheduleSceneSync(
    [{ id: 'normalized-echo', isDeleted: false }],
    { gridSize: null, viewBackgroundColor: '#ffffff' },
    {},
  );
  client.endApplyingSharedSnapshot();

  assert.equal(scheduled, false);
  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements, []);
});

test('ExcalidrawRoomClient creates, replies to, and resolves diagram comment threads', async () => {
  const commentUpdates = [];
  const { client } = await createConnectedClient({
    onCommentThreadsChange: (threads) => commentUpdates.push(threads),
  });

  const threadId = client.createCommentThread({
    body: 'Add the owner here',
    element: {
      height: 40,
      id: 'shape-1',
      text: 'Architecture node',
      type: 'rectangle',
      width: 80,
      x: 100,
      y: 60,
    },
  });

  assert.equal(typeof threadId, 'string');
  let [thread] = client.getCommentThreads();
  assert.equal(thread.anchorKind, 'diagram-element');
  assert.equal(thread.elementId, 'shape-1');
  assert.deepEqual(thread.anchorPoint, { x: 140, y: 80 });
  assert.deepEqual(thread.anchorSnapshot, {
    height: 40,
    text: 'Architecture node',
    type: 'rectangle',
    width: 80,
    x: 100,
    y: 60,
  });
  assert.equal(thread.messages[0].body, 'Add the owner here');

  const replyId = client.replyToCommentThread(threadId, 'Reviewer will own it.');
  assert.equal(typeof replyId, 'string');
  [thread] = client.getCommentThreads();
  assert.deepEqual(thread.messages.map((message) => message.body), [
    'Add the owner here',
    'Reviewer will own it.',
  ]);

  assert.equal(client.deleteCommentThread(threadId), true);
  assert.deepEqual(client.getCommentThreads(), []);
  assert.ok(commentUpdates.some((threads) => threads.some((item) => item.id === threadId)));

  client.disconnect();
});

test('ExcalidrawRoomClient rejects fallback writes before authoritative sync', async () => {
  const provider = createFakeProvider();
  provider.synced = false;
  const ydoc = new Y.Doc();
  const states = [];
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    onConnectionStateChange: ({ state }) => states.push(state),
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      queueMicrotask(callback);
      return 1;
    },
    syncTimeoutMs: 0,
    vaultClient: {
      async readFile() {
        return { content: createScene('saved-shape') };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect();

  assert.equal(client.getConnectionState(), 'fallback-readonly');
  assert.equal(client.canWriteToRoom, false);
  assert.equal(client.scheduleSceneSync(
    [{ id: 'fallback-edit', isDeleted: false, version: 1, versionNonce: 1 }],
    {},
    {},
  ), false);
  assert.equal(client.hasPendingWrites(), false);
  assert.equal(client.flushSceneSync(), false);
  assert.equal(client.commitSceneJson(createScene('fallback-edit')), false);
  assert.equal(client.createCommentThread({
    body: 'Should stay read-only',
    element: { height: 20, id: 'fallback-shape', width: 20, x: 0, y: 0 },
  }), null);
  assert.equal(client.replyToCommentThread('missing-thread', 'Should stay read-only'), null);
  assert.equal(client.deleteCommentThread('missing-thread'), false);
  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements, []);
  assert.deepEqual(states, ['connecting', 'fallback-readonly']);

  client.disconnect();
});

test('ExcalidrawRoomClient retains pending authoritative edits while reconnecting', async () => {
  const timers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
    },
    vaultClient: {
      async readFile() {
        return { content: createScene('saved-shape') };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await client.connect();
  client.scheduleSceneSync(
    [{ id: 'queued-shape', isDeleted: false, version: 1, versionNonce: 1 }],
    {},
    {},
  );
  provider.emit('sync', false);

  assert.equal(client.getConnectionState(), 'reconnecting-readonly');
  assert.equal(client.hasPendingWrites(), true);
  assert.equal(client.flushSceneSync(), false);
  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id), ['saved-shape']);

  provider.emit('sync', true);
  assert.equal(client.getConnectionState(), 'authoritative');
  assert.equal(client.flushSceneSync(), true);
  assert.deepEqual(
    buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id).sort(),
    ['queued-shape', 'saved-shape'],
  );

  client.disconnect();
});

test('ExcalidrawRoomClient preserves concurrent remote app state while flushing queued element updates', async () => {
  const timers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
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
  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });

  client.scheduleSceneSync(
    [{ id: 'shape-1', isDeleted: false, type: 'rectangle', version: 2, versionNonce: 1, x: 20, y: 0, width: 100, height: 80 }],
    { gridSize: null, viewBackgroundColor: '#ffffff' },
    {},
  );
  client.commitSceneJson(createScene('shape-1', { color: '#dbeafe' }), { origin: 'remote-background-change' });

  timers.shift().callback();

  const scene = buildExcalidrawRoomScene(ydoc);
  assert.equal(scene.appState.viewBackgroundColor, '#dbeafe');
  assert.equal(scene.elements[0].x, 20);
});

test('ExcalidrawRoomClient builds live sync deltas with only changed elements and files', async () => {
  const { client } = await createConnectedClient();
  client.commitSceneJson(JSON.stringify({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    elements: [
      JSON.parse(createScene('shape-1')).elements[0],
      JSON.parse(createScene('shape-2')).elements[0],
    ],
    files: {
      imageA: { id: 'imageA', version: 1 },
    },
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  }), { origin: 'seed-shapes' });
  client.getStructuredSceneJson = () => {
    throw new Error('live delta should use the cached room scene');
  };

  const changedShape = {
    ...JSON.parse(createScene('shape-1')).elements[0],
    version: 2,
    x: 30,
  };
  const unchangedShape = JSON.parse(createScene('shape-2')).elements[0];
  const delta = client.buildLiveSceneDelta({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    baseSceneJson: client.getLastSceneJson(),
    elements: [changedShape, unchangedShape],
    files: {
      imageA: { id: 'imageA', version: 1 },
      imageB: { id: 'imageB', version: 1 },
    },
  });

  assert.equal(delta.hasChanges, true);
  assert.deepEqual(delta.scene.elements.map((element) => element.id), ['shape-1']);
  assert.deepEqual(Object.keys(delta.scene.files), ['imageB']);
});

test('ExcalidrawRoomClient ignores restored same-version element object differences in live deltas', async () => {
  const { client } = await createConnectedClient();
  const seededElement = JSON.parse(createScene('shape-1', { version: 3, versionNonce: 10 })).elements[0];
  client.commitSceneJson(JSON.stringify({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    elements: [seededElement],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  }), { origin: 'seed-shape' });

  const delta = client.buildLiveSceneDelta({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    baseSceneJson: client.getLastSceneJson(),
    elements: [{
      ...seededElement,
      restoredLocalOnlyField: true,
    }],
    files: {},
  });

  assert.equal(delta.hasChanges, false);
  assert.deepEqual(delta.scene.elements, []);
});

test('ExcalidrawRoomClient follows lower versionNonce tie-breaks in live deltas', async () => {
  const { client } = await createConnectedClient();
  const seededElement = JSON.parse(createScene('shape-1', { version: 3, versionNonce: 10 })).elements[0];
  client.commitSceneJson(JSON.stringify({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    elements: [seededElement],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  }), { origin: 'seed-shape' });

  const lowerNonceDelta = client.buildLiveSceneDelta({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    baseSceneJson: client.getLastSceneJson(),
    elements: [{
      ...seededElement,
      versionNonce: 4,
      x: 40,
    }],
    files: {},
  });
  const higherNonceDelta = client.buildLiveSceneDelta({
    appState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    baseSceneJson: client.getLastSceneJson(),
    elements: [{
      ...seededElement,
      versionNonce: 20,
      x: 60,
    }],
    files: {},
  });

  assert.deepEqual(lowerNonceDelta.scene.elements.map((element) => element.x), [40]);
  assert.equal(higherNonceDelta.hasChanges, false);
});

test('ExcalidrawRoomClient reschedules delayed empty-scene commits when newer local changes arrive', async () => {
  let currentTime = 1000;
  const timers = [];
  const clearedTimers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  const client = new ExcalidrawRoomClient({
    clearTimeoutFn: (timerId) => {
      clearedTimers.push(timerId);
    },
    filePath: 'diagram.excalidraw',
    now: () => currentTime,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
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
  client.lastSceneSyncAt = currentTime;
  provider.awareness.getStates().set(2, {
    user: {
      color: '#222222',
      colorLight: '#22222233',
      name: 'Remote User',
      peerId: 'peer-2',
    },
  });
  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });

  client.scheduleSceneSync(
    [],
    {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    {},
  );
  assert.equal(timers[0].delay, 48);

  currentTime = 1048;
  timers[0].callback();
  assert.equal(timers[1].delay, 250);

  currentTime = 1050;
  client.scheduleSceneSync(
    [{ id: 'shape-1', isDeleted: false, type: 'rectangle', version: 2, versionNonce: 1, x: 10, y: 0, width: 100, height: 80 }],
    {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    {},
  );

  assert.deepEqual(clearedTimers, [2]);
  assert.equal(timers[2].delay, 0);
  timers[2].callback();
  assert.equal(buildExcalidrawRoomScene(ydoc).elements.find((element) => element.id === 'shape-1').x, 10);
});

test('ExcalidrawRoomClient commitSceneJson merges successive local scenes into the room', async () => {
  const { client, ydoc } = await createConnectedClient();

  assert.equal(client.commitSceneJson(createScene('shape-1', { color: '#111111' }), { origin: 'test-1' }), true);
  assert.equal(client.commitSceneJson(createScene('shape-2', { color: '#222222' }), { origin: 'test-2' }), true);

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1', 'shape-2']);
  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id), ['shape-1', 'shape-2']);
});

test('ExcalidrawRoomClient avoids rewriting the room when the scene is unchanged', async () => {
  const { client, ydoc } = await createConnectedClient();

  assert.equal(client.commitSceneJson(createScene('shape-1'), { origin: 'test-1' }), true);
  const updateBaseline = Y.encodeStateAsUpdate(ydoc);

  assert.equal(client.commitSceneJson(createScene('shape-1'), { origin: 'test-1-repeat' }), false);
  assert.deepEqual(Array.from(Y.encodeStateAsUpdate(ydoc)), Array.from(updateBaseline));
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
  client.scheduleLocalViewportAwareness({ scrollX: '12', scrollY: 34, zoom: '1.5' });
  for (const viewport of [null, {}, { scrollX: 0, scrollY: 0, zoom: 0 }, { scrollX: Infinity, scrollY: 0, zoom: 1 }]) {
    client.scheduleLocalViewportAwareness(viewport);
  }
  assert.equal(rafCallbacks.length, 2);
  rafCallbacks[0]();
  rafCallbacks[1]();

  assert.equal(provider.awareness.localState.user.name, 'Updated Name');
  assert.deepEqual(provider.awareness.localState.selectedElementIds, { shapeA: true });
  assert.deepEqual(provider.awareness.localState.pointer, { tool: 'laser', x: 10, y: 20 });
  assert.equal(provider.awareness.localState.pointerButton, 'down');
  assert.deepEqual(provider.awareness.localState.viewport, { scrollX: 12, scrollY: 34, zoom: 1.5 });
});

test('ExcalidrawRoomClient rereads the file after a create conflict instead of falling back to an empty scene', async () => {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  let readCount = 0;

  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async createFile() {
        const error = new Error('File already exists');
        error.status = 409;
        throw error;
      },
      async readFile() {
        readCount += 1;
        if (readCount === 1) {
          const error = new Error('File not found');
          error.status = 404;
          throw error;
        }

        return { content: createScene('shape-existing') };
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  const scene = await client.loadSceneFromApi({ createIfMissing: true });

  assert.deepEqual(scene.elements.map((element) => element.id), ['shape-existing']);
});

test('ExcalidrawRoomClient does not recreate a missing file during connect', async () => {
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();
  let createCalls = 0;

  const client = new ExcalidrawRoomClient({
    filePath: 'deleted.excalidraw',
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback) => {
      callback();
      return 1;
    },
    vaultClient: {
      async createFile() {
        createCalls += 1;
        return { ok: true };
      },
      async readFile() {
        const error = new Error('File not found');
        error.status = 404;
        throw error;
      },
    },
    websocketProviderFactory: () => provider,
    ydocFactory: () => ydoc,
  });

  await assert.rejects(
    client.connect({
      initialUser: { color: '#111111', colorLight: '#11111133', name: 'Andes', peerId: 'peer-1' },
    }),
    /File not found/,
  );
  assert.equal(createCalls, 0);
  assert.equal(provider.disconnected, true);
  assert.equal(provider.destroyed, true);
  assert.equal(client.provider, null);
  assert.equal(client.ydoc, null);
});

test('ExcalidrawRoomClient delays transient empty scene commits during active collaboration', async () => {
  let currentTime = 1000;
  const timers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();

  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    now: () => currentTime,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
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

  provider.awareness.getStates().set(2, {
    user: { color: '#222222', colorLight: '#22222233', name: 'Remote', peerId: 'peer-2' },
  });

  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });
  client.scheduleSceneSync([], { gridSize: null, viewBackgroundColor: '#ffffff' }, {});
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);
  assert.equal(timers.length, 1);

  client.scheduleSceneSync([{ id: 'shape-2', isDeleted: false }], { gridSize: null, viewBackgroundColor: '#ffffff' }, {});
  currentTime += 25;
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1', 'shape-2']);
});

test('ExcalidrawRoomClient keeps existing elements when delayed empty payload has no tombstones', async () => {
  let currentTime = 1000;
  const timers = [];
  const provider = createFakeProvider();
  const ydoc = new Y.Doc();

  const client = new ExcalidrawRoomClient({
    filePath: 'diagram.excalidraw',
    emptySceneGuardMs: 200,
    now: () => currentTime,
    resolveWsBaseUrlFn: () => 'ws://localhost:3000',
    setTimeoutFn: (callback, delay) => {
      timers.push({ callback, delay });
      return timers.length;
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

  provider.awareness.getStates().set(2, {
    user: { color: '#222222', colorLight: '#22222233', name: 'Remote', peerId: 'peer-2' },
  });

  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });
  client.scheduleSceneSync([], { gridSize: null, viewBackgroundColor: '#ffffff' }, {});
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);
  assert.equal(timers.length, 1);

  currentTime += 250;
  timers.shift().callback();

  assert.deepEqual(parseElements(client.getLastSceneJson()), ['shape-1']);
  assert.deepEqual(buildExcalidrawRoomScene(ydoc).elements.map((element) => element.id), ['shape-1']);
});

test('ExcalidrawRoomClient applies explicit delete tombstones to live room state', async () => {
  const { client, ydoc } = await createConnectedClient();

  client.commitSceneJson(createScene('shape-1', { version: 1 }), { origin: 'seed-shape' });
  client.commitSceneJson(createScene('shape-1', { isDeleted: true, version: 2 }), { origin: 'delete-shape' });

  const liveScene = buildExcalidrawRoomScene(ydoc);
  assert.equal(liveScene.elements.length, 1);
  assert.equal(liveScene.elements[0].id, 'shape-1');
  assert.equal(liveScene.elements[0].isDeleted, true);
});

test('ExcalidrawRoomClient ignores malformed legacy room text when structured state is authoritative', async () => {
  const remoteScenes = [];
  const { client, ydoc } = await createConnectedClient({
    onRemoteSceneJson: (sceneJson) => remoteScenes.push(sceneJson),
  });

  client.commitSceneJson(createScene('shape-1'), { origin: 'seed-shape' });
  const before = client.getLastSceneJson();

  ydoc.transact(() => {
    const legacyText = ydoc.getText('codemirror');
    legacyText.insert(0, '{"broken":');
  }, 'test-invalid-legacy');

  assert.equal(client.getLastSceneJson(), before);
  assert.equal(remoteScenes.length, 0);
});
