import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceSyncClient } from '../../src/client/infrastructure/workspace-sync-client.js';

function snapshotTree(tree) {
  return JSON.parse(JSON.stringify(tree));
}

test('WorkspaceSyncClient incrementally applies workspace entry add, rename, and delete changes', () => {
  const treeSnapshots = [];
  const changeMetadata = [];
  const client = new WorkspaceSyncClient({
    onTreeChange(tree, metadata = {}) {
      treeSnapshots.push(snapshotTree(tree));
      changeMetadata.push({
        changedPaths: [...(metadata.changedPaths ?? [])],
        reset: Boolean(metadata.reset),
      });
    },
  });

  client._didInitialSync = true;
  client.entries.observe(client.handleEntriesChange);

  client.ydoc.transact(() => {
    client.entries.set('docs', {
      fileKind: null,
      name: 'docs',
      nodeType: 'directory',
      parentPath: '',
      path: 'docs',
      type: 'directory',
    });
    client.entries.set('docs/guide.md', {
      fileKind: 'file',
      name: 'guide.md',
      nodeType: 'file',
      parentPath: 'docs',
      path: 'docs/guide.md',
      type: 'file',
    });
  });

  assert.deepEqual(treeSnapshots.at(-1), [{
    children: [{
      name: 'guide.md',
      path: 'docs/guide.md',
      type: 'file',
    }],
    name: 'docs',
    path: 'docs',
    type: 'directory',
  }]);
  assert.deepEqual(changeMetadata.at(-1), {
    changedPaths: ['docs', 'docs/guide.md'],
    reset: false,
  });

  client.ydoc.transact(() => {
    client.entries.delete('docs/guide.md');
    client.entries.set('docs/readme.md', {
      fileKind: 'file',
      name: 'readme.md',
      nodeType: 'file',
      parentPath: 'docs',
      path: 'docs/readme.md',
      type: 'file',
    });
  });

  assert.deepEqual(treeSnapshots.at(-1), [{
    children: [{
      name: 'readme.md',
      path: 'docs/readme.md',
      type: 'file',
    }],
    name: 'docs',
    path: 'docs',
    type: 'directory',
  }]);
  assert.deepEqual(changeMetadata.at(-1), {
    changedPaths: ['docs/guide.md', 'docs/readme.md'],
    reset: false,
  });

  client.ydoc.transact(() => {
    client.entries.delete('docs/readme.md');
    client.entries.delete('docs');
  });

  assert.deepEqual(treeSnapshots.at(-1), []);
  assert.deepEqual(changeMetadata.at(-1), {
    changedPaths: ['docs/readme.md', 'docs'],
    reset: false,
  });
  client.entries.unobserve(client.handleEntriesChange);
  client.ydoc.destroy();
});

test('WorkspaceSyncClient nests incrementally updated files by path when parentPath is stale', () => {
  const treeSnapshots = [];
  const client = new WorkspaceSyncClient({
    onTreeChange(tree) {
      treeSnapshots.push(snapshotTree(tree));
    },
  });

  client._didInitialSync = true;
  client.entries.observe(client.handleEntriesChange);

  client.ydoc.transact(() => {
    client.entries.set('assets', {
      fileKind: null,
      name: 'assets',
      nodeType: 'directory',
      parentPath: '',
      path: 'assets',
      type: 'directory',
    });
    client.entries.set('assets/image.webp', {
      fileKind: 'image',
      name: 'image.webp',
      nodeType: 'file',
      parentPath: '',
      path: 'assets/image.webp',
      type: 'image',
    });
  });

  assert.deepEqual(treeSnapshots.at(-1), [{
    children: [{
      name: 'image.webp',
      path: 'assets/image.webp',
      type: 'image',
    }],
    name: 'assets',
    path: 'assets',
    type: 'directory',
  }]);

  client.entries.unobserve(client.handleEntriesChange);
  client.ydoc.destroy();
});

test('WorkspaceSyncClient rebuilds initial tree nesting from path when parentPath is stale', () => {
  const client = new WorkspaceSyncClient();

  const tree = client.treeModel.reset({
    assets: {
      fileKind: null,
      name: 'assets',
      nodeType: 'directory',
      parentPath: '',
      path: 'assets',
      type: 'directory',
    },
    'assets/image.webp': {
      fileKind: 'image',
      name: 'image.webp',
      nodeType: 'file',
      parentPath: 'wrong-parent',
      path: 'assets/image.webp',
      type: 'image',
    },
  });

  assert.deepEqual(snapshotTree(tree), [{
    children: [{
      name: 'image.webp',
      path: 'assets/image.webp',
      type: 'image',
    }],
    name: 'assets',
    path: 'assets',
    type: 'directory',
  }]);

  client.ydoc.destroy();
});

test('WorkspaceSyncClient preserves file modification times in tree nodes', () => {
  const client = new WorkspaceSyncClient();

  const tree = client.treeModel.reset({
    'notes.md': {
      fileKind: 'file',
      mtimeMs: 42,
      name: 'notes.md',
      nodeType: 'file',
      parentPath: '',
      path: 'notes.md',
      type: 'file',
    },
  });

  assert.deepEqual(snapshotTree(tree), [{
    mtimeMs: 42,
    name: 'notes.md',
    path: 'notes.md',
    type: 'file',
  }]);

  client.treeModel.applyMapChanges(
    new Map([['notes.md', { action: 'update' }]]),
    new Map([['notes.md', {
      fileKind: 'file',
      mtimeMs: 84,
      name: 'notes.md',
      nodeType: 'file',
      parentPath: '',
      path: 'notes.md',
      type: 'file',
    }]]),
  );
  assert.equal(client.treeModel.getTree()[0].mtimeMs, 84);

  client.ydoc.destroy();
});

test('WorkspaceSyncClient disconnect is idempotent', (context) => {
  const client = new WorkspaceSyncClient();
  const consoleError = context.mock.method(console, 'error');
  client.entries.observe(client.handleEntriesChange);
  client.events.observe(client.handleEventsChange);
  client.provider = { destroy() {}, disconnect() {} };

  client.disconnect();
  client.disconnect();
  client.ydoc.destroy();

  assert.equal(consoleError.mock.callCount(), 0);
});
