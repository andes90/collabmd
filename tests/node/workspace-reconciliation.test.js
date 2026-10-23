import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';

import { createWorkspaceChange } from '../../src/domain/workspace-change.js';
import { WorkspaceReconciliation } from '../../src/server/application/workspace-reconciliation.js';
import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';
import { createWorkspaceStateFileSystemAdapter } from '../../src/server/infrastructure/workspace/workspace-state-file-system-adapter.js';
import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';
import { RoomRegistry } from '../../src/server/domain/collaboration/room-registry.js';
import { WORKSPACE_ROOM_NAME } from '../../src/domain/workspace-room.js';

function createWorkspaceReconciliation(options) {
  return new WorkspaceReconciliation({
    ...options,
    workspaceStateAdapter: options.workspaceStateAdapter ?? createWorkspaceStateFileSystemAdapter({
      vaultDir: options.vaultFileStore?.vaultDir,
    }),
  });
}

function createState(paths = []) {
  return {
    entries: new Map(paths.map((pathValue) => [pathValue, { path: pathValue, type: 'file' }])),
    filePaths: [...paths],
    markdownPaths: paths.filter((pathValue) => pathValue.endsWith('.md')),
    metadata: new Map(),
    scannedAt: Date.now(),
    vaultFileCount: paths.length,
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
  const coordinator = createWorkspaceReconciliation({
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

for (const mutation of ['delete-file', 'delete-directory', 'rename-file', 'rename-directory']) {
  test(`${mutation} drains an active save before moving content and sidecars`, async (t) => {
    const { coordinator, vaultDir, vaultFileStore } = await createCoordinatorWithVault(t, { 'docs/note.md': 'original' });
    const registry = new RoomRegistry({
      createRoom: ({ name, onEmpty }) => new CollaborationRoom({
        name, onEmpty, idleGraceMs: 0,
        vaultFileStore: name === WORKSPACE_ROOM_NAME ? null : vaultFileStore,
      }),
    });
    coordinator.roomRegistry = registry;
    t.after(() => registry.reset());
    const room = registry.getOrCreate('docs/note.md');
    await room.hydrate();
    room.doc.getText('codemirror').insert(0, 'edited ');
    const entered = Promise.withResolvers();
    const release = Promise.withResolvers();
    const persistState = room.documentStore.persistState.bind(room.documentStore);
    room.documentStore.persistState = async (state) => {
      entered.resolve();
      await release.promise;
      return persistState(state);
    };
    const saving = room.persist();
    await entered.promise;
    const operations = {
      'delete-file': () => coordinator.deleteFile({ path: ' docs//note.md ' }),
      'delete-directory': () => coordinator.deleteDirectory({ path: ' docs/ ', recursive: true }),
      'rename-file': () => coordinator.renameFile({ oldPath: 'docs\\note.md', newPath: 'moved.md' }),
      'rename-directory': () => coordinator.renameDirectory({ oldPath: 'docs/', newPath: ' moved/ ' }),
    };
    const changing = operations[mutation]();
    try {
      assert.equal(room.persistencePauseCount, 1);
      assert.equal(await readFile(join(vaultDir, 'docs/note.md'), 'utf8'), 'original');
      assert.throws(() => registry.getOrCreate('docs/note.md'), /being renamed or deleted/u);
    } finally {
      release.resolve();
    }
    assert.equal((await changing).ok, true);
    await saving;
    await assert.rejects(readFile(join(vaultDir, 'docs/note.md')), { code: 'ENOENT' });
    assert.equal(await vaultFileStore.readCollaborationSnapshot('docs/note.md'), null);
    if (mutation.startsWith('rename')) {
      const destination = mutation === 'rename-file' ? 'moved.md' : 'moved/note.md';
      assert.equal(await vaultFileStore.readEditableVaultContent(destination), 'edited original');
      assert.ok(await vaultFileStore.readCollaborationSnapshot(destination));
    }
    assert.equal(room.persistencePauseCount, 0);
  });
}

test('failed deletion resumes live room saves', async (t) => {
  const { coordinator, vaultFileStore } = await createCoordinatorWithVault(t, { 'docs/note.md': 'original' });
  const registry = new RoomRegistry({ createRoom: ({ name, onEmpty }) => new CollaborationRoom({ name, onEmpty, vaultFileStore }) });
  coordinator.roomRegistry = registry;
  t.after(() => registry.reset());
  const room = registry.getOrCreate('docs/note.md');
  await room.hydrate();
  assert.equal((await coordinator.deleteDirectory({ path: 'docs' })).ok, false);
  assert.equal(room.persistencePauseCount, 0);
  assert.equal(room.isDeleted(), false);
  room.doc.getText('codemirror').insert(0, 'after failure ');
  await room.persist();
  assert.equal(await vaultFileStore.readEditableVaultContent('docs/note.md'), 'after failure original');
});

test('WorkspaceReconciliation applies small backlink renames incrementally', async () => {
  const calls = [];
  const previousState = createState(['a.md', 'b.md']);
  const nextState = createState(['b.md', 'c.md']);
  const coordinator = createWorkspaceReconciliation({
    backlinkIndex: {
      async applyWorkspaceChange(workspaceChange, { nextState, previousState }) {
        calls.push(['apply', workspaceChange, previousState, nextState]);
      },
    },
    roomRegistry: null,
    vaultFileStore: {
      readMarkdownFile: async () => null,
    },
  });

  coordinator.workspaceState = previousState;
  await coordinator.reconcileBacklinks({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'a.md', newPath: 'c.md' }],
  }, nextState);

  assert.deepEqual(calls, [[
    'apply',
    {
      changedPaths: [],
      deletedPaths: [],
      renamedPaths: [{ oldPath: 'a.md', newPath: 'c.md' }],
    },
    previousState,
    nextState,
  ]]);
});

test('WorkspaceReconciliation schedules large backlink rebuilds without awaiting a full build', async () => {
  const calls = [];
  const nextState = createState(['note-1.md']);
  const coordinator = createWorkspaceReconciliation({
    backlinkIndex: {
      scheduleBuild(options) {
        calls.push(['schedule-build', options]);
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
  }, nextState);

  assert.deepEqual(calls, [[
    'schedule-build',
    { workspaceState: nextState },
  ]]);
});

test('WorkspaceReconciliation avoids a full rescan for API file writes', async (t) => {
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
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, ['docs/test.md']);
  assert.equal(harness.coordinator.workspaceState.vaultFileCount, 1);
});

test('WorkspaceReconciliation writeEditableContent owns the file write and reconciliation', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/test.md': '# Before\n',
  });

  const result = await harness.coordinator.writeEditableContent({
    content: '# After\n',
    path: 'docs/test.md',
  });

  assert.equal(result.ok, true);
  assert.equal(await readFile(join(harness.vaultDir, 'docs', 'test.md'), 'utf8'), '# After\n');
  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/test.md'), true);
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, ['docs/test.md']);
});

