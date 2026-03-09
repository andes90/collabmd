import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

import WebSocket from 'ws';
import * as Y from 'yjs';
import * as awarenessProtocol from 'y-protocols/awareness';
import * as syncProtocol from 'y-protocols/sync';
import * as encoding from 'lib0/encoding';
import * as decoding from 'lib0/decoding';
import { WebsocketProvider } from 'y-websocket';

import { MSG_AWARENESS, MSG_SYNC } from '../../src/server/domain/collaboration/protocol.js';
import { startTestServer, waitForCondition } from './helpers/test-server.js';

function waitForOpen(socket) {
  if (socket.readyState === WebSocket.OPEN) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    socket.once('open', resolve);
    socket.once('error', reject);
  });
}

function waitForUnexpectedResponse(socket) {
  return new Promise((resolve, reject) => {
    socket.once('unexpected-response', (_request, response) => {
      resolve(response);
    });
    socket.once('error', reject);
  });
}

function waitForClose(socket) {
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

function waitForMessage(socket, predicate, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off('message', handleMessage);
      reject(new Error(`Timed out after ${timeoutMs}ms waiting for websocket message`));
    }, timeoutMs);

    function handleMessage(payload) {
      const data = payload instanceof Buffer ? new Uint8Array(payload) : new Uint8Array(payload);
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

function getMessageType(data) {
  const decoder = decoding.createDecoder(data);
  return decoding.readVarUint(decoder);
}

function encodeAwarenessMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_AWARENESS);
  encoding.writeVarUint8Array(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

function encodeSyncUpdateMessage(update) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeUpdate(encoder, update);
  return Buffer.from(encoding.toUint8Array(encoder));
}

function encodeSyncStep1Message(doc) {
  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.writeSyncStep1(encoder, doc);
  return Buffer.from(encoding.toUint8Array(encoder));
}

