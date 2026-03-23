import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile as execFileCallback } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

import { GitService } from '../../src/server/infrastructure/git/git-service.js';

const execFile = promisify(execFileCallback);

async function runGit(cwd, args) {
  await execFile('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_AUTHOR_NAME: 'CollabMD Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'CollabMD Tests',
    },
  });
}

async function runGitOutput(cwd, args) {
  const result = await execFile('git', args, {
    cwd,
    env: {
      ...process.env,
      GIT_AUTHOR_EMAIL: 'tests@example.com',
      GIT_AUTHOR_NAME: 'CollabMD Tests',
      GIT_COMMITTER_EMAIL: 'tests@example.com',
      GIT_COMMITTER_NAME: 'CollabMD Tests',
    },
  });

  return String(result.stdout ?? '').trim();
}

async function createFixtureRepository() {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-'));

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  await writeFile(join(repoDir, 'tracked.md'), '# Tracked\n\nbase\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);

  await writeFile(join(repoDir, 'tracked.md'), '# Tracked\n\nbase\nupdated\n', 'utf8');
  await writeFile(join(repoDir, 'staged.md'), '# Staged\n\nready\n', 'utf8');
  await runGit(repoDir, ['add', 'staged.md']);
  await writeFile(join(repoDir, 'untracked.md'), '# Untracked\n\nscratch\n', 'utf8');

  return repoDir;
}

async function createRemotePullFixture(t) {
  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-git-remote-fixture-'));
  const seedDir = await mkdtemp(join(tmpdir(), 'collabmd-git-seed-fixture-'));
  const localDir = await mkdtemp(join(tmpdir(), 'collabmd-git-local-fixture-'));
  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-git-peer-fixture-'));

  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(seedDir, { force: true, recursive: true });
    await rm(localDir, { force: true, recursive: true });
    await rm(peerDir, { force: true, recursive: true });
  });

  await runGit(remoteDir, ['init', '--bare']);

  await runGit(seedDir, ['init']);
  await runGit(seedDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(seedDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(seedDir, 'tracked.md'), '# Seed\n', 'utf8');
  await runGit(seedDir, ['add', 'tracked.md']);
  await runGit(seedDir, ['commit', '-m', 'Initial commit']);
  await runGit(seedDir, ['remote', 'add', 'origin', remoteDir]);
  await runGit(seedDir, ['push', '-u', 'origin', 'master']);

  await runGit(tmpdir(), ['clone', remoteDir, localDir]);
  await runGit(localDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(localDir, ['config', 'user.name', 'CollabMD Tests']);

  await runGit(tmpdir(), ['clone', remoteDir, peerDir]);
  await runGit(peerDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(peerDir, ['config', 'user.name', 'CollabMD Tests']);

  return {
    localDir,
    peerDir,
    remoteDir,
    seedDir,
  };
}

function createCountingExecFileImpl({ delayStatusMs = 0 } = {}) {
  const calls = [];

  return {
    calls,
    execFileImpl: async (...args) => {
      const [, gitArgs = []] = args;
      calls.push(gitArgs);
      if (delayStatusMs > 0 && gitArgs[0] === '-c' && gitArgs[2] === 'status') {
        await new Promise((resolve) => setTimeout(resolve, delayStatusMs));
      }
      return execFile(...args);
    },
  };
}

test('GitService reports sections and diffs for staged, unstaged, and untracked files', async (t) => {
  const repoDir = await createFixtureRepository();
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  const gitService = new GitService({ vaultDir: repoDir });
  const status = await gitService.getStatus({ force: true });

  assert.equal(status.isGitRepo, true);
  assert.equal(status.summary.staged, 1);
  assert.equal(status.summary.workingTree, 1);
  assert.equal(status.summary.untracked, 1);
  assert.equal(status.summary.additions > 0, true);

  const stagedFile = status.sections.find((section) => section.key === 'staged')?.files[0];
  const workingTreeFile = status.sections.find((section) => section.key === 'working-tree')?.files[0];
  const untrackedFile = status.sections.find((section) => section.key === 'untracked')?.files[0];

  assert.equal(stagedFile?.path, 'staged.md');
  assert.equal(stagedFile?.status, 'added');
  assert.equal(workingTreeFile?.path, 'tracked.md');
  assert.equal(workingTreeFile?.status, 'modified');
  assert.equal(untrackedFile?.path, 'untracked.md');
  assert.equal(untrackedFile?.status, 'untracked');

  const workingTreeDiff = await gitService.getDiff({ scope: 'working-tree' });
  assert.deepEqual(
    workingTreeDiff.files.map((file) => file.path).sort(),
    ['tracked.md', 'untracked.md'],
  );

  const stagedDiff = await gitService.getDiff({ scope: 'staged' });
  assert.deepEqual(stagedDiff.files.map((file) => file.path), ['staged.md']);
  assert.equal(stagedDiff.files[0].status, 'added');

  const fullDiff = await gitService.getDiff({ scope: 'all' });
  assert.deepEqual(
    fullDiff.files.map((file) => file.path).sort(),
    ['staged.md', 'tracked.md', 'untracked.md'],
  );
  assert.equal(fullDiff.summary.filesChanged, 3);

  const metaDiff = await gitService.getDiff({ metaOnly: true, scope: 'all' });
  assert.equal(metaDiff.metaOnly, true);
  assert.deepEqual(
    metaDiff.files.map((file) => file.path).sort(),
    ['staged.md', 'tracked.md', 'untracked.md'],
  );
  assert.equal(metaDiff.files.every((file) => !('hunks' in file)), true);
});

test('GitService normalizes git paths that include spaces', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-paths-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  const filePath = 'BFI - Biller/sample flow.puml';
  await mkdir(join(repoDir, 'BFI - Biller'), { recursive: true });
  await writeFile(join(repoDir, filePath), '@startuml\nAlice -> Bob\n@enduml\n', 'utf8');
  await runGit(repoDir, ['add', filePath]);
  await runGit(repoDir, ['commit', '-m', 'Add flow']);
  await writeFile(join(repoDir, filePath), '@startuml\nAlice -> Bob : updated\n@enduml\n', 'utf8');

  const gitService = new GitService({ vaultDir: repoDir });
  const status = await gitService.getStatus({ force: true });
  const changedFile = status.sections.find((section) => section.key === 'working-tree')?.files[0];

  assert.equal(changedFile?.path, filePath);

  const diff = await gitService.getDiff({ path: filePath, scope: 'working-tree' });
  assert.equal(diff.files.length, 1);
  assert.equal(diff.files[0].path, filePath);
});

test('GitService guards large file patches until explicitly requested', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-large-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  const largeContent = Array.from({ length: 80 }, (_, index) => `line ${index + 1}`).join('\n');
  await writeFile(join(repoDir, 'large.md'), `${largeContent}\n`, 'utf8');
  await runGit(repoDir, ['add', 'large.md']);
  await runGit(repoDir, ['commit', '-m', 'Add large file']);
  await writeFile(
    join(repoDir, 'large.md'),
    `${largeContent}\n${Array.from({ length: 80 }, (_, index) => `new line ${index + 1}`).join('\n')}\n`,
    'utf8',
  );

  const guardedCounter = createCountingExecFileImpl();
  const gitService = new GitService({
    execFileImpl: guardedCounter.execFileImpl,
    maxInitialPatchLines: 20,
    vaultDir: repoDir,
  });

  const guardedDiff = await gitService.getDiff({ path: 'large.md', scope: 'working-tree' });
  assert.equal(guardedDiff.files.length, 1);
  assert.equal(guardedDiff.files[0].tooLarge, true);
  assert.equal(guardedDiff.files[0].canLoadFullPatch, true);
  assert.deepEqual(guardedDiff.files[0].hunks, []);
  assert.equal(guardedCounter.calls.length, 3);
  assert.equal(
    guardedCounter.calls.some((args) => args[2] === 'diff' && !args.includes('--numstat')),
    false,
  );

  const fullCounter = createCountingExecFileImpl();
  const fullDiffService = new GitService({
    execFileImpl: fullCounter.execFileImpl,
    maxInitialPatchLines: 20,
    vaultDir: repoDir,
  });

  const fullDiff = await fullDiffService.getDiff({
    allowLargePatch: true,
    path: 'large.md',
    scope: 'working-tree',
  });
  assert.equal(fullDiff.files[0].tooLarge, false);
  assert.equal(fullDiff.files[0].hunks.length > 0, true);
  assert.equal(
    fullCounter.calls.some((args) => args[2] === 'diff' && !args.includes('--numstat')),
    true,
  );
});