test('WorkspaceReconciliation avoids a full rescan for API file creation with nested directories', async (t) => {
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
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, ['guides/start/here.md']);
  assert.equal(harness.coordinator.workspaceState.vaultFileCount, 1);
});

test('WorkspaceReconciliation avoids a full rescan for API file deletion', async (t) => {
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
  assert.deepEqual(harness.coordinator.workspaceState.markdownPaths, []);
  assert.equal(harness.coordinator.workspaceState.vaultFileCount, 0);
});

test('WorkspaceReconciliation avoids a full rescan for API file renames', async (t) => {
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

test('WorkspaceReconciliation avoids a full rescan for API directory creation', async (t) => {
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

test('WorkspaceReconciliation derives descendant rename entries for directory renames', async (t) => {
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

test('WorkspaceReconciliation avoids a full rescan for API directory renames', async (t) => {
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

test('WorkspaceReconciliation renameDirectory owns descendant change derivation and reconciliation', async (t) => {
  const harness = await createCoordinatorWithVault(t, {
    'docs/guides/intro.md': '# Intro\n',
  });

  const result = await harness.coordinator.renameDirectory({
    newPath: 'docs/reference',
    oldPath: 'docs/guides',
  });

  assert.equal(result.ok, true);
  assert.equal(harness.scanCalls, 0);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/guides'), false);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference'), true);
  assert.equal(harness.coordinator.workspaceState.entries.has('docs/reference/intro.md'), true);
});

test('WorkspaceReconciliation avoids a full rescan for API directory deletion', async (t) => {
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
