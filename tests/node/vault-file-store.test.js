import test from 'node:test';
import assert from 'node:assert/strict';
import { access, mkdtemp, mkdir, rm, writeFile } from 'fs/promises';
import { join } from 'path';
import { tmpdir } from 'os';

import { VaultFileStore } from '../../src/server/infrastructure/persistence/vault-file-store.js';

async function createVaultStore() {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-vault-'));

  // Seed some files
  await mkdir(join(vaultDir, 'notes'), { recursive: true });
  await writeFile(join(vaultDir, 'README.md'), '# Readme\n', 'utf-8');
  await writeFile(join(vaultDir, 'notes/daily.md'), '# Daily\n', 'utf-8');

  return {
    cleanup: () => rm(vaultDir, { force: true, recursive: true }),
    store: new VaultFileStore({ vaultDir }),
    vaultDir,
  };
}

async function pathExists(pathValue) {
  try {
    await access(pathValue);
    return true;
  } catch {
    return false;
  }
}

test('VaultFileStore reads file tree with directories and markdown files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const tree = await store.tree();
  assert.ok(Array.isArray(tree));

  const dir = tree.find((n) => n.name === 'notes');
  assert.ok(dir);
  assert.equal(dir.type, 'directory');
  assert.ok(dir.children.some((c) => c.name === 'daily.md'));

  const readme = tree.find((n) => n.name === 'README.md');
  assert.ok(readme);
  assert.equal(readme.type, 'file');
});

test('VaultFileStore reads and writes markdown files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const content = await store.readMarkdownFile('README.md');
  assert.equal(content, '# Readme\n');

  await store.writeMarkdownFile('README.md', '# Updated\n');
  const updated = await store.readMarkdownFile('README.md');
  assert.equal(updated, '# Updated\n');
});

test('VaultFileStore can preserve the current collaboration snapshot during room-owned file persists', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const snapshot = Uint8Array.from([1, 2, 3, 4]);
  const snapshotWrite = await store.writeCollaborationSnapshot('README.md', snapshot);
  assert.equal(snapshotWrite.ok, true);

  const writeResult = await store.writeMarkdownFile('README.md', '# Updated via room\n', {
    invalidateCollaborationSnapshot: false,
  });
  assert.equal(writeResult.ok, true);

  const preservedSnapshot = await store.readCollaborationSnapshot('README.md');
  assert.deepEqual(Array.from(preservedSnapshot ?? []), Array.from(snapshot));

  const invalidatingWrite = await store.writeMarkdownFile('README.md', '# Updated via API\n');
  assert.equal(invalidatingWrite.ok, true);
  assert.equal(await store.readCollaborationSnapshot('README.md'), null);
});

test('VaultFileStore persists content, comments, and snapshot as one staged collaboration update', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const threads = [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 1,
    anchorKind: 'line',
    anchorQuote: '# Updated atomically',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 1,
    createdAt: 1,
    createdByColor: '#0f172a',
    createdByName: 'Reviewer',
    createdByPeerId: 'peer-1',
    id: 'thread-atomic',
    messages: [{
      body: 'Atomic persist keeps metadata aligned.',
      createdAt: 1,
      id: 'message-atomic',
      peerId: 'peer-1',
      reactions: [{
        emoji: '🎉',
        users: [{
          reactedAt: 1,
          userColor: '#0f172a',
          userId: 'user-1',
          userName: 'Reviewer',
        }],
      }],
      userColor: '#0f172a',
      userName: 'Reviewer',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  }];
  const snapshot = Uint8Array.from([9, 8, 7, 6]);

  const result = await store.persistCollaborationState('README.md', {
    commentThreads: threads,
    content: '# Updated atomically\n',
    snapshot,
  });

  assert.equal(result.ok, true);
  assert.equal(await store.readMarkdownFile('README.md'), '# Updated atomically\n');
  assert.deepEqual(await store.readCommentThreads('README.md'), threads);
  assert.deepEqual(Array.from(await store.readCollaborationSnapshot('README.md') ?? []), Array.from(snapshot));
});

