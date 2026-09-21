import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { ClientSocketSession } from '../../src/server/infrastructure/websocket/client-socket-session.js';
import { createSyncMessage } from './helpers/collaboration-protocol.js';

function createSocket() {
  const socket = new EventEmitter();
  socket.OPEN = 1;
  socket.readyState = 1;
  socket.closed = [];
  socket.pinged = 0;
  socket.send = () => {};
  socket.close = function close(code, reason) {
    this.closed.push({ code, reason });
    this.readyState = 2;
  };
  socket.ping = function ping() {
    this.pinged += 1;
  };
  socket.terminate = function terminate() {
    this.readyState = 3;
  };
  return socket;
}

test('ClientSocketSession flushes queued messages and skips server-initiated initial sync after client sync', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const socket = createSocket();
  const handledPayloads = [];
  let addClientResolved;
  const addClientPromise = new Promise((resolve) => {
    addClientResolved = resolve;
  });
  const room = {
    clients: new Set([socket]),
    addClient: async () => addClientPromise,
    handleMessage: (_ws, payload) => {
      handledPayloads.push(payload);
    },
    removeClient: () => {
      throw new Error('removeClient should not be called');
    },
    sendInitialSync: () => {
      throw new Error('sendInitialSync should not be called');
    },
  };

  const session = new ClientSocketSession({
    room,
    roomName: 'notes.md',
    ws: socket,
  });

  const initialization = session.initialize();
  socket.emit('message', createSyncMessage());
  const queuedPayload = Buffer.from('queued-message');
  socket.emit('message', queuedPayload);
  addClientResolved();
  await initialization;
  t.mock.timers.tick(1);

  assert.deepEqual(handledPayloads, [createSyncMessage(), queuedPayload]);
});

for (const clientSyncFirst of [true, false]) {
  test(`ClientSocketSession handles client sync ${clientSyncFirst ? 'before' : 'after'} the initial sync timer`, async (t) => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const socket = createSocket();
    const handledPayloads = [];
    let initialSyncCount = 0;
    const room = {
      clients: new Set([socket]),
      addClient: async () => {},
      handleMessage: (_ws, payload) => handledPayloads.push(payload),
      removeClient: () => {},
      sendInitialSync: () => { initialSyncCount += 1; },
    };
    const session = new ClientSocketSession({ room, roomName: 'notes.md', ws: socket });
    t.after(() => session.detach());
    await session.initialize();

    if (!clientSyncFirst) {
      t.mock.timers.tick(1);
      assert.equal(initialSyncCount, 1);
    }
    socket.emit('message', createSyncMessage());
    t.mock.timers.tick(1);

    assert.equal(initialSyncCount, clientSyncFirst ? 0 : 1);
    assert.deepEqual(handledPayloads, [createSyncMessage()]);
  });
}

test('ClientSocketSession removes room client when socket closes before room initialization finishes', async () => {
  const socket = createSocket();
  let addClientResolved;
  const addClientPromise = new Promise((resolve) => {
    addClientResolved = resolve;
  });
  const removedSockets = [];
  const disconnectedRooms = [];
  const room = {
    clients: new Set([socket]),
    addClient: async () => addClientPromise,
    handleMessage: () => {},
    removeClient: (ws) => {
      removedSockets.push(ws);
    },
    sendInitialSync: () => {},
  };

  const session = new ClientSocketSession({
    onDisconnected: (roomName) => {
      disconnectedRooms.push(roomName);
    },
    room,
    roomName: 'notes.md',
    ws: socket,
  });

  const initialization = session.initialize();
  socket.emit('close');
  addClientResolved();
  await initialization;

  assert.deepEqual(removedSockets, [socket]);
  assert.deepEqual(disconnectedRooms, ['notes.md']);
});

test('expired authentication closes the socket and rejects messages during pending room initialization', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const socket = createSocket();
  let resolveRoom;
  const pendingRoom = new Promise((resolve) => { resolveRoom = resolve; });
  const handled = [];
  const removed = [];
  const room = {
    clients: new Set([socket]),
    addClient: () => pendingRoom,
    handleMessage: (_ws, message) => handled.push(message),
    removeClient: (ws) => removed.push(ws),
    sendInitialSync: () => assert.fail('Expired session must not sync'),
  };
  const session = new ClientSocketSession({ expiresAt: 1_100, room, roomName: 'test.md', ws: socket });
  const initializing = session.initialize();
  socket.emit('message', Buffer.from('queued'));
  t.mock.timers.tick(100);
  socket.emit('message', Buffer.from('expired'));
  resolveRoom();
  await initializing;
  assert.equal(socket.closed[0].code, 4001);
  assert.deepEqual(handled, []);
  assert.deepEqual(removed, [socket]);
});

test('long-lived sessions expire without overflowing the timer or accepting late messages', async (t) => {
  t.mock.timers.enable({ apis: ['Date', 'setTimeout'], now: 1_000 });
  const socket = createSocket();
  const handled = [];
  const room = {
    clients: new Set([socket]),
    addClient: async () => {},
    handleMessage: (_ws, message) => handled.push(message),
    removeClient: (ws) => room.clients.delete(ws),
    sendInitialSync: () => {},
  };
  const expiresAt = 1_000 + 2 ** 31 + 100;
  const session = new ClientSocketSession({ expiresAt, room, roomName: 'test.md', ws: socket });
  await session.initialize();
  t.mock.timers.tick(2 ** 31 - 1);
  assert.equal(socket.closed.length, 0);
  // Advancing Date alone exercises the guard when the timer has not yet run.
  t.mock.timers.setTime(expiresAt);
  socket.emit('message', Buffer.from('expired'));
  assert.equal(socket.closed[0].code, 4001);
  assert.equal(room.clients.size, 0);
  assert.deepEqual(handled, []);
});
