import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { loadConfig } from '../../../src/server/config/env.js';
import { createAppServer } from '../../../src/server/create-app-server.js';

async function createVault(t, files = {}) {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-app-startup-'));
  t.after(async () => {
    await rm(vaultDir, { force: true, recursive: true });
  });

  await Promise.all(
    Object.entries(files).map(async ([pathValue, content]) => {
      const absolutePath = join(vaultDir, pathValue);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
    }),
  );

  return vaultDir;
}

test('createAppServer shares one baseline across indexing, workspace init, and watching', async (t) => {
  const vaultDir = await createVault(t, {
    'docs/guide.md': '# Guide\n',
    'docs/diagram.mmd': 'graph TD;\n',
    'notes/today.md': '# Today\n',
  });
  const perfLogs = [];
  const originalConsoleInfo = console.info;
  console.info = (...args) => {
    perfLogs.push(args.join(' '));
  };
  t.after(() => {
    console.info = originalConsoleInfo;
  });

  const baseConfig = loadConfig({
    perfLoggingEnabled: true,
    vaultDir,
  });
  const server = createAppServer({
    ...baseConfig,
    host: '127.0.0.1',
    nodeEnv: 'test',
    perfLoggingEnabled: true,
    port: 0,
    wsRoomIdleGraceMs: 0,
  });
  t.after(async () => {
    await server.close();
  });

  let scanCalls = 0;
  const scannedSnapshots = [];
  const originalScanWorkspaceState = server.vaultFileStore.scanWorkspaceState.bind(server.vaultFileStore);
  server.vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    const snapshot = await originalScanWorkspaceState(...args);
    scannedSnapshots.push(snapshot);
    return snapshot;
  };

  const backlinkSnapshots = [];
  const originalBuild = server.backlinkIndex.build.bind(server.backlinkIndex);
  server.backlinkIndex.build = async ({ workspaceState = null } = {}) => {
    backlinkSnapshots.push(workspaceState);
    return originalBuild({ workspaceState });
  };

  let initializedSnapshot = null;
  const originalInitialize = server.workspaceMutationCoordinator.initialize.bind(server.workspaceMutationCoordinator);
  server.workspaceMutationCoordinator.initialize = async ({ snapshot = null } = {}) => {
    initializedSnapshot = snapshot;
    return originalInitialize({ snapshot });
  };

  let watcherSnapshot = null;
  const startWatcher = server.fileSystemSyncService.start.bind(server.fileSystemSyncService);
  server.fileSystemSyncService.start = async ({ snapshot = null } = {}) => {
    watcherSnapshot = snapshot;
    await startWatcher({ snapshot });
  };

  const listenInfo = await server.listen();

  assert.equal(scanCalls, 1);
  assert.equal(backlinkSnapshots.length, 1);
  assert.equal(backlinkSnapshots[0], scannedSnapshots[0]);
  assert.equal(initializedSnapshot, scannedSnapshots[0]);
  assert.equal(watcherSnapshot, scannedSnapshots[0]);
  assert.equal(server.vaultFileCount, scannedSnapshots[0].vaultFileCount);
  assert.deepEqual(scannedSnapshots[0].markdownPaths, ['docs/guide.md', 'notes/today.md']);
  assert.equal(typeof listenInfo.port, 'number');
  assert.match(listenInfo.wsPath, /\/ws\/:file$/);
  assert.ok(perfLogs.some((line) => line.includes('[perf][startup]') && line.includes('phase=workspace-scan')));
  assert.ok(perfLogs.some((line) => line.includes('[perf][startup-total]')));
});

test('createAppServer excludes CollabMD metadata from git on startup', async (t) => {
  const vaultDir = await createVault(t, { 'README.md': '# Test\n' });
  await mkdir(join(vaultDir, '.git/info'), { recursive: true });
  await writeFile(join(vaultDir, '.git/info/exclude'), '# local excludes\n', 'utf8');

  const server = createAppServer({
    ...loadConfig({ vaultDir }),
    fileWatcherEnabled: false,
    host: '127.0.0.1',
    nodeEnv: 'test',
    port: 0,
    wsRoomIdleGraceMs: 0,
  });
  t.after(async () => {
    await server.close();
  });

  await server.listen();
  assert.equal(
    await readFile(join(vaultDir, '.git/info/exclude'), 'utf8'),
    '# local excludes\n.collabmd/\n',
  );
});

test('createAppServer reconciles watcher events received during its initial scan', async (t) => {
  const vaultDir = await createVault(t, {
    'docs/guide.md': '# Guide\n',
  });
  const baseConfig = loadConfig({
    perfLoggingEnabled: true,
    vaultDir,
  });
  const server = createAppServer({
    ...baseConfig,
    host: '127.0.0.1',
    nodeEnv: 'test',
    perfLoggingEnabled: true,
    port: 0,
    wsRoomIdleGraceMs: 0,
  });
  t.after(async () => {
    await server.close();
  });

  let scanCalls = 0;
  const originalScanWorkspaceState = server.vaultFileStore.scanWorkspaceState.bind(server.vaultFileStore);
  server.vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    const snapshot = await originalScanWorkspaceState(...args);
    if (scanCalls === 1) {
      await writeFile(join(vaultDir, 'docs', 'new-note.md'), '# New note\n', 'utf8');
      server.fileSystemSyncService.handleWatchEvent('rename', 'docs/new-note.md');
    }
    return snapshot;
  };

  const backlinkSnapshots = [];
  const originalBuild = server.backlinkIndex.build.bind(server.backlinkIndex);
  server.backlinkIndex.build = async ({ workspaceState = null } = {}) => {
    backlinkSnapshots.push(workspaceState);
    return originalBuild({ workspaceState });
  };

  await server.listen();

  assert.equal(scanCalls, 1);
  assert.equal(backlinkSnapshots.length, 1);
  assert.deepEqual(backlinkSnapshots[0].markdownPaths, ['docs/guide.md']);
  assert.deepEqual(server.workspaceMutationCoordinator.workspaceState.markdownPaths, ['docs/guide.md', 'docs/new-note.md']);
  assert.equal(server.vaultFileCount, 2);
});