test('VaultFileStore leaves live content untouched when staged collaboration snapshot preparation fails', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await mkdir(join(vaultDir, '.collabmd'), { recursive: true });
  await writeFile(join(vaultDir, '.collabmd', 'yjs'), 'blocked', 'utf-8');

  const result = await store.persistCollaborationState('README.md', {
    commentThreads: [{
      anchorEnd: { assoc: 0, type: null },
      anchorEndLine: 1,
      anchorKind: 'line',
      anchorQuote: '# Broken update',
      anchorStart: { assoc: 0, type: null },
      anchorStartLine: 1,
      createdAt: 1,
      createdByColor: '#ef4444',
      createdByName: 'Reviewer',
      createdByPeerId: 'peer-2',
      id: 'thread-failed',
      messages: [{
        body: 'This should not commit partially.',
        createdAt: 1,
        id: 'message-failed',
        peerId: 'peer-2',
        userColor: '#ef4444',
        userName: 'Reviewer',
      }],
      resolvedAt: null,
      resolvedByColor: '',
      resolvedByName: '',
      resolvedByPeerId: '',
    }],
    content: '# Broken update\n',
    snapshot: Uint8Array.from([1, 2, 3]),
  });

  assert.equal(result.ok, false);
  assert.match(result.error, /not a directory|EEXIST|ENOTDIR/i);
  assert.equal(await store.readMarkdownFile('README.md'), '# Readme\n');
  assert.deepEqual(await store.readCommentThreads('README.md'), []);
  assert.equal(await pathExists(join(vaultDir, '.collabmd/comments/README.md.json')), false);
  assert.equal(await pathExists(join(vaultDir, '.collabmd/yjs/README.md.bin')), false);
});

test('VaultFileStore persists hidden comment sidecars alongside vault files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const threads = [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorKind: 'line',
    anchorQuote: 'Hello from test vault.',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 3,
    createdAt: 1,
    createdByColor: '#4f46e5',
    createdByName: 'Andes',
    createdByPeerId: 'peer-1',
    id: 'thread-1',
    messages: [{
      body: 'Please clarify this line.',
      createdAt: 1,
      id: 'comment-1',
      peerId: 'peer-1',
      reactions: [{
        emoji: '👍',
        users: [{
          reactedAt: 1,
          userColor: '#4f46e5',
          userId: 'user-1',
          userName: 'Andes',
        }],
      }],
      userColor: '#4f46e5',
      userName: 'Andes',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  }];

  const writeResult = await store.writeCommentThreads('README.md', threads);
  assert.equal(writeResult.ok, true);
  assert.deepEqual(await store.readCommentThreads('README.md'), threads);

  const tree = await store.tree();
  assert.equal(tree.some((node) => node.name === '.collabmd'), false);

  const renameResult = await store.renameFile('README.md', 'renamed.md');
  assert.equal(renameResult.ok, true);
  assert.deepEqual(await store.readCommentThreads('README.md'), []);
  assert.deepEqual(await store.readCommentThreads('renamed.md'), threads);

  const deleteResult = await store.deleteFile('renamed.md');
  assert.equal(deleteResult.ok, true);
  assert.deepEqual(await store.readCommentThreads('renamed.md'), []);
});

test('VaultFileStore reads and writes PlantUML files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const createResult = await store.createFile('diagram.puml', '@startuml\nAlice -> Bob: Hi\n@enduml\n');
  assert.equal(createResult.ok, true);

  const content = await store.readPlantUmlFile('diagram.puml');
  assert.equal(content, '@startuml\nAlice -> Bob: Hi\n@enduml\n');

  const writeResult = await store.writePlantUmlFile('diagram.puml', '@startuml\nBob -> Alice: Ack\n@enduml\n');
  assert.equal(writeResult.ok, true);

  const updated = await store.readPlantUmlFile('diagram.puml');
  assert.equal(updated, '@startuml\nBob -> Alice: Ack\n@enduml\n');
});