async function syncClientDocWithRoom(socket, doc) {
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
      const data = payload instanceof Buffer ? new Uint8Array(payload) : new Uint8Array(payload);
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

function applySyncMessageToDoc(message, doc, origin = 'test') {
  const decoder = decoding.createDecoder(message);
  const messageType = decoding.readVarUint(decoder);
  assert.equal(messageType, MSG_SYNC);

  const encoder = encoding.createEncoder();
  encoding.writeVarUint(encoder, MSG_SYNC);
  syncProtocol.readSyncMessage(decoder, encoder, doc, origin);

  const reply = encoding.toUint8Array(encoder);
  return reply.length > 1 ? Buffer.from(reply) : null;
}

function waitForProviderSync(provider, timeoutMs = 5000) {
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

async function fileExists(filePath) {
  try {
    await stat(filePath);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }
    throw error;
  }
}

async function loginForCookie(app, password) {
  const response = await fetch(`${app.baseUrl}/api/auth/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  assert.equal(response.status, 200);
  const cookieHeader = response.headers.get('set-cookie') || '';
  return cookieHeader.split(';')[0];
}

test('WebSocket collaboration broadcasts awareness and persists vault file', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  // Connect two clients to the seeded test.md file
  const filePath = 'test.md';
  const ws1 = new WebSocket(app.wsUrl(filePath));
  const ws2 = new WebSocket(app.wsUrl(filePath));
  t.after(async () => {
    ws1.close();
    ws2.close();
    await Promise.allSettled([waitForClose(ws1), waitForClose(ws2)]);
  });

  await Promise.all([waitForOpen(ws1), waitForOpen(ws2)]);
  await Promise.all([
    waitForMessage(ws1, (data) => getMessageType(data) === MSG_SYNC),
    waitForMessage(ws2, (data) => getMessageType(data) === MSG_SYNC),
  ]);

  // Client 1 sends awareness state
  const awareness = new awarenessProtocol.Awareness(new Y.Doc());
  awareness.setLocalStateField('user', {
    color: '#0ea5e9',
    colorLight: '#0ea5e933',
    name: 'Integration User',
  });
  ws1.send(encodeAwarenessMessage(
    awarenessProtocol.encodeAwarenessUpdate(awareness, [awareness.clientID]),
  ));

  // Client 2 should receive the awareness broadcast
  const awarenessMessage = await waitForMessage(ws2, (data) => getMessageType(data) === MSG_AWARENESS);
  const awarenessDecoder = decoding.createDecoder(awarenessMessage);
  decoding.readVarUint(awarenessDecoder);
  const remoteAwareness = new awarenessProtocol.Awareness(new Y.Doc());
  awarenessProtocol.applyAwarenessUpdate(
    remoteAwareness,
    decoding.readVarUint8Array(awarenessDecoder),
    'test',
  );
  assert.equal(remoteAwareness.getStates().get(awareness.clientID)?.user?.name, 'Integration User');

  // Client 1 sends a document update
  const clientDoc = new Y.Doc();
  clientDoc.getText('codemirror').insert(0, '# Persisted from test');
  ws1.send(encodeSyncUpdateMessage(Y.encodeStateAsUpdate(clientDoc)));

  // Client 2 should receive the sync update
  await waitForMessage(ws2, (data) => getMessageType(data) === MSG_SYNC);

  // Close both clients
  ws1.close();
  ws2.close();
  await Promise.all([waitForClose(ws1), waitForClose(ws2)]);

  // Wait for the room to drain
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  // The vault file store persists plain text to disk — verify it
  const diskContent = await waitForCondition(async () => {
    const content = await readFile(join(app.vaultDir, filePath), 'utf-8');
    return content.includes('Persisted from test') ? content : null;
  });

  assert.ok(diskContent.includes('# Persisted from test'));
});

test('WebSocket collaboration rejects unauthorized clients when password auth is enabled', async (t) => {
  const app = await startTestServer({
    auth: {
      password: 'ws-secret-password',
      strategy: 'password',
    },
  });
  t.after(() => app.close());

  const unauthorizedSocket = new WebSocket(app.wsUrl('test.md'));
  const unauthorizedResponse = await waitForUnexpectedResponse(unauthorizedSocket);
  assert.equal(unauthorizedResponse.statusCode, 401);
  unauthorizedSocket.terminate();

  const cookieHeader = await loginForCookie(app, 'ws-secret-password');
  const authorizedSocket = new WebSocket(app.wsUrl('test.md'), {
    headers: {
      Cookie: cookieHeader,
    },
  });
  t.after(async () => {
    authorizedSocket.close();
    await Promise.allSettled([waitForClose(authorizedSocket)]);
  });

  await waitForOpen(authorizedSocket);
  const firstMessage = await waitForMessage(authorizedSocket, () => true);
  assert.equal(getMessageType(firstMessage), MSG_SYNC);
});

test('WebSocket server rejects oversized payloads', async (t) => {
  const app = await startTestServer({
    wsMaxPayloadBytes: 128,
  });
  t.after(() => app.close());

  const ws = new WebSocket(app.wsUrl('test.md'));
  t.after(async () => {
    ws.close();
    await Promise.allSettled([waitForClose(ws)]);
  });

  await waitForOpen(ws);
  await waitForMessage(ws, (data) => getMessageType(data) === MSG_SYNC);

  ws.send(Buffer.alloc(1024, 1));

  const closeEvent = await waitForClose(ws);
  assert.equal(closeEvent.code, 1009);
});

test('WebSocket collaboration preserves Yjs history across short reconnect gaps', async (t) => {
  const app = await startTestServer({
    wsRoomIdleGraceMs: 1_000,
  });
  t.after(() => app.close());

  const serverUrl = `ws://127.0.0.1:${app.port}${app.server.config.wsBasePath}`;
  const filePath = 'test.md';
  const sharedDoc = new Y.Doc();

  const providerA = new WebsocketProvider(serverUrl, filePath, sharedDoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  t.after(() => providerA.destroy());

  await waitForProviderSync(providerA);
  assert.equal(sharedDoc.getText('codemirror').toString(), '# Test\n\nHello from test vault.\n');

  providerA.destroy();
  await waitForCondition(() => app.server.roomRegistry.get(filePath), { timeoutMs: 2_000 });

  const providerB = new WebsocketProvider(serverUrl, filePath, sharedDoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
  t.after(() => providerB.destroy());

  await waitForProviderSync(providerB);
  sharedDoc.transact(() => {
    const ytext = sharedDoc.getText('codemirror');
    ytext.insert(ytext.length, '\nReconnect-safe edit.\n');
  }, 'test-reconnect-edit');

  const diskContent = await waitForCondition(async () => {
    const content = await readFile(join(app.vaultDir, filePath), 'utf-8');
    return content.includes('Reconnect-safe edit.') ? content : null;
  }, { timeoutMs: 5_000 });

  assert.equal(diskContent, '# Test\n\nHello from test vault.\n\nReconnect-safe edit.\n');
});

test('Renaming an active room keeps persistence on the new path', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const ws = new WebSocket(app.wsUrl('test.md'));
  t.after(async () => {
    ws.close();
    await Promise.allSettled([waitForClose(ws)]);
  });

  await waitForOpen(ws);
  await waitForMessage(ws, (data) => getMessageType(data) === MSG_SYNC);

  const renameResponse = await fetch(`${app.baseUrl}/api/file`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ oldPath: 'test.md', newPath: 'renamed.md' }),
  });
  const renameData = await renameResponse.json();
  assert.equal(renameResponse.status, 200);
  assert.equal(renameData.ok, true);

  ws.close();
  await waitForClose(ws);
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  await waitForCondition(async () => {
    const exists = await fileExists(join(app.vaultDir, 'renamed.md'));
    return exists ? true : null;
  });

  assert.equal(await fileExists(join(app.vaultDir, 'test.md')), false);
  assert.equal(await fileExists(join(app.vaultDir, 'renamed.md')), true);
});

