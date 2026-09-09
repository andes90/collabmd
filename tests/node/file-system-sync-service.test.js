import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rename, rm, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';
import { FileSystemSyncService } from '../../src/server/infrastructure/workspace/file-system-sync-service.js';

function createWorkspaceState(entries = []) {
  const normalizedEntries = entries.map(([pathValue, type = 'file']) => ({
    path: pathValue,
    type,
  }));

  return {
    entries: new Map(normalizedEntries.map(({ path, type }) => [path, {
      fileKind: type === 'directory' ? null : 'file',
      name: path.split('/').pop(),
      nodeType: type,
      parentPath: path.includes('/') ? path.slice(0, path.lastIndexOf('/')) : '',
      path,
      type,
    }])),
    markdownPaths: normalizedEntries
      .filter(({ path, type }) => type === 'file' && path.endsWith('.md'))
      .map(({ path }) => path)
      .sort((left, right) => left.localeCompare(right, undefined, { sensitivity: 'base' })),
    metadata: new Map(normalizedEntries.map(({ path, type }) => [path, {
      inode: 1,
      mtimeMs: 1,
      path,
      size: type === 'directory' ? 0 : 1,
      type,
    }])),
    scannedAt: Date.now(),
    vaultFileCount: normalizedEntries.filter(({ type }) => type === 'file').length,
  };
}

async function createVault() {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-fs-sync-'));
  await mkdir(join(vaultDir, 'docs'), { recursive: true });
  await writeFile(join(vaultDir, 'README.md'), '# Readme\n', 'utf8');
  await writeFile(join(vaultDir, 'docs', 'guide.md'), '# Guide\n', 'utf8');

  return {
    cleanup: () => rm(vaultDir, { force: true, recursive: true }),
    store: new VaultFileStore({ vaultDir }),
    vaultDir,
  };
}

test('FileSystemSyncService applies single-file content changes without a full workspace rescan', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const baselineState = await store.scanWorkspaceState();
  let scanCount = 0;
  const originalScanWorkspaceState = store.scanWorkspaceState.bind(store);
  store.scanWorkspaceState = async (...args) => {
    scanCount += 1;
    return originalScanWorkspaceState(...args);
  };

  let applied = null;
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      applied = payload;
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('README.md', new Set(['change']));

  await writeFile(join(vaultDir, 'README.md'), '# Readme\n\nUpdated\n', 'utf8');
  await service.flush();

  assert.equal(scanCount, 0);
  assert.deepEqual(applied?.workspaceChange?.changedPaths, ['README.md']);
  assert.equal(applied?.nextState?.entries?.has('README.md'), true);
  assert.deepEqual(applied?.nextState?.markdownPaths, ['docs/guide.md', 'README.md']);
  assert.equal(applied?.nextState?.vaultFileCount, 2);
});

test('FileSystemSyncService falls back to a full workspace rescan for rename events', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const baselineState = await store.scanWorkspaceState();
  let scanCount = 0;
  const originalScanWorkspaceState = store.scanWorkspaceState.bind(store);
  store.scanWorkspaceState = async (...args) => {
    scanCount += 1;
    return originalScanWorkspaceState(...args);
  };

  let applied = null;
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      applied = payload;
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('README.md', new Set(['rename']));
  service.forceFullScan = true;

  await rename(join(vaultDir, 'README.md'), join(vaultDir, 'docs', 'README.md'));
  await service.flush();

  assert.equal(scanCount, 1);
  assert.deepEqual(applied?.workspaceChange?.renamedPaths, [{
    oldPath: 'README.md',
    newPath: 'docs/README.md',
  }]);
});

test('FileSystemSyncService emits gated perf logs for full-scan fallback reasons', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const perfLogs = [];
  const originalConsoleInfo = console.info;
  console.info = (...args) => {
    perfLogs.push(args.join(' '));
  };
  t.after(() => {
    console.info = originalConsoleInfo;
  });

  const baselineState = await store.scanWorkspaceState();
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    perfLoggingEnabled: true,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('README.md', new Set(['rename']));
  service.forceFullScan = true;

  await rename(join(vaultDir, 'README.md'), join(vaultDir, 'docs', 'README.md'));
  await service.flush();

  assert.ok(perfLogs.some((line) => (
    line.includes('[perf][filesystem-sync]')
    && line.includes('mode=full-scan')
    && line.includes('fallbackReason=forced-full-scan')
  )));
});

test('FileSystemSyncService collapses overlapping pending paths during incremental diffing', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  const baselineState = await store.scanWorkspaceState();
  let scanCount = 0;
  const originalScanWorkspaceState = store.scanWorkspaceState.bind(store);
  store.scanWorkspaceState = async (...args) => {
    scanCount += 1;
    return originalScanWorkspaceState(...args);
  };

  let applied = null;
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      applied = payload;
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('docs', new Set(['change']));
  service.pendingEventTypesByPath.set('docs/guide.md', new Set(['change']));

  await writeFile(join(vaultDir, 'docs', 'guide.md'), '# Guide\n\nUpdated\n', 'utf8');
  await service.flush();

  assert.equal(scanCount, 0);
  assert.deepEqual(applied?.workspaceChange?.changedPaths, ['docs/guide.md']);
});

