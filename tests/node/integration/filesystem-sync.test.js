import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

import WebSocket from 'ws';
import * as Y from 'yjs';
import { WebsocketProvider } from 'y-websocket';

import { WORKSPACE_ROOM_NAME } from '../../../src/domain/workspace-room.js';
import { startTestServer, waitForCondition } from '../helpers/test-server.js';
import { waitForProviderSync } from '../helpers/collaboration-protocol.js';

function createProvider(app, roomName, ydoc) {
  return new WebsocketProvider(`ws://127.0.0.1:${app.port}${app.server.config.wsBasePath}`, roomName, ydoc, {
    WebSocketPolyfill: WebSocket,
    disableBc: true,
  });
}

function emitWatchEvents(app, ...paths) {
  paths.forEach((pathValue) => {
    app.server.fileSystemSyncService.handleWatchEvent('rename', pathValue);
  });
}

test('managed saves after Git preserve snapshot identities when a client reconnects', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());
  const doc = new Y.Doc();
  let provider = createProvider(app, 'test.md', doc);
  t.after(() => { provider.destroy(); doc.destroy(); });
  await waitForProviderSync(provider);
  const room = app.server.roomRegistry.get('test.md');
  const expected = `after Git\n${doc.getText('codemirror').toString()}`;

  await app.server.workspaceMutationCoordinator.runManagedWorkspaceMutation(async () => {});
  doc.getText('codemirror').insert(0, 'after Git\n');
  await waitForCondition(() => room.doc.getText('codemirror').toString() === expected);
  await room.persist();
  emitWatchEvents(app, 'test.md');
  await app.server.fileSystemSyncService.flushPendingChanges();
  assert.ok(await app.server.vaultFileStore.readCollaborationSnapshot('test.md'));

  // Discard live rooms without a final save, as after a process interruption.
  await app.server.roomRegistry.reset();
  provider.destroy();
  provider = createProvider(app, 'test.md', doc);
  await waitForProviderSync(provider);
  assert.equal(doc.getText('codemirror').toString(), expected);
  const restored = app.server.roomRegistry.get('test.md');
  assert.equal(restored.doc.getText('codemirror').toString(), expected);
  doc.getText('codemirror').insert(0, 'reconnected\n');
  await waitForCondition(() => restored.doc.getText('codemirror').toString() === `reconnected\n${expected}`);
  await restored.persist();
  assert.equal(await app.server.vaultFileStore.readEditableVaultContent('test.md'), `reconnected\n${expected}`);
});

for (const operation of ['rename', 'delete']) {
  test(`${operation} keeps a paused room alive when its last collaborator disconnects`, async (t) => {
    const app = await startTestServer({ fileWatcherEnabled: false, wsRoomIdleGraceMs: 0 });
    t.after(() => app.close());
    const doc = new Y.Doc();
    const provider = createProvider(app, 'test.md', doc);
    t.after(() => { provider.destroy(); doc.destroy(); });
    await waitForProviderSync(provider);
    const room = app.server.roomRegistry.get('test.md');
    const expected = `pending edit\n${doc.getText('codemirror').toString()}`;
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const store = app.server.vaultFileStore;
    const method = operation === 'rename' ? 'renameFile' : 'deleteFile';
    const mutate = store[method].bind(store);
    t.mock.method(store, method, async (...args) => {
      entered.resolve();
      await release.promise;
      return mutate(...args);
    });
    const changing = operation === 'rename'
      ? fetch(`${app.baseUrl}/api/file`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ oldPath: 'test.md', newPath: 'moved.md' }),
      })
      : fetch(`${app.baseUrl}/api/file?path=test.md`, { method: 'DELETE' });
    let response;
    try {
      await entered.promise;
      doc.getText('codemirror').insert(0, 'pending edit\n');
      await waitForCondition(() => room.doc.getText('codemirror').toString() === expected);
      provider.destroy();
      await waitForCondition(() => room.clients.size === 0);
      await new Promise((resolve) => setTimeout(resolve, 20));
      assert.equal(app.server.roomRegistry.get('test.md'), room);
      assert.equal(room.doc.isDestroyed, false);
      assert.equal(room.destroyTimer, null);
    } finally {
      release.resolve();
      response = await changing;
    }
    assert.equal(response.status, 200);
    assert.equal((await response.json()).ok, true);
    await room.finalizePromise;
    assert.equal(await store.readEditableVaultContent('test.md'), null);
    assert.equal(await store.readCollaborationSnapshot('test.md'), null);
    if (operation === 'rename') {
      assert.equal(await store.readEditableVaultContent('moved.md'), expected);
      assert.ok(await store.readCollaborationSnapshot('moved.md'));
    }
  });
}

