import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { PullBackupStore } from '../../src/server/infrastructure/persistence/pull-backup-store.js';

test('PullBackupStore preserves hidden dirty file bytes without following symlinks', async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-pull-backup-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  await mkdir(join(vaultDir, '.git/info'), { recursive: true });
  const content = Buffer.from('LOCAL_SETTING=dirty\r\n# keep bytes\n');
  await writeFile(join(vaultDir, '.env'), content);
  await symlink(join(vaultDir, '.env'), join(vaultDir, '.linked-env'));
  const store = new PullBackupStore({ vaultDir });
  const backup = await store.createBackup({ entries: [{ path: '.env' }, { path: '.linked-env' }] });
  assert.equal(backup.fileCount, 1);
  assert.deepEqual(await readFile(join(store.getBackupPath(backup.id), 'files/.env')), content);
  await assert.rejects(readFile(join(store.getBackupPath(backup.id), 'files/.linked-env')), { code: 'ENOENT' });
});

test('PullBackupStore rejects symlinked metadata roots before writing outside the Vault', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'collabmd-backup-root-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const vaultDir = join(root, 'vault');
  const outside = join(root, 'outside');
  await mkdir(join(vaultDir, '.git/info'), { recursive: true });
  await mkdir(outside);
  await symlink(outside, join(vaultDir, '.collabmd'));
  const store = new PullBackupStore({ vaultDir });
  await assert.rejects(store.createBackup(), /Unsafe pull backup path/);
  await assert.rejects(readFile(join(vaultDir, '.git/info/exclude')), { code: 'ENOENT' });
  await assert.rejects(readFile(join(outside, 'pull-backups')), { code: 'ENOENT' });
  await rm(join(vaultDir, '.collabmd'));
  await rm(join(vaultDir, '.git'), { recursive: true });
  await symlink(outside, join(vaultDir, '.git'));
  await assert.rejects(store.createBackup(), /Unsafe pull backup path/);
});

test('PullBackupStore rejects symlinked backup targets and ignores traversal patch sources', async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-backup-target-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  await mkdir(join(vaultDir, '.git/info'), { recursive: true });
  const store = new PullBackupStore({ vaultDir });
  const options = { headRef: 'abc1234', createdAt: '2026-09-08T12:00:00Z' };
  const backup = await store.createBackup(options);
  await writeFile(join(vaultDir, 'secret.md'), 'unchanged');
  await rm(join(vaultDir, backup.summaryPath));
  await symlink(join(vaultDir, 'secret.md'), join(vaultDir, backup.summaryPath));
  await assert.rejects(store.createBackup(options), /Unsafe pull backup path/);
  assert.equal(await store.readSummary(backup.id), null);
  assert.equal(await readFile(join(vaultDir, 'secret.md'), 'utf8'), 'unchanged');
  await rm(join(vaultDir, backup.summaryPath));
  const safe = await store.createBackup({ ...options, entries: [{ path: '../../escape', stagedPatchContent: 'bad' }] });
  assert.equal(safe.fileCount, 0);
});
