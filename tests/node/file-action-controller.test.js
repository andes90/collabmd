import test from 'node:test';
import assert from 'node:assert/strict';

import { FileActionController } from '../../src/client/presentation/file-action-controller.js';
import { FileTreeState } from '../../src/client/presentation/file-tree-state.js';

function installDocumentStub(t) {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;

  globalThis.document = {
    getElementById() {
      return null;
    },
    querySelectorAll() {
      return [];
    },
  };
  globalThis.requestAnimationFrame = (callback) => {
    callback();
    return 1;
  };

  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  });
}

function installCryptoStub(t, randomUUID) {
  const originalDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'crypto');

  Object.defineProperty(globalThis, 'crypto', {
    configurable: true,
    value: { randomUUID },
  });

  t.after(() => {
    if (originalDescriptor) {
      Object.defineProperty(globalThis, 'crypto', originalDescriptor);
      return;
    }

    delete globalThis.crypto;
  });
}

function createController(t, overrides = {}) {
  installDocumentStub(t);

  const calls = [];
  const state = overrides.state ?? new FileTreeState();
  const pendingWorkspaceRequestIds = overrides.pendingWorkspaceRequestIds ?? null;
  const defaultVaultClient = {
    async createDirectory(path, options = {}) {
      if (options.requestId) {
        calls.push(['create-directory', path, options.requestId]);
        return;
      }

      calls.push(['create-directory', path]);
    },
    async deleteDirectory(path, options = {}) {
      if (options.requestId) {
        calls.push(['delete-directory', path, { recursive: options.recursive }, options.requestId]);
        return;
      }

      calls.push(['delete-directory', path, options]);
    },
    async createFile({ content, path, requestId }) {
      if (requestId) {
        calls.push(['create-file', path, content, requestId]);
        return;
      }

      calls.push(['create-file', path, content]);
    },
    async deleteFile(path, options = {}) {
      if (options.requestId) {
        calls.push(['delete-file', path, options.requestId]);
        return;
      }

      calls.push(['delete-file', path]);
    },
    async renameDirectory({ newPath, oldPath, requestId }) {
      if (requestId) {
        calls.push(['rename-directory', oldPath, newPath, requestId]);
        return;
      }

      calls.push(['rename-directory', oldPath, newPath]);
    },
    async renameFile({ newPath, oldPath, requestId }) {
      if (requestId) {
        calls.push(['rename-file', oldPath, newPath, requestId]);
        return;
      }

      calls.push(['rename-file', oldPath, newPath]);
    },
  };
  const vaultClient = typeof overrides.vaultClient === 'function'
    ? overrides.vaultClient(calls)
    : (overrides.vaultClient ?? defaultVaultClient);
  const controller = new FileActionController({
    onFileDelete: (filePath) => calls.push(['delete-callback', filePath]),
    onFileSelect: (filePath) => calls.push(['select', filePath]),
    pendingWorkspaceRequestIds,
    refresh: async () => {
      calls.push(['refresh']);
    },
    state,
    toastController: {
      show(message) {
        calls.push(['toast', message]);
      },
    },
    vaultClient,
    view: { removeContextMenu() {} },
  });

  return { calls, controller, state };
}

test('FileActionController creates files and expands parent directories', async (t) => {
  const { calls, controller, state } = createController(t);

  const created = await controller.createVaultFile('plans/q1.md', '# q1\n', { openAfterCreate: true });

  assert.equal(created, true);
  assert.deepEqual(calls, [
    ['create-file', 'plans/q1.md', '# q1\n'],
    ['refresh'],
    ['select', 'plans/q1.md'],
  ]);
  assert.deepEqual([...state.expandedDirs], ['plans']);
});

test('FileActionController renames and moves the active file and notifies selection listeners', async (t) => {
  const state = new FileTreeState();
  state.activeFilePath = 'notes/today.md';
  const pendingWorkspaceRequestIds = new Set();
  installCryptoStub(t, () => 'request-1');

  const { calls, controller } = createController(t, { pendingWorkspaceRequestIds, state });

  const renamed = await controller.renameVaultFile('notes/today.md', 'archive/tomorrow', '.md');

  assert.equal(renamed, true);
  assert.equal(state.activeFilePath, 'archive/tomorrow.md');
  assert.deepEqual([...pendingWorkspaceRequestIds], ['request-1']);
  assert.deepEqual(calls, [
    ['rename-file', 'notes/today.md', 'archive/tomorrow.md', 'request-1'],
    ['refresh'],
    ['select', 'archive/tomorrow.md'],
  ]);
});