test('a folder named __workspace__ can be renamed and deleted without resetting the control room', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());
  const doc = new Y.Doc();
  const provider = createProvider(app, WORKSPACE_ROOM_NAME, doc);
  t.after(() => { provider.destroy(); doc.destroy(); });
  await waitForProviderSync(provider);
  const controlRoom = app.server.roomRegistry.get(WORKSPACE_ROOM_NAME);
  for (const [endpoint, method, body, status] of [
    ['/api/directory', 'POST', { path: WORKSPACE_ROOM_NAME }, 201],
    ['/api/file', 'POST', { path: `${WORKSPACE_ROOM_NAME}/note.md`, content: 'content' }, 201],
    ['/api/directory', 'PATCH', { oldPath: WORKSPACE_ROOM_NAME, newPath: 'archive' }, 200],
    ['/api/directory', 'PATCH', { oldPath: 'archive', newPath: WORKSPACE_ROOM_NAME }, 200],
    [`/api/directory?path=${WORKSPACE_ROOM_NAME}&recursive=1`, 'DELETE', undefined, 200],
  ]) {
    const response = await fetch(`${app.baseUrl}${endpoint}`, {
      method, headers: { 'Content-Type': 'application/json' }, body: body && JSON.stringify(body),
    });
    assert.equal(response.status, status);
    assert.equal((await response.json()).ok, true);
    assert.equal(app.server.roomRegistry.get(WORKSPACE_ROOM_NAME), controlRoom);
    assert.equal(controlRoom.isDeleted(), false);
    assert.equal(provider.wsconnected, true);
  }
  assert.equal(await app.server.vaultFileStore.readEditableVaultContent(`${WORKSPACE_ROOM_NAME}/note.md`), null);
  assert.equal(app.server.workspaceMutationCoordinator.workspaceState.entries.has(WORKSPACE_ROOM_NAME), false);
  await waitForCondition(() => !doc.getMap('entries').has(WORKSPACE_ROOM_NAME));
});

for (const operation of ['save', 'Git command', 'sidecar save', 'overlapping save']) {
  test(`external edits after a managed ${operation} reach live rooms and survive the next save`, async (t) => {
    const app = await startTestServer({ fileWatcherEnabled: false });
    t.after(() => app.close());
    const roomDoc = new Y.Doc();
    const provider = createProvider(app, 'test.md', roomDoc);
    t.after(() => { provider.destroy(); roomDoc.destroy(); });
    await waitForProviderSync(provider);
    const room = app.server.roomRegistry.get('test.md');
    room.doc.getText('codemirror').insert(0, 'browser ');
    if (operation === 'overlapping save') {
      const adapter = app.server.workspaceMutationCoordinator.workspaceStateAdapter;
      const originalStat = adapter.stat.bind(adapter);
      let replaced = false;
      t.mock.method(adapter, 'stat', async (path) => {
        if (path === 'test.md' && !replaced) {
          replaced = true;
          await writeFile(join(app.vaultDir, 'test.md'), 'external version\n');
        }
        return originalStat(path);
      });
    }
    await room.persist();
    if (operation === 'Git command') await app.server.workspaceMutationCoordinator.runManagedWorkspaceMutation(async () => {});
    if (operation !== 'overlapping save') await writeFile(join(app.vaultDir, 'test.md'), 'external version\n');
    if (operation === 'sidecar save') await room.persist();
    emitWatchEvents(app, 'test.md');
    await app.server.fileSystemSyncService.flushPendingChanges();
    await waitForCondition(() => roomDoc.getText('codemirror').toString() === 'external version\n');
    room.doc.getText('codemirror').insert(0, 'next ');
    await room.persist();
    assert.equal(await app.server.vaultFileStore.readEditableVaultContent('test.md'), 'next external version\n');
  });
}