test('GitService avoids redundant subprocesses for status and meta diff requests', async (t) => {
  const repoDir = await createFixtureRepository();
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  const statusCounter = createCountingExecFileImpl();
  const statusService = new GitService({
    execFileImpl: statusCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  await statusService.getStatus({ force: true });
  assert.equal(statusCounter.calls.length, 2);
  assert.equal(statusCounter.calls.some((args) => args.includes('rev-parse')), false);

  const diffCounter = createCountingExecFileImpl();
  const diffService = new GitService({
    execFileImpl: diffCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  const metaDiff = await diffService.getDiff({ metaOnly: true, scope: 'all' });
  assert.equal(metaDiff.summary.filesChanged, 3);
  assert.equal(diffCounter.calls.length, 3);
  assert.equal(diffCounter.calls.some((args) => args.includes('rev-parse')), false);
});

test('GitService coalesces concurrent status and diff requests', async (t) => {
  const repoDir = await createFixtureRepository();
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  const statusCounter = createCountingExecFileImpl({ delayStatusMs: 50 });
  const statusService = new GitService({
    execFileImpl: statusCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  const [firstStatus, secondStatus] = await Promise.all([
    statusService.getStatus({ force: true }),
    statusService.getStatus({ force: true }),
  ]);
  assert.equal(firstStatus.summary.changedFiles, secondStatus.summary.changedFiles);
  assert.equal(statusCounter.calls.length, 2);

  const diffCounter = createCountingExecFileImpl({ delayStatusMs: 50 });
  const diffService = new GitService({
    execFileImpl: diffCounter.execFileImpl,
    statusCacheTtlMs: 0,
    vaultDir: repoDir,
  });
  const [firstDiff, secondDiff] = await Promise.all([
    diffService.getDiff({ metaOnly: true, scope: 'all' }),
    diffService.getDiff({ metaOnly: true, scope: 'all' }),
  ]);
  assert.equal(firstDiff.summary.filesChanged, secondDiff.summary.filesChanged);
  assert.equal(diffCounter.calls.length, 3);
});

test('GitService stages, unstages, and commits all staged changes', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-actions-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'a.md'), '# A\n', 'utf8');
  await writeFile(join(repoDir, 'b.md'), '# B\n', 'utf8');
  await runGit(repoDir, ['add', 'a.md', 'b.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);

  await writeFile(join(repoDir, 'a.md'), '# A\nupdated\n', 'utf8');
  await writeFile(join(repoDir, 'b.md'), '# B\nstaged elsewhere\n', 'utf8');

  const gitService = new GitService({ vaultDir: repoDir });
  await gitService.stageFile('b.md');
  await gitService.stageFile('a.md');

  let status = await gitService.getStatus({ force: true });
  assert.equal(status.sections.find((section) => section.key === 'staged')?.files.length, 2);

  await gitService.unstageFile('a.md');
  status = await gitService.getStatus({ force: true });
  assert.equal(status.sections.find((section) => section.key === 'staged')?.files.map((file) => file.path).join(','), 'b.md');
  assert.equal(status.sections.find((section) => section.key === 'working-tree')?.files.map((file) => file.path).join(','), 'a.md');

  await gitService.stageFile('a.md');
  const commitResult = await gitService.commitStaged({
    message: 'Commit staged changes',
  });
  assert.equal(commitResult.commit.message, 'Commit staged changes');
  assert.equal(commitResult.commit.shortHash.length > 0, true);

  const headMessage = await execFile('git', ['log', '-1', '--pretty=%s'], { cwd: repoDir });
  assert.equal(String(headMessage.stdout).trim(), 'Commit staged changes');

  status = await gitService.getStatus({ force: true });
  assert.equal((status.sections.find((section) => section.key === 'staged')?.files ?? []).length, 0);
  assert.equal((status.sections.find((section) => section.key === 'working-tree')?.files ?? []).length, 0);
});

test('GitService can commit staged changes when identity is provided through command env', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-identity-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await writeFile(join(repoDir, 'a.md'), '# A\n', 'utf8');
  await runGit(repoDir, ['add', 'a.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  await runGit(repoDir, ['config', '--unset-all', 'user.name']).catch(() => undefined);
  await runGit(repoDir, ['config', '--unset-all', 'user.email']).catch(() => undefined);

  await writeFile(join(repoDir, 'a.md'), '# A\nidentity env\n', 'utf8');

  const gitService = new GitService({
    commandEnv: {
      GIT_AUTHOR_EMAIL: 'bot@example.com',
      GIT_AUTHOR_NAME: 'CollabMD Bot',
      GIT_COMMITTER_EMAIL: 'bot@example.com',
      GIT_COMMITTER_NAME: 'CollabMD Bot',
    },
    vaultDir: repoDir,
  });

  await gitService.stageFile('a.md');
  const commitResult = await gitService.commitStaged({
    message: 'Commit with env identity',
  });

  assert.equal(commitResult.commit.message, 'Commit with env identity');
});

test('GitService can override commit identity per request author', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-service-author-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await writeFile(join(repoDir, 'a.md'), '# A\n', 'utf8');
  await runGit(repoDir, ['add', 'a.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  await runGit(repoDir, ['config', '--unset-all', 'user.name']).catch(() => undefined);
  await runGit(repoDir, ['config', '--unset-all', 'user.email']).catch(() => undefined);

  await writeFile(join(repoDir, 'a.md'), '# A\nauthor override\n', 'utf8');

  const gitService = new GitService({
    commandEnv: {
      GIT_AUTHOR_EMAIL: 'bot@example.com',
      GIT_AUTHOR_NAME: 'CollabMD Bot',
      GIT_COMMITTER_EMAIL: 'bot@example.com',
      GIT_COMMITTER_NAME: 'CollabMD Bot',
    },
    vaultDir: repoDir,
  });

  await gitService.stageFile('a.md');
  await gitService.commitStaged({
    author: {
      email: 'google@example.com',
      name: 'Google User',
    },
    message: 'Commit with request author',
  });

  const headAuthor = await execFile('git', ['log', '-1', '--pretty=%an <%ae>'], { cwd: repoDir });
  assert.equal(String(headAuthor.stdout).trim(), 'Google User <google@example.com>');
});

test('GitService pushes and pulls against an upstream branch', async (t) => {
  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-git-remote-'));
  const seedDir = await mkdtemp(join(tmpdir(), 'collabmd-git-seed-'));
  const localDir = await mkdtemp(join(tmpdir(), 'collabmd-git-local-'));
  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(seedDir, { force: true, recursive: true });
    await rm(localDir, { force: true, recursive: true });
  });

  await runGit(remoteDir, ['init', '--bare']);

  await runGit(seedDir, ['init']);
  await runGit(seedDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(seedDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(seedDir, 'test.md'), '# Seed\n', 'utf8');
  await runGit(seedDir, ['add', 'test.md']);
  await runGit(seedDir, ['commit', '-m', 'Initial commit']);
  await runGit(seedDir, ['remote', 'add', 'origin', remoteDir]);
  await runGit(seedDir, ['push', '-u', 'origin', 'master']);

  await runGit(tmpdir(), ['clone', remoteDir, localDir]);
  await runGit(localDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(localDir, ['config', 'user.name', 'CollabMD Tests']);

  const gitService = new GitService({ vaultDir: localDir });

  await writeFile(join(localDir, 'test.md'), '# Seed\nlocal change\n', 'utf8');
  await runGit(localDir, ['add', 'test.md']);
  await runGit(localDir, ['commit', '-m', 'Local commit']);
  await gitService.pushBranch();

  const remoteLog = await execFile('git', ['--git-dir', remoteDir, 'log', '-1', '--pretty=%s']);
  assert.equal(String(remoteLog.stdout).trim(), 'Local commit');

  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-git-peer-'));
  t.after(async () => {
    await rm(peerDir, { force: true, recursive: true });
  });
  await runGit(tmpdir(), ['clone', remoteDir, peerDir]);
  await runGit(peerDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(peerDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(peerDir, 'test.md'), '# Seed\nlocal change\npeer change\n', 'utf8');
  await runGit(peerDir, ['add', 'test.md']);
  await runGit(peerDir, ['commit', '-m', 'Peer commit']);
  await runGit(peerDir, ['push']);

  await gitService.pullBranch();

  const localContent = await execFile('git', ['show', 'HEAD:test.md'], { cwd: localDir });
  assert.match(String(localContent.stdout), /peer change/);
});

test('GitService pull reports workspace changes from the fetched ref update', async (t) => {
  const remoteDir = await mkdtemp(join(tmpdir(), 'collabmd-git-remote-change-'));
  const seedDir = await mkdtemp(join(tmpdir(), 'collabmd-git-seed-change-'));
  const localDir = await mkdtemp(join(tmpdir(), 'collabmd-git-local-change-'));
  const peerDir = await mkdtemp(join(tmpdir(), 'collabmd-git-peer-change-'));
  t.after(async () => {
    await rm(remoteDir, { force: true, recursive: true });
    await rm(seedDir, { force: true, recursive: true });
    await rm(localDir, { force: true, recursive: true });
    await rm(peerDir, { force: true, recursive: true });
  });

  await runGit(remoteDir, ['init', '--bare']);

  await runGit(seedDir, ['init']);
  await runGit(seedDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(seedDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(seedDir, 'tracked.md'), '# Seed\n', 'utf8');
  await runGit(seedDir, ['add', 'tracked.md']);
  await runGit(seedDir, ['commit', '-m', 'Initial commit']);
  await runGit(seedDir, ['remote', 'add', 'origin', remoteDir]);
  await runGit(seedDir, ['push', '-u', 'origin', 'HEAD']);

  await runGit(tmpdir(), ['clone', remoteDir, localDir]);
  await runGit(localDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(localDir, ['config', 'user.name', 'CollabMD Tests']);

  await runGit(tmpdir(), ['clone', remoteDir, peerDir]);
  await runGit(peerDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(peerDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(peerDir, 'tracked.md'), '# Seed\nupdated remotely\n', 'utf8');
  await writeFile(join(peerDir, 'new.md'), '# New\n', 'utf8');
  await runGit(peerDir, ['add', 'tracked.md', 'new.md']);
  await runGit(peerDir, ['commit', '-m', 'Remote update']);
  await runGit(peerDir, ['push']);

  const gitService = new GitService({ vaultDir: localDir });
  const pullResult = await gitService.pullBranch();

  assert.deepEqual(pullResult.workspaceChange.changedPaths.sort(), ['new.md', 'tracked.md']);
  assert.deepEqual(pullResult.workspaceChange.deletedPaths, []);
  assert.deepEqual(pullResult.workspaceChange.renamedPaths, []);
});

test('GitService pull uses autostash for non-overlapping dirty files without creating a backup', async (t) => {
  const { localDir, peerDir } = await createRemotePullFixture(t);

  await writeFile(join(localDir, 'tracked.md'), '# Seed\nlocal dirty change\n', 'utf8');
  await writeFile(join(peerDir, 'remote.md'), '# Remote\nnew file\n', 'utf8');
  await runGit(peerDir, ['add', 'remote.md']);
  await runGit(peerDir, ['commit', '-m', 'Remote update']);
  await runGit(peerDir, ['push']);

  const gitService = new GitService({ vaultDir: localDir });
  const pullResult = await gitService.pullBranch();

  assert.equal(pullResult.pullBackup, null);
  assert.equal(await readFile(join(localDir, 'tracked.md'), 'utf8'), '# Seed\nlocal dirty change\n');
  assert.equal(await readFile(join(localDir, 'remote.md'), 'utf8'), '# Remote\nnew file\n');
  assert.equal((await execFile('git', ['status', '--porcelain=v1'], { cwd: localDir })).stdout.trim(), 'M tracked.md');
});

test('GitService pull creates a backup bundle when tracked local edits overlap upstream changes', async (t) => {
  const { localDir, peerDir } = await createRemotePullFixture(t);

  await writeFile(join(peerDir, 'tracked.md'), '# Seed\nupdated remotely\n', 'utf8');
  await runGit(peerDir, ['add', 'tracked.md']);
  await runGit(peerDir, ['commit', '-m', 'Remote update']);
  await runGit(peerDir, ['push']);

  await writeFile(join(localDir, 'tracked.md'), '# Seed\nlocal overlap\n', 'utf8');

  const gitService = new GitService({ vaultDir: localDir });
  const pullResult = await gitService.pullBranch();
  const pullBackups = await gitService.listPullBackups();

  assert.equal(pullResult.pullBackup?.fileCount, 1);
  assert.equal(await readFile(join(localDir, 'tracked.md'), 'utf8'), '# Seed\nupdated remotely\n');
  assert.equal(
    await readFile(join(localDir, pullResult.pullBackup.summaryPath.replace('/summary.md', '/files/tracked.md')), 'utf8'),
    '# Seed\nlocal overlap\n',
  );
  assert.equal(
    await readFile(join(localDir, pullResult.pullBackup.summaryPath), 'utf8'),
    await readFile(join(localDir, pullBackups[0].summaryPath), 'utf8'),
  );
  assert.equal((await execFile('git', ['status', '--porcelain=v1'], { cwd: localDir })).stdout.trim(), '');
});

test('GitService pull backup preserves staged and unstaged patch artifacts for partially staged overlaps', async (t) => {
  const { localDir, peerDir } = await createRemotePullFixture(t);

  await writeFile(join(localDir, 'tracked.md'), '# Seed\nstaged only\n', 'utf8');
  await runGit(localDir, ['add', 'tracked.md']);
  await writeFile(join(localDir, 'tracked.md'), '# Seed\nstaged only\nunstaged only\n', 'utf8');

  await writeFile(join(peerDir, 'tracked.md'), '# Seed\nupdated remotely\n', 'utf8');
  await runGit(peerDir, ['add', 'tracked.md']);
  await runGit(peerDir, ['commit', '-m', 'Remote overlap']);
  await runGit(peerDir, ['push']);

  const gitService = new GitService({ vaultDir: localDir });
  const pullResult = await gitService.pullBranch();
  const backupRoot = join(localDir, pullResult.pullBackup.summaryPath.replace('/summary.md', ''));
  const stagedPatch = await readFile(join(backupRoot, 'patches/tracked.md.staged.patch'), 'utf8');
  const worktreePatch = await readFile(join(backupRoot, 'patches/tracked.md.worktree.patch'), 'utf8');
  const summary = await readFile(join(localDir, pullResult.pullBackup.summaryPath), 'utf8');

  assert.match(stagedPatch, /\+staged only/);
  assert.doesNotMatch(stagedPatch, /\+unstaged only/);
  assert.match(worktreePatch, /\+unstaged only/);
  assert.match(summary, /Staged patch:/);
  assert.match(summary, /Worktree patch:/);
});

test('GitService pull creates a backup bundle when an untracked local file overlaps a new upstream file', async (t) => {
  const { localDir, peerDir } = await createRemotePullFixture(t);

  await writeFile(join(peerDir, 'clash.md'), '# Remote\nincoming\n', 'utf8');
  await runGit(peerDir, ['add', 'clash.md']);
  await runGit(peerDir, ['commit', '-m', 'Add clash file']);
  await runGit(peerDir, ['push']);

  await writeFile(join(localDir, 'clash.md'), '# Local\nscratch\n', 'utf8');

  const gitService = new GitService({ vaultDir: localDir });
  const pullResult = await gitService.pullBranch();

  assert.equal(pullResult.pullBackup?.fileCount, 1);
  assert.equal(await readFile(join(localDir, 'clash.md'), 'utf8'), '# Remote\nincoming\n');
  assert.equal(
    await readFile(join(localDir, pullResult.pullBackup.summaryPath.replace('/summary.md', '/files/clash.md')), 'utf8'),
    '# Local\nscratch\n',
  );
  assert.equal((await execFile('git', ['status', '--porcelain=v1'], { cwd: localDir })).stdout.trim(), '');
});

test('GitService pull rejects diverged history before mutating the worktree', async (t) => {
  const { localDir, peerDir } = await createRemotePullFixture(t);

  await writeFile(join(localDir, 'tracked.md'), '# Seed\nlocal commit\n', 'utf8');
  await runGit(localDir, ['add', 'tracked.md']);
  await runGit(localDir, ['commit', '-m', 'Local commit']);

  await writeFile(join(peerDir, 'tracked.md'), '# Seed\nremote commit\n', 'utf8');
  await runGit(peerDir, ['add', 'tracked.md']);
  await runGit(peerDir, ['commit', '-m', 'Remote commit']);
  await runGit(peerDir, ['push']);

  const gitService = new GitService({ vaultDir: localDir });

  await assert.rejects(
    gitService.pullBranch(),
    (error) => error?.statusCode === 409 && error?.requestCode === 'pull_diverged_ff_only',
  );

  assert.equal(String((await execFile('git', ['log', '-1', '--pretty=%s'], { cwd: localDir })).stdout).trim(), 'Local commit');
  assert.deepEqual(await gitService.listPullBackups(), []);
});

test('GitService resets a file to the current branch content', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-local-reset-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'tracked.md'), '# Base\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  await writeFile(join(repoDir, 'tracked.md'), '# Local change\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);

  const gitService = new GitService({ vaultDir: repoDir });
  const resetResult = await gitService.resetFileToHead('tracked.md');

  const restored = await execFile('git', ['show', 'HEAD:tracked.md'], { cwd: repoDir });
  assert.equal((await execFile('git', ['status', '--porcelain=v1'], { cwd: repoDir })).stdout.trim(), '');
  assert.equal(String(restored.stdout), '# Base\n');
  assert.equal(resetResult.sourceRef, 'HEAD');
  assert.deepEqual(resetResult.workspaceChange.changedPaths, ['tracked.md']);
});

test('GitService reset deletes files that do not exist on the current branch HEAD', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-local-reset-delete-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'tracked.md'), '# Base\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  await writeFile(join(repoDir, 'local-only.md'), '# Remove me\n', 'utf8');
  await runGit(repoDir, ['add', 'local-only.md']);

  const gitService = new GitService({ vaultDir: repoDir });
  const resetResult = await gitService.resetFileToHead('local-only.md');

  await assert.rejects(stat(join(repoDir, 'local-only.md')));
  assert.deepEqual(resetResult.workspaceChange.deletedPaths, ['local-only.md']);
});

test('GitService lists current-branch history summaries without patch payloads', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-history-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'tracked.md'), '# One\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  await writeFile(join(repoDir, 'tracked.md'), '# Two\nupdated\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Second commit']);

  const gitService = new GitService({ vaultDir: repoDir });
  const history = await gitService.getHistory({ limit: 10, offset: 0 });

  assert.equal(history.isGitRepo, true);
  assert.equal(history.commits.length, 2);
  assert.equal(history.commits[0].subject, 'Second commit');
  assert.equal(history.commits[0].filesChanged, 1);
  assert.equal('hunks' in history.commits[0], false);
});

test('GitService returns file history entries that follow renames', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-file-history-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'before.md'), '# Before\nbase\n', 'utf8');
  await runGit(repoDir, ['add', 'before.md']);
  await runGit(repoDir, ['commit', '-m', 'Add before']);
  await runGit(repoDir, ['mv', 'before.md', 'after.md']);
  await writeFile(join(repoDir, 'after.md'), '# Before\nbase\nupdated\n', 'utf8');
  await runGit(repoDir, ['add', 'after.md']);
  await runGit(repoDir, ['commit', '-m', 'Rename file']);

  const gitService = new GitService({ vaultDir: repoDir });
  const history = await gitService.getFileHistory({ limit: 10, offset: 0, path: 'after.md' });

  assert.equal(history.isGitRepo, true);
  assert.equal(history.commits.length, 2);
  assert.equal(history.commits[0].status, 'renamed');
  assert.equal(history.commits[0].oldPath, 'before.md');
  assert.equal(history.commits[0].pathAtCommit, 'after.md');
  assert.equal(history.commits[1].pathAtCommit, 'before.md');
});

test('GitService returns root commit metadata and file-scoped commit diffs', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-commit-detail-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'tracked.md'), '# Root\n\nhello\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  const rootHash = await runGitOutput(repoDir, ['rev-parse', 'HEAD']);

  const gitService = new GitService({ vaultDir: repoDir });
  const metadata = await gitService.getCommit({ hash: rootHash, metaOnly: true });
  assert.equal(metadata.source, 'commit');
  assert.equal(metadata.commit.hash, rootHash);
  assert.equal(metadata.files.length, 1);
  assert.equal(metadata.files[0].path, 'tracked.md');
  assert.equal(Array.isArray(metadata.files[0].hunks), false);

  const detail = await gitService.getCommit({ hash: rootHash, path: 'tracked.md' });
  assert.equal(detail.files.length, 1);
  assert.equal(detail.files[0].path, 'tracked.md');
  assert.equal(detail.files[0].status, 'added');
  assert.equal(detail.files[0].hunks.length > 0, true);
});

