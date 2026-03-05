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

test('VaultFileStore rejects non-markdown delete and rename source paths', async (t) => {
  const { store, cleanup, vaultDir } = await createVaultStore();
  t.after(cleanup);

  await writeFile(join(vaultDir, 'secret.txt'), 'plain text', 'utf-8');

  const deleteResult = await store.deleteFile('secret.txt');
  assert.equal(deleteResult.ok, false);
  assert.match(deleteResult.error, /must end in \.md/i);

  const renameResult = await store.renameFile('secret.txt', 'secret.md');
  assert.equal(renameResult.ok, false);
  assert.match(renameResult.error, /Old path must end in \.md/i);
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