test('VaultFileStore reads and writes Mermaid files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const createResult = await store.createFile('diagram.mmd', 'flowchart TD\n  A --> B\n');
  assert.equal(createResult.ok, true);

  const content = await store.readMermaidFile('diagram.mmd');
  assert.equal(content, 'flowchart TD\n  A --> B\n');

  const writeResult = await store.writeMermaidFile('diagram.mmd', 'flowchart TD\n  B --> C\n');
  assert.equal(writeResult.ok, true);

  const updated = await store.readMermaidFile('diagram.mmd');
  assert.equal(updated, 'flowchart TD\n  B --> C\n');
});

test('VaultFileStore reads and writes .plantuml files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const createResult = await store.createFile('architecture.plantuml', '@startuml\nAlice -> Bob: Hi\n@enduml\n');
  assert.equal(createResult.ok, true);

  const content = await store.readPlantUmlFile('architecture.plantuml');
  assert.equal(content, '@startuml\nAlice -> Bob: Hi\n@enduml\n');

  const writeResult = await store.writePlantUmlFile('architecture.plantuml', '@startuml\nBob -> Alice: Ack\n@enduml\n');
  assert.equal(writeResult.ok, true);

  const updated = await store.readPlantUmlFile('architecture.plantuml');
  assert.equal(updated, '@startuml\nBob -> Alice: Ack\n@enduml\n');
});

test('VaultFileStore creates and deletes files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const result = await store.createFile('new.md', '# New\n');
  assert.ok(result.ok);

  const content = await store.readMarkdownFile('new.md');
  assert.equal(content, '# New\n');

  // Can't create duplicate
  const duplicate = await store.createFile('new.md');
  assert.equal(duplicate.ok, false);

  const deleteResult = await store.deleteFile('new.md');
  assert.ok(deleteResult.ok);

  const deleted = await store.readMarkdownFile('new.md');
  assert.equal(deleted, null);
});

test('VaultFileStore includes empty directories in the file tree', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const result = await store.createDirectory('drafts');
  assert.equal(result.ok, true);

  const tree = await store.tree();
  const drafts = tree.find((node) => node.name === 'drafts');
  assert.ok(drafts);
  assert.equal(drafts.type, 'directory');
  assert.deepEqual(drafts.children, []);
});