test('external markdown writes are merged into active document rooms', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const roomDoc = new Y.Doc();
  const provider = createProvider(app, 'test.md', roomDoc);
  t.after(() => {
    provider.destroy();
    roomDoc.destroy();
  });

  await waitForProviderSync(provider);
  assert.match(roomDoc.getText('codemirror').toString(), /Hello from test vault/);

  await writeFile(join(app.vaultDir, 'test.md'), '# Test\n\nUpdated externally.\n', 'utf8');
  emitWatchEvents(app, 'test.md');

  await waitForCondition(() => {
    const content = roomDoc.getText('codemirror').toString();
    return content.includes('Updated externally.') ? content : null;
  });
});

test('external renames update workspace entries and preserve active rooms under the new path', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const fileDoc = new Y.Doc();
  const workspaceDoc = new Y.Doc();
  const fileProvider = createProvider(app, 'test.md', fileDoc);
  const workspaceProvider = createProvider(app, WORKSPACE_ROOM_NAME, workspaceDoc);
  t.after(() => {
    fileProvider.destroy();
    workspaceProvider.destroy();
    fileDoc.destroy();
    workspaceDoc.destroy();
  });

  await Promise.all([waitForProviderSync(fileProvider), waitForProviderSync(workspaceProvider)]);

  await mkdir(join(app.vaultDir, 'docs'), { recursive: true });
  await rename(join(app.vaultDir, 'test.md'), join(app.vaultDir, 'docs', 'renamed.md'));
  emitWatchEvents(app, 'test.md', 'docs/renamed.md');

  await waitForCondition(() => {
    const entries = workspaceDoc.getMap('entries').toJSON();
    return entries['docs/renamed.md'] && !entries['test.md'] ? true : null;
  });

  await waitForCondition(() => {
    const events = workspaceDoc.getArray('events').toArray();
    return events.some((event) => event.workspaceChange?.renamedPaths?.some?.((entry) => (
      entry.oldPath === 'test.md' && entry.newPath === 'docs/renamed.md'
    ))) ? true : null;
  });

  assert.equal(app.server.roomRegistry.get('test.md'), undefined);
  assert.notEqual(app.server.roomRegistry.get('docs/renamed.md'), undefined);
});

test('external renames avoid a full workspace rescan for small rename events', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const workspaceDoc = new Y.Doc();
  const workspaceProvider = createProvider(app, WORKSPACE_ROOM_NAME, workspaceDoc);
  t.after(() => {
    workspaceProvider.destroy();
    workspaceDoc.destroy();
  });

  await waitForProviderSync(workspaceProvider);

  let scanCalls = 0;
  const originalScanWorkspaceState = app.server.vaultFileStore.scanWorkspaceState.bind(app.server.vaultFileStore);
  app.server.vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    return originalScanWorkspaceState(...args);
  };

  await mkdir(join(app.vaultDir, 'docs'), { recursive: true });
  await rename(join(app.vaultDir, 'test.md'), join(app.vaultDir, 'docs', 'renamed.md'));
  emitWatchEvents(app, 'test.md', 'docs/renamed.md');

  await waitForCondition(() => {
    const entries = workspaceDoc.getMap('entries').toJSON();
    return entries['docs/renamed.md'] && !entries['test.md'] ? true : null;
  });

  assert.equal(scanCalls, 0);
});

test('external deletes remove active rooms and drop workspace entries', async (t) => {
  const app = await startTestServer({ fileWatcherEnabled: false });
  t.after(() => app.close());

  const fileDoc = new Y.Doc();
  const workspaceDoc = new Y.Doc();
  const fileProvider = createProvider(app, 'test.md', fileDoc);
  const workspaceProvider = createProvider(app, WORKSPACE_ROOM_NAME, workspaceDoc);
  t.after(() => {
    fileProvider.destroy();
    workspaceProvider.destroy();
    fileDoc.destroy();
    workspaceDoc.destroy();
  });

  await Promise.all([waitForProviderSync(fileProvider), waitForProviderSync(workspaceProvider)]);

  await rm(join(app.vaultDir, 'test.md'));
  emitWatchEvents(app, 'test.md');

  await waitForCondition(() => app.server.roomRegistry.get('test.md') === undefined);
  await waitForCondition(() => {
    const entries = workspaceDoc.getMap('entries').toJSON();
    return entries['test.md'] ? null : true;
  });
  await waitForCondition(() => {
    const events = workspaceDoc.getArray('events').toArray();
    return events.some((event) => event.workspaceChange?.deletedPaths?.includes?.('test.md')) ? true : null;
  });
});
