import assert from 'node:assert/strict';

import WebSocket from 'ws';
import * as Y from 'yjs';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';

import { MSG_AWARENESS, MSG_SYNC } from '../../../src/server/domain/collaboration/protocol.js';

function normalizeMessagePayload(payload) {
  return payload instanceof Buffer ? new Uint8Array(payload) : new Uint8Array(payload);
}

export function createSyncMessage() {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  return Buffer.from(encoding.toUint8Array(encoder));
}

export function getMessageType(data) {
  const decoder = decoding.createDecoder(data);
  return decoding.readVarUint(decoder);
}

export function encodeAwarenessMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

export function encodeSyncUpdateMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

export function encodeSyncStep1Message(doc = new Y.Doc()) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return Buffer.from(encoding.toUint8Array(encoder));
}

export function applySyncMessageToDoc(message, doc, origin = 'test') {
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);
  assert.equal(messageType, MSG_SYNC);

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.readSyncMessage(decoder, encoder, doc, origin);

  const reply = encoding.toUint8Array(encoder);
  return reply.length > 1 ? Buffer.from(reply) : null;
}

export async function syncClientDocWithRoom(socket, doc) {
  let handledSyncMessage = false;
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', handleMessage);
      reject(new Error('Timed out while syncing client doc with room'));
    }, 5000);

    function finish() {
      clearTimeout(timer);
      socket.off('message', handleMessage);
      resolve();
    }

    function handleMessage(payload) {
      const data = normalizeMessagePayload(payload);
      if (getMessageType(data) !== MSG_SYNC) {
        return;
      }

      handledSyncMessage = true;
      const reply = applySyncMessageToDoc(data, doc, socket);
      if (reply) {
        socket.send(reply);
      }

      setTimeout(finish, 50);
    }

    socket.on('message', handleMessage);
    socket.send(encodeSyncStep1Message(doc));
  });

  assert.equal(handledSyncMessage, true);
}

export function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

export function waitForUnexpectedResponse(socket) {
  return new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      resolve(response);
    });
    socket.once('error', reject);
  });
}

export function waitForClose(socket) {
  if (socket.readyState === WebSocket.CLOSED) {
    return Promise.resolve({ code: 1005, reason: '' });
  }

  return new Promise((resolve) => {
    socket.once('close', (code, reason) => {
      resolve({
        code,
        reason: reason.toString(),
      });
    });
  });
}

export function waitForMessage(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', handleMessage);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for websocket message`));
    }, timeoutMs);

    function handleMessage(payload) {
      const data = normalizeMessagePayload(payload);
      if (!predicate(data)) {
        return;
      }

      clearTimeout(timer);
      socket.off('message', handleMessage);
      resolve(data);
    }

    socket.on('message', handleMessage);
  });
}

export function collectMessages(socket, predicate, {
  idleMs = 50,
  timeoutMs = 1000,
} = {}) {
  return new Promise((resolve, reject) => {
    const matches = [];
    let idleTimer = null;
    const timeoutTimer = setTimeout(() => {
      cleanup();
      reject(new Error(`Timed out after ${timeoutMs}ms while collecting websocket messages`));
    }, timeoutMs);

    function cleanup() {
      clearTimeout(timeoutTimer);
      clearTimeout(idleTimer);
      socket.off('message', handleMessage);
    }

    function finish() {
      cleanup();
      resolve(matches);
    }

    function scheduleFinish() {
      clearTimeout(idleTimer);
      idleTimer = setTimeout(finish, idleMs);
    }

    function handleMessage(payload) {
      const data = normalizeMessagePayload(payload);
      if (!predicate(data)) {
        return;
      }

      matches.push(data);
      scheduleFinish();
    }

    socket.on('message', handleMessage);
    scheduleFinish();
  });
}

export function waitForProviderSync(provider, timeoutMs = 5000) {
  if (provider.synced) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      provider.off('sync', handleSync);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for provider sync`));
    }, timeoutMs);

    const handleSync = (isSynced) => {
      if (!isSynced) {
        return;
      }

      clearTimeout(timer);
      provider.off('sync', handleSync);
      resolve();
    };

    provider.on('sync', handleSync);
  });
}
