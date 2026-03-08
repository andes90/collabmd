import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'fs/promises';
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

test('VaultFileStore persists hidden comment sidecars alongside vault files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const threads = [{
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorExcerpt: 'Hello from test vault.',
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

test('VaultFileStore rejects non-markdown delete and rename source paths', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await writeFile(join(vaultDir, 'secret.txt'), 'plain text', 'utf-8');

  const deleteResult = await store.deleteFile('secret.txt');
  assert.equal(deleteResult.ok, false);
  assert.match(deleteResult.error, /must end in \.md, \.excalidraw, \.mmd, \.mermaid, \.puml, or \.plantuml/i);

  const renameResult = await store.renameFile('secret.txt', 'secret.md');
  assert.equal(renameResult.ok, false);
  assert.match(renameResult.error, /Old path must be a vault file \(\.md, \.excalidraw, \.mmd, \.mermaid, \.puml, or \.plantuml\)/i);
});

test('VaultFileStore rejects path traversal', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const result = await store.readMarkdownFile('../../etc/passwd');
  assert.equal(result, null);
});

test('VaultFileStore counts markdown files', async (t) => {
  const { store, cleanup } = await createVaultStore();
  t.after(cleanup);

  const count = await store.countMarkdownFiles();
  assert.equal(count, 2);
});