test('Deleting an active room does not recreate file on disconnect', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const ws = new WebSocket(app.wsUrl('test.md'));
  t.after(async () => {
    ws.close();
    await Promise.allSettled([waitForClose(ws)]);
  });

  await waitForOpen(ws);
  await waitForMessage(ws, (data) => getMessageType(data) === MSG_SYNC);

  const deleteResponse = await fetch(`${app.baseUrl}/api/file?path=${encodeURIComponent('test.md')}`, {
    method: 'DELETE',
  });
  const deleteData = await deleteResponse.json();
  assert.equal(deleteResponse.status, 200);
  assert.equal(deleteData.ok, true);

  ws.close();
  await waitForClose(ws);
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  await new Promise((resolve) => setTimeout(resolve, 700));
  assert.equal(await fileExists(join(app.vaultDir, 'test.md')), false);
});

test('WebSocket collaboration persists excalidraw room content to .excalidraw files', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const scenePath = 'diagram.excalidraw';
  const createResponse = await fetch(`${app.baseUrl}/api/file`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: JSON.stringify({
        appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
        elements: [],
        files: {},
        source: 'collabmd',
        type: 'excalidraw',
        version: 2,
      }),
      path: scenePath,
    }),
  });
  assert.ok(createResponse.status === 201 || createResponse.status === 409);

  const ws = new WebSocket(app.wsUrl(scenePath));
  t.after(async () => {
    ws.close();
    await Promise.allSettled([waitForClose(ws)]);
  });

  await waitForOpen(ws);
  const initialSync = await waitForMessage(ws, (data) => getMessageType(data) === MSG_SYNC);

  const syncedSceneJson = JSON.stringify({
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'shape-1', type: 'rectangle' }],
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  });

  const clientDoc = new Y.Doc();
  const syncReply = applySyncMessageToDoc(initialSync, clientDoc, ws);
  if (syncReply) {
    ws.send(syncReply);
  }

  const ytext = clientDoc.getText('codemirror');
  clientDoc.transact(() => {
    if (ytext.length > 0) {
      ytext.delete(0, ytext.length);
    }
    ytext.insert(0, syncedSceneJson);
  }, 'test-replace-scene');
  ws.send(encodeSyncUpdateMessage(Y.encodeStateAsUpdate(clientDoc)));

  ws.close();
  await waitForClose(ws);
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  const diskContent = await waitForCondition(async () => {
    const content = await readFile(join(app.vaultDir, scenePath), 'utf-8');
    return content.includes('"shape-1"') ? content : null;
  });

  assert.ok(diskContent.includes('"shape-1"'));
});

test('WebSocket room rehydration does not duplicate markdown content on reconnect with the same Yjs doc', async (t) => {
  const app = await startTestServer();
  t.after(() => app.close());

  const filePath = 'test.md';
  const diskPath = join(app.vaultDir, filePath);
  const originalContent = await readFile(diskPath, 'utf-8');
  const clientDoc = new Y.Doc();

  const ws1 = new WebSocket(app.wsUrl(filePath));
  await waitForOpen(ws1);
  await syncClientDocWithRoom(ws1, clientDoc);
  ws1.close();
  await waitForClose(ws1);
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  const ws2 = new WebSocket(app.wsUrl(filePath));
  await waitForOpen(ws2);
  await syncClientDocWithRoom(ws2, clientDoc);
  ws2.close();
  await waitForClose(ws2);
  await waitForCondition(() => app.server.roomRegistry.rooms.size === 0);

  const diskContent = await waitForCondition(async () => {
    const content = await readFile(diskPath, 'utf-8');
    return content.length === originalContent.length ? content : null;
  });

  assert.equal(diskContent, originalContent);
});