test('FileSystemSyncService preserves asset directory entries when deleting one image incrementally', async (t) => {
  const { cleanup, store, vaultDir } = await createVault();
  t.after(cleanup);

  await mkdir(join(vaultDir, 'assets'), { recursive: true });
  await writeFile(join(vaultDir, 'assets', 'keep.webp'), 'keep-image');
  await writeFile(join(vaultDir, 'assets', 'delete.webp'), 'delete-image');

  const baselineState = await store.scanWorkspaceState();
  let scanCount = 0;
  const originalScanWorkspaceState = store.scanWorkspaceState.bind(store);
  store.scanWorkspaceState = async (...args) => {
    scanCount += 1;
    return originalScanWorkspaceState(...args);
  };

  let applied = null;
  const mutationCoordinator = {
    filterManagedWorkspaceChange(workspaceChange) {
      return workspaceChange;
    },
    async apply(payload) {
      applied = payload;
      return payload;
    },
    getWorkspaceRoom() {
      return null;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: store,
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('assets/delete.webp', new Set(['rename']));

  await rm(join(vaultDir, 'assets', 'delete.webp'));
  await service.flush();

  assert.equal(scanCount, 0);
  assert.deepEqual(applied?.workspaceChange?.deletedPaths, ['assets/delete.webp']);
  assert.equal(applied?.nextState?.entries?.has('assets'), true);
  assert.equal(applied?.nextState?.entries?.has('assets/keep.webp'), true);
  assert.equal(applied?.nextState?.entries?.has('assets/delete.webp'), false);
});

test('FileSystemSyncService does not reintroduce a deleted file from a stale parent snapshot', async () => {
  const staleState = createWorkspaceState([
    ['docs', 'directory'],
    ['docs/file.md', 'file'],
  ]);
  const authoritativeState = createWorkspaceState([
    ['docs', 'directory'],
  ]);
  let scanCount = 0;
  let applyCount = 0;
  let syncCount = 0;
  let replaceCount = 0;

  const mutationCoordinator = {
    filterManagedWorkspaceChange() {
      return null;
    },
    async apply() {
      applyCount += 1;
    },
    replaceWorkspaceState(nextState) {
      replaceCount += 1;
      this.workspaceState = nextState;
    },
    syncWorkspaceEntries() {
      syncCount += 1;
    },
    workspaceState: authoritativeState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: {
      async scanWorkspaceState() {
        scanCount += 1;
        return authoritativeState;
      },
      vaultDir: process.cwd(),
    },
  });
  service.lastState = staleState;
  service.pendingEventTypesByPath.set('docs', new Set(['change']));
  service.readWorkspacePathSnapshot = async () => staleState;

  await service.flush();

  assert.equal(scanCount, 1);
  assert.equal(applyCount, 0);
  assert.equal(syncCount, 0);
  assert.equal(replaceCount, 0);
  assert.equal(mutationCoordinator.workspaceState.entries.has('docs/file.md'), false);
  assert.equal(service.lastState.entries.has('docs/file.md'), false);
});

test('FileSystemSyncService does not reintroduce a deleted directory tree from a stale ancestor snapshot', async () => {
  const staleState = createWorkspaceState([
    ['docs', 'directory'],
    ['docs/guides', 'directory'],
    ['docs/guides/guide.md', 'file'],
  ]);
  const authoritativeState = createWorkspaceState([
    ['docs', 'directory'],
  ]);
  let scanCount = 0;
  let applyCount = 0;
  let syncCount = 0;
  let replaceCount = 0;

  const mutationCoordinator = {
    filterManagedWorkspaceChange() {
      return null;
    },
    async apply() {
      applyCount += 1;
    },
    replaceWorkspaceState(nextState) {
      replaceCount += 1;
      this.workspaceState = nextState;
    },
    syncWorkspaceEntries() {
      syncCount += 1;
    },
    workspaceState: authoritativeState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: {
      async scanWorkspaceState() {
        scanCount += 1;
        return authoritativeState;
      },
      vaultDir: process.cwd(),
    },
  });
  service.lastState = staleState;
  service.pendingEventTypesByPath.set('docs', new Set(['rename']));
  service.readWorkspacePathSnapshot = async () => staleState;

  await service.flush();

  assert.equal(scanCount, 1);
  assert.equal(applyCount, 0);
  assert.equal(syncCount, 0);
  assert.equal(replaceCount, 0);
  assert.equal(mutationCoordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(mutationCoordinator.workspaceState.entries.has('docs/guides/guide.md'), false);
  assert.equal(service.lastState.entries.has('docs/guides'), false);
  assert.equal(service.lastState.entries.has('docs/guides/guide.md'), false);
});

test('FileSystemSyncService silently rebases workspace state during global suppression', async () => {
  const baselineState = createWorkspaceState([
    ['docs', 'directory'],
  ]);
  const externalChangeState = createWorkspaceState([
    ['docs', 'directory'],
    ['docs/external.md', 'file'],
  ]);
  let scanCount = 0;
  let applyCount = 0;
  let syncCount = 0;
  let replaceCount = 0;

  const mutationCoordinator = {
    filterManagedWorkspaceChange() {
      return null;
    },
    isGloballySuppressed() {
      return true;
    },
    async apply() {
      applyCount += 1;
    },
    replaceWorkspaceState(nextState) {
      replaceCount += 1;
      this.workspaceState = nextState;
    },
    syncWorkspaceEntries() {
      syncCount += 1;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: {
      async scanWorkspaceState() {
        scanCount += 1;
        return externalChangeState;
      },
      vaultDir: process.cwd(),
    },
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('docs', new Set(['change']));
  service.readWorkspacePathSnapshot = async () => externalChangeState;

  await service.flush();

  assert.equal(scanCount, 1);
  assert.equal(applyCount, 0);
  assert.equal(syncCount, 1);
  assert.equal(replaceCount, 1);
  assert.equal(mutationCoordinator.workspaceState.entries.has('docs/external.md'), true);
  assert.equal(service.lastState.entries.has('docs/external.md'), true);
});

test('FileSystemSyncService silently rebases workspace state for managed writes', async () => {
  const baselineState = createWorkspaceState([
    ['diagram.excalidraw', 'file'],
  ]);
  const managedWriteState = createWorkspaceState([
    ['diagram.excalidraw', 'file'],
  ]);
  managedWriteState.metadata.set('diagram.excalidraw', {
    ...managedWriteState.metadata.get('diagram.excalidraw'),
    mtimeMs: 2,
    size: 2,
  });
  let scanCount = 0;
  let applyCount = 0;
  let syncCount = 0;
  let replaceCount = 0;

  const mutationCoordinator = {
    filterManagedWorkspaceChange() {
      return null;
    },
    isGloballySuppressed() {
      return false;
    },
    async apply() {
      applyCount += 1;
    },
    replaceWorkspaceState(nextState) {
      replaceCount += 1;
      this.workspaceState = nextState;
    },
    syncWorkspaceEntries() {
      syncCount += 1;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: {
      async scanWorkspaceState() {
        scanCount += 1;
        return managedWriteState;
      },
      vaultDir: process.cwd(),
    },
  });
  service.lastState = baselineState;
  service.pendingEventTypesByPath.set('diagram.excalidraw', new Set(['change']));
  service.readWorkspacePathSnapshot = async () => managedWriteState;

  await service.flush();

  assert.equal(scanCount, 1);
  assert.equal(applyCount, 0);
  assert.equal(syncCount, 1);
  assert.equal(replaceCount, 1);
  assert.equal(mutationCoordinator.workspaceState.metadata.get('diagram.excalidraw').mtimeMs, 2);
  assert.equal(service.lastState.metadata.get('diagram.excalidraw').mtimeMs, 2);
});

test('FileSystemSyncService skips the rebase rescan when the first pass already full-scanned', async () => {
  const baselineState = createWorkspaceState([
    ['docs', 'directory'],
  ]);
  const diskState = createWorkspaceState([
    ['docs', 'directory'],
    ['docs/new.md', 'file'],
  ]);
  let scanCount = 0;
  let syncCount = 0;
  let replaceCount = 0;

  const mutationCoordinator = {
    filterManagedWorkspaceChange() {
      return null;
    },
    isGloballySuppressed() {
      return false;
    },
    async apply() {
      assert.fail('managed-only flush must not apply');
    },
    replaceWorkspaceState(nextState) {
      replaceCount += 1;
      this.workspaceState = nextState;
    },
    syncWorkspaceEntries() {
      syncCount += 1;
    },
    workspaceState: baselineState,
  };

  const service = new FileSystemSyncService({
    mutationCoordinator,
    vaultFileStore: {
      async scanWorkspaceState() {
        scanCount += 1;
        return diskState;
      },
      vaultDir: process.cwd(),
    },
  });
  service.lastState = baselineState;
  service.forceFullScan = true;

  await service.flush();

  assert.equal(scanCount, 1);
  assert.equal(syncCount, 1);
  assert.equal(replaceCount, 1);
  assert.equal(mutationCoordinator.workspaceState.entries.has('docs/new.md'), true);
  assert.equal(service.lastState.entries.has('docs/new.md'), true);
});
