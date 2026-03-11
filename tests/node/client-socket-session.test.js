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

test('ClientSocketSession flushes queued messages and skips server-initiated initial sync after client sync', async () => {
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
  await new Promise((resolve) => setTimeout(resolve, 10));

  assert.deepEqual(handledPayloads, [createSyncMessage(), queuedPayload]);
});

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
