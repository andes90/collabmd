import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { renameSync, symlinkSync } from 'node:fs';

import { GitUntrackedFileService } from '../../src/server/infrastructure/git/untracked-files.js';

test('countAdditions streams files with and without final newlines', async (t) => {
  const vaultDir = await mkdtemp(join(tmpdir(), 'collabmd-untracked-'));
  t.after(() => rm(vaultDir, { force: true, recursive: true }));
  await writeFile(join(vaultDir, 'first.md'), 'one\ntwo\n');
  await writeFile(join(vaultDir, 'second.md'), 'three');

  const service = new GitUntrackedFileService({ vaultDir });

  assert.equal(await service.countAdditions([
    { path: 'first.md' },
    { path: 'second.md' },
  ]), 3);
});

test('untracked reads reject escaping paths and symlinks, including parent and image links', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'collabmd-untracked-links-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const vaultDir = join(root, 'vault');
  const outside = join(root, 'outside');
  await mkdir(vaultDir);
  await mkdir(outside);
  await writeFile(join(outside, 'secret.md'), 'outside\n');
  await writeFile(join(outside, 'secret.png'), 'outside-image');
  await symlink(outside, join(vaultDir, 'parent'));
  await symlink(join(outside, 'secret.md'), join(vaultDir, 'leaf.md'));
  await symlink(join(outside, 'secret.png'), join(vaultDir, 'leaf.png'));
  await symlink(join(outside, 'missing.md'), join(vaultDir, 'dangling.md'));
  const service = new GitUntrackedFileService({ vaultDir });
  const files = ['leaf.md', 'leaf.png', 'parent/secret.md', 'dangling.md', '../outside/secret.md', join(outside, 'secret.md')]
    .map((path) => ({ path }));
  assert.equal(await service.countAdditions(files), 0);
  assert.deepEqual(await service.buildSyntheticDiffs(files), []);
  for (const { path } of files) assert.equal(await service.getByteLength(path), 0);
});

test('untracked reads preserve Git filenames, dotfiles, binary images and a symlinked vault root', async (t) => {
  const root = await mkdtemp(join(tmpdir(), 'collabmd-untracked-names-'));
  t.after(() => rm(root, { force: true, recursive: true }));
  const vaultDir = join(root, 'vault');
  await mkdir(vaultDir);
  await symlink(vaultDir, join(root, 'alias'));
  const service = new GitUntrackedFileService({ vaultDir: join(root, 'alias') });
  const paths = ['.config', '..config', ' leading.txt ', 'literal\\name.txt'];
  for (const path of paths) await writeFile(join(vaultDir, path), `${path}\n`);
  const files = paths.map((path) => ({ path }));
  assert.equal(await service.countAdditions(files), paths.length);
  const diffs = await service.buildSyntheticDiffs(files);
  assert.deepEqual(diffs.map((file) => file.hunks[0].lines[0].content), paths);
  await writeFile(join(vaultDir, 'image.png'), Buffer.from([0, 1, 2]));
  assert.equal((await service.buildSyntheticDiffs([{ path: 'image.png' }]))[0].byteLength, 3);
});

for (const parentSwap of [false, true]) {
  for (const method of ['buildSyntheticDiffs', 'countAdditions', 'getByteLength']) {
    test(`${method} rejects a ${parentSwap ? 'parent' : 'leaf'} symlink swapped in after path validation`, async (t) => {
      const root = await mkdtemp(join(tmpdir(), 'collabmd-untracked-swap-'));
      t.after(() => rm(root, { force: true, recursive: true }));
      const vaultDir = join(root, 'vault');
      const outside = join(root, 'outside');
      await mkdir(join(vaultDir, 'nested'), { recursive: true });
      await mkdir(outside);
      await writeFile(join(vaultDir, 'nested', 'note.md'), 'inside');
      await writeFile(join(outside, 'note.md'), 'OUTSIDE_SENTINEL');
      const service = new GitUntrackedFileService({ vaultDir });
      const resolvePath = service.resolvePath.bind(service);
      t.mock.method(service, 'resolvePath', (path) => {
        const result = resolvePath(path);
        if (result) {
          const target = parentSwap ? join(vaultDir, 'nested') : join(vaultDir, 'nested', 'note.md');
          renameSync(target, `${target}.original`);
          symlinkSync(parentSwap ? outside : join(outside, 'note.md'), target);
        }
        return result;
      });
      const argument = method === 'getByteLength' ? 'nested/note.md' : [{ path: 'nested/note.md' }];
      assert.deepEqual(await service[method](argument), method === 'buildSyntheticDiffs' ? [] : 0);
    });
  }
}
