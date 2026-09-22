import test from 'node:test';
import assert from 'node:assert/strict';

import { BacklinkIndex } from '../../src/server/domain/backlink-index.js';

class StubVaultStore {
  constructor(files) {
    this.files = new Map(files);
    this.readCount = 0;
    this.scanCount = 0;
  }

  async scanWorkspaceState() {
    this.scanCount += 1;
    const filePaths = [...this.files.keys()]
      .sort((left, right) => left.localeCompare(right));
    return {
      filePaths,
      markdownPaths: filePaths.filter((pathValue) => pathValue.endsWith('.md')),
    };
  }

  async readMarkdownFile(path) {
    this.readCount += 1;
    return this.files.get(path) ?? null;
  }
}

test('BacklinkIndex serves cached contexts without additional file reads', async () => {
  const vaultFileStore = new StubVaultStore([
    ['source.md', '# Source\n\nSee [[target]].'],
    ['target.md', '# Target'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  const readsAfterBuild = vaultFileStore.readCount;

  const backlinks = await index.getBacklinks('target.md');
  assert.deepEqual(backlinks, [
    {
      contexts: ['See [[target]].'],
      file: 'source.md',
    },
  ]);
  assert.equal(vaultFileStore.readCount, readsAfterBuild);
});

test('BacklinkIndex remaps backlink contexts when target file is renamed', async () => {
  const vaultFileStore = new StubVaultStore([
    ['a.md', 'Line one [[b]].\nLine two [[b]].'],
    ['b.md', '# b'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  index.onFileRenamed('b.md', 'c.md');

  const oldTargetBacklinks = await index.getBacklinks('b.md');
  assert.deepEqual(oldTargetBacklinks, []);

  const newTargetBacklinks = await index.getBacklinks('c.md');
  assert.deepEqual(newTargetBacklinks, [
    {
      contexts: ['Line one [[b]].', 'Line two [[b]].'],
      file: 'a.md',
    },
  ]);
});

test('BacklinkIndex flushes scheduled rebuilds when backlinks are queried', async () => {
  const timers = [];
  const vaultFileStore = new StubVaultStore([
    ['source.md', '# Source\n\nSee [[target]].'],
    ['target.md', '# Target'],
  ]);
  const index = new BacklinkIndex({
    clearTimeoutFn(timer) {
      timer.cleared = true;
    },
    setTimeoutFn(callback) {
      const timer = {
        callback,
        cleared: false,
        unref() {},
      };
      timers.push(timer);
      return timer;
    },
    vaultFileStore,
  });

  await index.build();
  vaultFileStore.files.set('source.md', '# Source\n\nNo links now.');

  index.scheduleBuild();
  const backlinks = await index.getBacklinks('target.md');

  assert.equal(timers.length, 1);
  assert.equal(timers[0].cleared, true);
  assert.deepEqual(backlinks, []);
});

test('BacklinkIndex builds source file lists from a workspace scan', async () => {
  const vaultFileStore = new StubVaultStore([
    ['source.md', '# Source\n\nSee [[target]].'],
    ['target.md', '# Target'],
    ['diagram.mmd', 'graph TD;'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();

  assert.equal(vaultFileStore.scanCount, 1);
  assert.equal(vaultFileStore.readCount, 2);
  assert.deepEqual(await index.getBacklinks('target.md'), [
    {
      contexts: ['See [[target]].'],
      file: 'source.md',
    },
  ]);
});

test('BacklinkIndex honors provided markdownPaths without reading non-markdown targets', async () => {
  const vaultFileStore = new StubVaultStore([
    ['source.md', '# Source\n\nSee [[target]].'],
    ['target.md', '# Target'],
    ['diagram.mmd', 'graph TD;'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build({
    workspaceState: {
      filePaths: ['diagram.mmd', 'source.md', 'target.md'],
      markdownPaths: ['source.md', 'target.md'],
    },
  });

  assert.equal(vaultFileStore.scanCount, 0);
  assert.equal(vaultFileStore.readCount, 2);
  assert.deepEqual(index._sourceFileList, ['source.md', 'target.md']);
});

test('BacklinkIndex resolves markdown embeds that target non-markdown vault files', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '# Source\n\n![[diagrams/flow.mmd]]'],
    ['diagrams/flow.mmd', 'flowchart TD\n  A --> B\n'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();

  assert.equal(vaultFileStore.readCount, 1);
  assert.deepEqual(await index.getBacklinks('diagrams/flow.mmd'), [
    {
      contexts: ['![[diagrams/flow.mmd]]'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex resolves vault-local markdown image references', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', [
      '# Source',
      '',
      '![Cover](../assets/cover.png)',
      '![Encoded](../assets/image%20two.webp)',
      '![Remote](https://cdn.example.com/remote.png)',
      '![Data](data:image/png;base64,abc)',
      '![Root](/assets/root.png)',
      '![Not image](../assets/readme.txt)',
    ].join('\n')],
    ['assets/cover.png', 'png-bytes'],
    ['assets/image two.webp', 'webp-bytes'],
    ['assets/root.png', 'png-bytes'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  const readsAfterBuild = vaultFileStore.readCount;

  assert.deepEqual(await index.getBacklinks('assets/cover.png'), [
    {
      contexts: ['![Cover](../assets/cover.png)'],
      file: 'notes/source.md',
    },
  ]);
  assert.deepEqual(await index.getBacklinks('assets/image two.webp'), [
    {
      contexts: ['![Encoded](../assets/image%20two.webp)'],
      file: 'notes/source.md',
    },
  ]);
  assert.deepEqual(await index.getBacklinks('assets/root.png'), []);
  assert.equal(vaultFileStore.readCount, readsAfterBuild);
});

test('BacklinkIndex reindexes only impacted markdown sources when an image target is created', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '![Cover](../assets/cover.png)'],
    ['notes/other.md', 'No image references here.'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  const readsAfterBuild = vaultFileStore.readCount;
  vaultFileStore.files.set('assets/cover.png', 'png-bytes');

  await index.applyWorkspaceChange({
    changedPaths: ['assets/cover.png'],
    deletedPaths: [],
    renamedPaths: [],
  }, {
    previousState: {
      entries: new Map([
        ['notes/other.md', { path: 'notes/other.md', type: 'file' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
    nextState: {
      entries: new Map([
        ['assets/cover.png', { path: 'assets/cover.png', type: 'image' }],
        ['notes/other.md', { path: 'notes/other.md', type: 'file' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
  });

  assert.equal(vaultFileStore.readCount, readsAfterBuild + 1);
  assert.deepEqual(await index.getBacklinks('assets/cover.png'), [
    {
      contexts: ['![Cover](../assets/cover.png)'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex remaps markdown image backlinks when an image target is renamed', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '![Cover](../assets/cover.png)'],
    ['assets/cover.png', 'png-bytes'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  index.onFileRenamed('assets/cover.png', 'assets/hero.png');

  assert.deepEqual(await index.getBacklinks('assets/cover.png'), []);
  assert.deepEqual(await index.getBacklinks('assets/hero.png'), [
    {
      contexts: ['![Cover](../assets/cover.png)'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex preserves markdown image backlinks during workspace rename refreshes', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '![Cover](../assets/cover.png)'],
    ['assets/cover.png', 'png-bytes'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  vaultFileStore.files.delete('assets/cover.png');
  vaultFileStore.files.set('assets/hero.png', 'png-bytes');

  await index.applyWorkspaceChange({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'assets/cover.png', newPath: 'assets/hero.png' }],
  }, {
    previousState: {
      entries: new Map([
        ['assets/cover.png', { path: 'assets/cover.png', type: 'image' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
    nextState: {
      entries: new Map([
        ['assets/hero.png', { path: 'assets/hero.png', type: 'image' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
  });

  assert.deepEqual(await index.getBacklinks('assets/cover.png'), []);
  assert.deepEqual(await index.getBacklinks('assets/hero.png'), [
    {
      contexts: ['![Cover](../assets/cover.png)'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex remaps backlinks when a non-markdown target file is renamed', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '![[diagrams/flow.mmd]]'],
    ['diagrams/flow.mmd', 'flowchart TD\n  A --> B\n'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  index.onFileRenamed('diagrams/flow.mmd', 'diagrams/flowchart.mmd');

  assert.deepEqual(await index.getBacklinks('diagrams/flow.mmd'), []);
  assert.deepEqual(await index.getBacklinks('diagrams/flowchart.mmd'), [
    {
      contexts: ['![[diagrams/flow.mmd]]'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex applies non-markdown target membership changes by reindexing impacted markdown sources', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '![[diagrams/flow.mmd]]'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  const readsAfterBuild = vaultFileStore.readCount;
  vaultFileStore.files.set('diagrams/flow.mmd', 'flowchart TD\n  A --> B\n');

  await index.applyWorkspaceChange({
    changedPaths: ['diagrams/flow.mmd'],
    deletedPaths: [],
    renamedPaths: [],
  }, {
    previousState: {
      entries: new Map([
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
    nextState: {
      entries: new Map([
        ['diagrams/flow.mmd', { path: 'diagrams/flow.mmd', type: 'file' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
  });

  assert.equal(vaultFileStore.readCount, readsAfterBuild + 1);
  assert.deepEqual(await index.getBacklinks('diagrams/flow.mmd'), [
    {
      contexts: ['![[diagrams/flow.mmd]]'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex reindexes impacted sources when a target rename makes a raw link resolvable', async () => {
  const vaultFileStore = new StubVaultStore([
    ['notes/source.md', '[[archive/b]]'],
    ['notes/b.md', '# B'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });

  await index.build();
  vaultFileStore.files.delete('notes/b.md');
  vaultFileStore.files.set('archive/b.md', '# B');

  await index.applyWorkspaceChange({
    changedPaths: [],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'notes/b.md', newPath: 'archive/b.md' }],
  }, {
    previousState: {
      entries: new Map([
        ['notes/b.md', { path: 'notes/b.md', type: 'file' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
    nextState: {
      entries: new Map([
        ['archive/b.md', { path: 'archive/b.md', type: 'file' }],
        ['notes/source.md', { path: 'notes/source.md', type: 'file' }],
      ]),
    },
  });

  assert.deepEqual(await index.getBacklinks('archive/b.md'), [
    {
      contexts: ['[[archive/b]]'],
      file: 'notes/source.md',
    },
  ]);
});

test('BacklinkIndex batches workspace changes behind a single wiki-target refresh', async () => {
  const vaultFileStore = new StubVaultStore([
    ['docs/a.md', '[[docs/b]]'],
    ['docs/b.md', '# b'],
    ['docs/c.md', '# c'],
  ]);
  const index = new BacklinkIndex({ vaultFileStore });
  let refreshCount = 0;
  const originalRefresh = index._refreshWikiTargetIndex.bind(index);
  index._refreshWikiTargetIndex = () => {
    refreshCount += 1;
    originalRefresh();
  };

  await index.build();
  refreshCount = 0;
  vaultFileStore.files.delete('docs/b.md');
  vaultFileStore.files.set('archive/b.md', '# b');
  vaultFileStore.files.set('docs/new.md', '# new');

  await index.applyWorkspaceChange({
    changedPaths: ['docs/new.md'],
    deletedPaths: [],
    renamedPaths: [{ oldPath: 'docs/b.md', newPath: 'archive/b.md' }],
  }, {
    previousState: {
      entries: new Map([
        ['docs/a.md', { path: 'docs/a.md', type: 'file' }],
        ['docs/b.md', { path: 'docs/b.md', type: 'file' }],
        ['docs/c.md', { path: 'docs/c.md', type: 'file' }],
      ]),
    },
    nextState: {
      entries: new Map([
        ['archive/b.md', { path: 'archive/b.md', type: 'file' }],
        ['docs/a.md', { path: 'docs/a.md', type: 'file' }],
        ['docs/c.md', { path: 'docs/c.md', type: 'file' }],
        ['docs/new.md', { path: 'docs/new.md', type: 'file' }],
      ]),
    },
  });

  assert.equal(refreshCount, 1);
});
