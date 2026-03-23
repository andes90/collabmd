import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWorkspaceChange } from '../../src/domain/workspace-change.js';
import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';
import { WorkspaceMutationCoordinator } from '../../src/server/infrastructure/workspace/workspace-mutation-coordinator.js';

function createState(paths = []) {
  return {
    entries: new Map(paths.map((pathValue) => [pathValue, { path: pathValue, type: 'file' }])),
    metadata: new Map(),
    scannedAt: Date.now(),
  };
}

async function createCoordinatorWithVault(t, initialFiles = {}) {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-workspace-mutation-'));
  t.after(async () => {
    await rm(vaultDir, { force: true, recursive: true });
  });

  await Promise.all(
    Object.entries(initialFiles).map(async ([pathValue, content]) => {
      const absolutePath = join(vaultDir, pathValue);
      await mkdir(dirname(absolutePath), { recursive: true });
      await writeFile(absolutePath, content, 'utf8');
    }),
  );

  const vaultFileStore = new VaultFileStore({ vaultDir });
  const coordinator = new WorkspaceMutationCoordinator({
    backlinkIndex: null,
    roomRegistry: null,
    vaultFileStore,
  });
  coordinator.workspaceState = await vaultFileStore.scanWorkspaceState();

  let scanCalls = 0;
  const originalScanWorkspaceState = vaultFileStore.scanWorkspaceState.bind(vaultFileStore);
  vaultFileStore.scanWorkspaceState = async (...args) => {
    scanCalls += 1;
    return originalScanWorkspaceState(...args);
  };

  return {
    coordinator,
    get scanCalls() {
      return scanCalls;
    },
    vaultDir,
    vaultFileStore,
  };
}

test('WorkspaceMutationCoordinator applies small backlink renames incrementally', async () => {
  const calls = [];
  const coordinator = new WorkspaceMutationCoordinator({
    backlinkIndex: {
      build() {
        calls.push(['build']);
      },
      onFileDeleted(pathValue) {
        calls.push(['delete', pathValue]);
      },
      onFileRenamed(oldPath, newPath) {
        calls.push(['rename', oldPath, newPath]);
      },
      updateFile(pathValue) {
        calls.push(['update', pathValue]);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = createState(['a.md', 'b.md']);
  await coordinator.reconcileBacklinks({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'a.md', newPath: 'c.md' }],
  }, createState(['b.md', 'c.md']));

  assert.deepEqual(calls, [['rename', 'a.md', 'c.md']]);
});

test('WorkspaceMutationCoordinator schedules large backlink rebuilds without awaiting a full build', async () => {
  const calls = [];
  const coordinator = new WorkspaceMutationCoordinator({
    backlinkIndex: {
      scheduleBuild() {
        calls.push(['schedule-build']);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = createState(['note-1.md']);
  await coordinator.reconcileBacklinks({
    changedPaths: Array.from({ length: 26 }, (_, index) => `note-${index}.md`),
    deletedPaths: [],
    renamedPaths: [],
  }, createState(['note-1.md']));

  assert.deepEqual(calls, [['schedule-build']]);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API file writes', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  await writeFile(join(harness.vaultDir, 'docs', 'test.md'), '# After\n', 'utf8');
  await harness.coordinator.apply({
    action: 'write-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['docs/test.md'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs'), true);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API file creation with nested directories', async (t) => {
  const harness = await createCoordinatorWithVault(t, {});

  await harness.vaultFileStore.createFile('guides/start/here.md', '# Hello\n');
  await harness.coordinator.apply({
    action: 'create-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['guides/start/here.md'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides/start'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides/start/here.md'), true);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API file deletion', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  await harness.vaultFileStore.deleteFile('docs/test.md');
  await harness.coordinator.apply({
    action: 'delete-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      deletedPaths: ['docs/test.md'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs'), true);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API file renames', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  await harness.vaultFileStore.renameFile('docs/test.md', 'archive/renamed.md');
  await harness.coordinator.apply({
    action: 'rename-file',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      renamedPaths: [{ oldPath: 'docs/test.md', newPath: 'archive/renamed.md' }],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('archive'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('archive/renamed.md'), true);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API directory creation', async (t) => {
  const harness = await createCoordinatorWithVault(t, {});

  await harness.vaultFileStore.createDirectory('guides/start');
  await harness.coordinator.apply({
    action: 'create-directory',
    origin: 'api',
    publishEvent: false,
    workspaceChange: createWorkspaceChange({
      changedPaths: ['guides/start'],
    }),
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('guides/start'), true);
});

test('WorkspaceMutationCoordinator derives descendant rename entries for directory renames', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
    'docs/guides/setup.md': '# Setup\n',
  });

  const workspaceChange = await harness.coordinator.createDirectoryRenameWorkspaceChange('docs/guides', 'docs/reference');

  assert.deepEqual(workspaceChange.renamedPaths, [
    { oldPath: 'docs/guides', newPath: 'docs/reference' },
    { oldPath: 'docs/guides/intro.md', newPath: 'docs/reference/intro.md' },
    { oldPath: 'docs/guides/setup.md', newPath: 'docs/reference/setup.md' },
  ]);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API directory renames', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
  });

  const workspaceChange = await harness.coordinator.createDirectoryRenameWorkspaceChange('docs/guides', 'docs/reference');
  await harness.vaultFileStore.renameDirectory('docs/guides', 'docs/reference');
  await harness.coordinator.apply({
    action: 'rename-directory',
    origin: 'api',
    publishEvent: false,
    workspaceChange,
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference/intro.md'), true);
});

test('WorkspaceMutationCoordinator avoids a full rescan for API directory deletion', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
  });

  const workspaceChange = await harness.coordinator.createDirectoryDeleteWorkspaceChange('docs/guides');
  await harness.vaultFileStore.deleteDirectory('docs/guides', { recursive: true });
  await harness.coordinator.apply({
    action: 'delete-directory',
    origin: 'api',
    publishEvent: false,
    workspaceChange,
  });

  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides/intro.md'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs'), true);
});