test('VaultFileStore renames directories and preserves nested sidecars', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await store.writeCommentThreads('notes/daily.md', [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 1,
    anchorKind: 'line',
    anchorQuote: '# Daily',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 1,
    createdAt: 1,
    createdByColor: '#111827',
    createdByName: 'Tester',
    createdByPeerId: 'peer-1',
    id: 'thread-1',
    messages: [{
      body: 'hello',
      createdAt: 1,
      id: 'message-1',
      peerId: 'peer-1',
      userColor: '#111827',
      userName: 'Tester',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  }]);
  await store.writeCollaborationSnapshot('notes/daily.md', Uint8Array.from([1, 2, 3]));

  const result = await store.renameDirectory('notes', 'archive/notes');
  assert.equal(result.ok, true);
  assert.equal(await pathExists(join(vaultDir, 'notes')), false);
  assert.equal(await pathExists(join(vaultDir, 'archive/notes/daily.md')), true);
  assert.deepEqual(await store.readCommentThreads('archive/notes/daily.md'), [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 1,
    anchorKind: 'line',
    anchorQuote: '# Daily',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 1,
    createdAt: 1,
    createdByColor: '#111827',
    createdByName: 'Tester',
    createdByPeerId: 'peer-1',
    id: 'thread-1',
    messages: [{
      body: 'hello',
      createdAt: 1,
      id: 'message-1',
      peerId: 'peer-1',
      userColor: '#111827',
      userName: 'Tester',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  }]);
  assert.deepEqual(Array.from(await store.readCollaborationSnapshot('archive/notes/daily.md') ?? []), [1, 2, 3]);
});

test('VaultFileStore rejects deleting non-empty directories unless recursive and removes nested content recursively', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await store.writeCommentThreads('notes/daily.md', [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 1,
    anchorKind: 'line',
    anchorQuote: '# Daily',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 1,
    createdAt: 1,
    createdByColor: '#111827',
    createdByName: 'Tester',
    createdByPeerId: 'peer-1',
    id: 'thread-delete',
    messages: [{
      body: 'remove',
      createdAt: 1,
      id: 'message-delete',
      peerId: 'peer-1',
      userColor: '#111827',
      userName: 'Tester',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  }]);
  await store.writeCollaborationSnapshot('notes/daily.md', Uint8Array.from([4, 5, 6]));

  const rejected = await store.deleteDirectory('notes');
  assert.equal(rejected.ok, false);
  assert.equal(rejected.error, 'Directory is not empty');

  const deleted = await store.deleteDirectory('notes', { recursive: true });
  assert.equal(deleted.ok, true);
  assert.equal(await pathExists(join(vaultDir, 'notes')), false);
  assert.deepEqual(await store.readCommentThreads('notes/daily.md'), []);
  assert.equal(await store.readCollaborationSnapshot('notes/daily.md'), null);
});

test('VaultFileStore writes image attachments next to their source markdown document', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const result = await store.writeImageAttachmentForDocument('README.md', {
    content: Buffer.from([0x89, 0x50, 0x4e, 0x47]),
    mimeType: 'image/png',
    now: new Date(2026, 2, 16, 15, 30, 12),
    originalFileName: 'Product Screenshot.png',
  });

  assert.equal(result.ok, true);
  assert.equal(result.altText, 'Product Screenshot');
  assert.equal(result.path, 'README.assets/product-screenshot-20260316-153012.png');
  assert.equal(result.markdownSnippet, '![Product Screenshot](README.assets/product-screenshot-20260316-153012.png)');

  const attachment = await store.readImageAttachmentFile(result.path);
  assert.deepEqual(Array.from(attachment?.content ?? []), [0x89, 0x50, 0x4e, 0x47]);
  assert.equal(attachment?.mimeType, 'image/png');

  const tree = await store.tree();
  const assetsDirectory = tree.find((node) => node.name === 'README.assets');
  assert.ok(assetsDirectory);
  assert.equal(assetsDirectory.type, 'directory');
  assert.deepEqual(
    assetsDirectory.children.map((node) => ({ name: node.name, type: node.type })),
    [{ name: 'product-screenshot-20260316-153012.png', type: 'image' }],
  );
});

test('VaultFileStore rejects non-markdown delete and rename source paths', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await writeFile(join(vaultDir, 'secret.txt'), 'plain text', 'utf-8');

  const deleteResult = await store.deleteFile('secret.txt');
  assert.equal(deleteResult.ok, false);
  assert.match(deleteResult.error, /must end in \.md, .*\.png, .*\.svg/i);

  const renameResult = await store.renameFile('secret.txt', 'secret.md');
  assert.equal(renameResult.ok, false);
  assert.match(renameResult.error, /Old path must be a vault file \(\.md, .*\.png, .*\.svg\)/i);
});

test('VaultFileStore rejects path traversal', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const result = await store.readMarkdownFile('../../etc/passwd');
  assert.equal(result, null);
});

test('VaultFileStore rejects path traversal even when the target uses a vault extension', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await writeFile(join(vaultDir, 'escape.md'), '# Escape\n', 'utf-8');

  assert.equal(await store.readMarkdownFile('../escape.md'), null);

  const createResult = await store.createFile('../created-outside.md', '# Nope\n');
  assert.equal(createResult.ok, false);
  assert.match(createResult.error, /must end in \.md, .*\.png, .*\.svg/i);

  const renameResult = await store.renameFile('README.md', '../escape.md');
  assert.equal(renameResult.ok, false);
  assert.equal(renameResult.error, 'Invalid file path');

  const deleteResult = await store.deleteFile('../escape.md');
  assert.equal(deleteResult.ok, false);
  assert.match(deleteResult.error, /must end in \.md, .*\.png, .*\.svg/i);

  const directoryResult = await store.createDirectory('../outside-dir');
  assert.equal(directoryResult.ok, false);
  assert.equal(directoryResult.error, 'Invalid directory path');
});

test('VaultFileStore counts vault files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const count = await store.countVaultFiles();
  assert.equal(count, 2);
});