test('FileActionController rejects extension changes during rename or move', async (t) => {
  const { calls, controller } = createController(t);

  const renamed = await controller.renameVaultFile('notes/today.md', 'archive/tomorrow.mmd', '.md');

  assert.equal(renamed, false);
  assert.deepEqual(calls, [
    ['toast', 'File type changes are not supported during rename. Keep the .md extension.'],
  ]);
});

test('FileActionController clears active state when deleting the open file', async (t) => {
  const state = new FileTreeState();
  state.activeFilePath = 'notes/today.md';
  const { calls, controller } = createController(t, { state });

  const deleted = await controller.deleteVaultFile('notes/today.md');

  assert.equal(deleted, true);
  assert.equal(state.activeFilePath, null);
  assert.deepEqual(calls, [
    ['delete-file', 'notes/today.md'],
    ['refresh'],
    ['delete-callback', 'notes/today.md'],
  ]);
});

test('FileActionController renames folders and follows active descendants', async (t) => {
  const state = new FileTreeState();
  state.activeFilePath = 'docs/guides/guide.md';
  state.expandDirectoryPath('docs/guides');

  const { calls, controller } = createController(t, { state });

  const renamed = await controller.renameDirectory('docs/guides', 'docs/reference');

  assert.equal(renamed, true);
  assert.equal(state.activeFilePath, 'docs/reference/guide.md');
  assert.deepEqual(calls, [
    ['rename-directory', 'docs/guides', 'docs/reference'],
    ['refresh'],
    ['select', 'docs/reference/guide.md'],
  ]);
  assert.equal(state.expandedDirs.has('docs/reference'), true);
});

test('FileActionController deletes folders recursively and clears active descendants', async (t) => {
  const state = new FileTreeState();
  state.activeFilePath = 'docs/guides/guide.md';
  state.expandDirectoryPath('docs/guides');

  const { calls, controller } = createController(t, { state });

  const deleted = await controller.deleteDirectory('docs/guides', { recursive: true });

  assert.equal(deleted, true);
  assert.equal(state.activeFilePath, null);
  assert.deepEqual(calls, [
    ['delete-directory', 'docs/guides', { recursive: true }],
    ['refresh'],
    ['delete-callback', 'docs/guides/guide.md'],
  ]);
  assert.equal(state.expandedDirs.has('docs/guides'), false);
});

test('FileActionController describes recursive folder delete counts in the dialog', (t) => {
  const state = new FileTreeState();
  state.setTree([{
    children: [
      {
        children: [{ name: 'guide.md', path: 'docs/guides/guide.md', type: 'file' }],
        name: 'guides',
        path: 'docs/guides',
        type: 'directory',
      },
    ],
    name: 'docs',
    path: 'docs',
    type: 'directory',
  }]);

  const { controller } = createController(t, { state });
  let dialogConfig = null;
  controller.openActionDialog = (config) => {
    dialogConfig = config;
  };

  controller.handleDeleteDirectory('docs');

  assert.equal(dialogConfig?.title, 'Delete folder and contents');
  assert.match(dialogConfig?.copy ?? '', /1 file and 1 nested folder/i);
  assert.equal(dialogConfig?.submitLabel, 'Delete folder and contents');
});

test('FileActionController removes failed mutation request ids from the pending set', async (t) => {
  const pendingWorkspaceRequestIds = new Set();
  installCryptoStub(t, () => 'request-2');

  const { calls, controller } = createController(t, {
    pendingWorkspaceRequestIds,
    vaultClient: (capturedCalls) => ({
      async createDirectory(path, options = {}) {
        capturedCalls.push(['create-directory', path, options.requestId]);
        throw new Error('boom');
      },
    }),
  });

  const created = await controller.createDirectory('notes/archive');

  assert.equal(created, false);
  assert.deepEqual([...pendingWorkspaceRequestIds], []);
  assert.deepEqual(calls, [
    ['create-directory', 'notes/archive', 'request-2'],
    ['toast', 'boom'],
  ]);
});

test('FileActionController rename dialog explains that file type stays fixed', (t) => {
  const { controller } = createController(t);
  let dialogConfig = null;
  controller.openActionDialog = (config) => {
    dialogConfig = config;
  };

  controller.handleRenameFile('notes/today.md');

  assert.equal(dialogConfig?.copy, 'Update the relative path without changing the file type.');
  assert.match(dialogConfig?.hint ?? '', /\.md is kept automatically\./);
});
