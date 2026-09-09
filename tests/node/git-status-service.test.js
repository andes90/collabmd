import test from 'node:test';
import assert from 'node:assert/strict';

import { GitStatusService } from '../../src/server/infrastructure/git/status-service.js';
import { GitDiffService } from '../../src/server/infrastructure/git/diff-service.js';

function createDeferredDiff() {
  let resolveDiff = null;
  let diffResolved = false;
  const state = {
    diffPendingWhenCounted: false,
    get diffResolved() {
      return diffResolved;
    },
    resolveDiff() {
      diffResolved = true;
      resolveDiff?.();
    },
  };
  const commandRunner = {
    async isGitRepo() {
      return true;
    },
    execGit() {
      return new Promise((resolve) => {
        resolveDiff = () => resolve('');
      });
    },
  };
  const untrackedFileService = {
    async countAdditions() {
      state.diffPendingWhenCounted = !diffResolved;
      return 0;
    },
  };
  return { commandRunner, state, untrackedFileService };
}

test('GitStatusService overlaps the diff spawn with the untracked scan', async () => {
  const { commandRunner, state, untrackedFileService } = createDeferredDiff();
  const service = new GitStatusService({ commandRunner, untrackedFileService });

  const summaryPromise = service.getLocalChangeSummary({
    hasHeadCommit: true,
    untrackedFiles: [{ path: 'new.md' }],
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  state.resolveDiff();

  assert.deepEqual(await summaryPromise, { additions: 0, deletions: 0 });
  assert.equal(state.diffPendingWhenCounted, true);
});

test('GitDiffService overlaps the diff spawn with the untracked scan', async () => {
  const { commandRunner, state, untrackedFileService } = createDeferredDiff();
  const service = new GitDiffService({ commandRunner, untrackedFileService });

  const summaryPromise = service.getScopeSummary({
    files: [
      { path: 'tracked.md', status: 'modified' },
      { path: 'new.md', status: 'untracked' },
    ],
    hasHeadCommit: true,
  });
  await new Promise((resolve) => setTimeout(resolve, 10));
  state.resolveDiff();

  assert.deepEqual(await summaryPromise, { additions: 0, deletions: 0, filesChanged: 2 });
  assert.equal(state.diffPendingWhenCounted, true);
});