test('GitService returns historical file snapshots for text vault files', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-file-snapshot-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);
  await writeFile(join(repoDir, 'tracked.md'), '# Root\n\nhello\n', 'utf8');
  await runGit(repoDir, ['add', 'tracked.md']);
  await runGit(repoDir, ['commit', '-m', 'Initial commit']);
  const rootHash = await runGitOutput(repoDir, ['rev-parse', 'HEAD']);

  const gitService = new GitService({ vaultDir: repoDir });
  const snapshot = await gitService.getFileSnapshot({ hash: rootHash, path: 'tracked.md' });

  assert.equal(snapshot.hash, rootHash);
  assert.equal(snapshot.path, 'tracked.md');
  assert.equal(snapshot.fileKind, 'markdown');
  assert.equal(snapshot.content, '# Root\n\nhello\n');

  await assert.rejects(
    gitService.getFileSnapshot({ hash: rootHash, path: 'missing.md' }),
    (error) => error?.statusCode === 404,
  );
});

test('GitService guards large commit file diffs and deduplicates repeated identical requests', async (t) => {
  const repoDir = await mkdtemp(join(tmpdir(), 'collabmd-git-commit-guarded-'));
  t.after(async () => {
    await rm(repoDir, { force: true, recursive: true });
  });

  await runGit(repoDir, ['init']);
  await runGit(repoDir, ['config', 'user.email', 'tests@example.com']);
  await runGit(repoDir, ['config', 'user.name', 'CollabMD Tests']);

  const largeContent = Array.from({ length: 120 }, (_, index) => `line ${index + 1}`).join('\n');
  await writeFile(join(repoDir, 'large.md'), `${largeContent}\n`, 'utf8');
  await runGit(repoDir, ['add', 'large.md']);
  await runGit(repoDir, ['commit', '-m', 'Add large file']);
  const headHash = await runGitOutput(repoDir, ['rev-parse', 'HEAD']);

  const counter = createCountingExecFileImpl();
  const gitService = new GitService({
    execFileImpl: counter.execFileImpl,
    maxInitialPatchLines: 20,
    vaultDir: repoDir,
  });

  const [first, second] = await Promise.all([
    gitService.getCommit({ hash: headHash, path: 'large.md' }),
    gitService.getCommit({ hash: headHash, path: 'large.md' }),
  ]);

  assert.equal(first.files[0].tooLarge, true);
  assert.equal(first.files[0].canLoadFullPatch, true);
  assert.deepEqual(first, second);
  assert.equal(counter.calls.some((args) => args.includes(headHash)), true);
});

test('GitService passes configured command env to subprocesses', async () => {
  const repoDir = await createFixtureRepository();
  const observedEnvs = [];
  const gitService = new GitService({
    commandEnv: {
      COLLABMD_TEST_GIT_ENV: 'expected-value',
    },
    execFileImpl: async (...args) => {
      const options = args[2] ?? {};
      observedEnvs.push(options.env);
      return execFile(...args);
    },
    vaultDir: repoDir,
  });

  try {
    await gitService.getStatus({ force: true });
  } finally {
    await rm(repoDir, { force: true, recursive: true });
  }

  assert.equal(observedEnvs.length > 0, true);
  assert.equal(
    observedEnvs.every((env) => env?.COLLABMD_TEST_GIT_ENV === 'expected-value'),
    true,
  );
});
