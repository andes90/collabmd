import test from 'node:test';
import assert from 'node:assert/strict';

import { GitPanelController } from '../../src/client/presentation/git-panel-controller.js';

class FakeElement {
  constructor(attributes = {}, closestMap = {}) {
    this.attributes = attributes;
    this.closestMap = closestMap;
  }

  closest(selector) {
    return this.closestMap[selector] ?? null;
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }
}

function createPanelHarness() {
  const listeners = new Map();
  const panel = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    innerHTML: '',
  };

  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  globalThis.document = {
    getElementById(id) {
      return id === 'gitPanel' ? panel : null;
    },
  };
  globalThis.Element = FakeElement;

  return {
    panel,
    restore() {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
    },
    triggerClick(target) {
      const handler = listeners.get('click');
      handler?.({
        preventDefault() {},
        stopPropagation() {},
        target,
      });
    },
  };
}

test('GitPanelController announces initial loading and uses normalized action copy', (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const controller = new GitPanelController();
  controller.render();

  assert.match(harness.panel.innerHTML, /role="status" aria-live="polite"/u);
  assert.match(harness.panel.innerHTML, /Loading git status…/u);

  controller.status = {
    sections: [{ files: [{ path: 'README.md' }], key: 'unstaged', label: 'Changes' }],
    summary: { changedFiles: 1, staged: 1 },
  };
  controller.pendingActionKey = 'commit-staged';
  const changesMarkup = controller.renderChangesPanel();
  assert.match(changesMarkup, /View full diff/u);
  assert.match(changesMarkup, /Working…/u);

  controller.history = {
    commits: [{ hash: 'abc', shortHash: 'abc', subject: 'Existing commit' }],
    hasMore: true,
    loaded: true,
    loading: false,
    loadingMore: false,
  };
  assert.match(controller.renderHistoryPanel(), /Load more/u);
  controller.history.loadingMore = true;
  assert.match(controller.renderHistoryPanel(), /Loading…/u);
});

test('GitPanelController renders a successful Git status response', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const onRepoChange = [];
  const status = {
    branch: { name: 'main' },
    isGitRepo: true,
    sections: [],
    summary: { changedFiles: 0 },
  };
  const controller = new GitPanelController({
    gitApiClient: {
      readPullBackups: async () => ({ backups: [] }),
      readStatus: async () => status,
    },
    onRepoChange: (...args) => onRepoChange.push(args),
  });

  assert.equal(await controller.refreshStatus(), status);
  assert.equal(controller.statusError, '');
  assert.deepEqual(onRepoChange, [[true, status]]);
  assert.match(harness.panel.innerHTML, /main/u);
});

test('GitPanelController keeps non-Git vault copy distinct', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const status = { isGitRepo: false, sections: [], summary: { changedFiles: 0 } };
  const controller = new GitPanelController({
    gitApiClient: { readStatus: async () => status },
  });

  await controller.refreshStatus();

  assert.match(harness.panel.innerHTML, /Git is unavailable for this vault\./u);
  assert.doesNotMatch(harness.panel.innerHTML, /role="alert"/u);
});

test('GitPanelController renders transient status failures as alerts without reporting a non-Git vault', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const previousConsoleError = console.error;
  console.error = () => {};
  t.after(() => { console.error = previousConsoleError; });
  const repoChanges = [];
  const controller = new GitPanelController({
    gitApiClient: { readStatus: async () => { throw new Error('offline'); } },
    onRepoChange: (...args) => repoChanges.push(args),
  });
  const previousStatus = { isGitRepo: true, sections: [], summary: { changedFiles: 0 } };
  controller.status = previousStatus;

  assert.equal(await controller.refreshStatus(), null);
  assert.equal(controller.status, previousStatus);
  assert.deepEqual(repoChanges, []);
  assert.match(harness.panel.innerHTML, /role="alert"/u);
  assert.match(harness.panel.innerHTML, /Failed to load Git status\. Try again\./u);
  assert.doesNotMatch(harness.panel.innerHTML, /Git is unavailable for this vault\./u);
});

test('GitPanelController keeps the status alert rendered when history refresh starts with a status failure', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const previousConsoleError = console.error;
  console.error = () => {};
  t.after(() => { console.error = previousConsoleError; });
  const controller = new GitPanelController({
    gitApiClient: { readStatus: async () => { throw new Error('offline'); } },
  });
  controller.panelMode = 'history';

  assert.equal(await controller.refresh(), null);
  assert.match(harness.panel.innerHTML, /role="alert"/u);
  assert.match(harness.panel.innerHTML, /Failed to load Git status\. Try again\./u);
});

test('GitPanelController distinguishes an empty filter from no local changes', (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const controller = new GitPanelController();
  controller.searchQuery = 'missing';
  controller.status = {
    sections: [{ files: [{ path: 'README.md' }], key: 'unstaged', label: 'Changes' }],
    summary: { changedFiles: 1, staged: 0 },
  };

  assert.match(controller.renderChangesPanel(), /No changes match your filter\./u);
});

test('GitPanelController renders pull backups and opens the summary when selected', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());

  const openedPaths = [];
  const controller = new GitPanelController({
    onOpenPullBackup: (filePath) => {
      openedPaths.push(filePath);
    },
  });
  controller.initialize();
  controller.status = {
    branch: {
      ahead: 0,
      behind: 0,
      name: 'master',
      upstream: 'origin/master',
    },
    isGitRepo: true,
    sections: [],
    summary: {
      changedFiles: 0,
      staged: 0,
    },
  };
  controller.pullBackups = [{
    branch: 'master',
    createdAt: '2026-03-17T10:00:00.000Z',
    fileCount: 2,
    id: '20260317-100000-abc1234',
    summaryPath: '.collabmd/pull-backups/20260317-100000-abc1234/summary.md',
  }];

  controller.render();

  assert.match(harness.panel.innerHTML, /Pull Backups/);
  assert.match(harness.panel.innerHTML, /20260317-100000-abc1234/);

  const backupButton = new FakeElement({
    'data-git-pull-backup-id': '20260317-100000-abc1234',
  }, {
    '[data-git-pull-backup-id]': new FakeElement({
      'data-git-pull-backup-id': '20260317-100000-abc1234',
    }),
  });
  harness.triggerClick(backupButton);

  assert.deepEqual(openedPaths, ['20260317-100000-abc1234']);
});

test('GitPanelController renders history rows and selects commits in history mode', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());

  const selectedCommits = [];
  const controller = new GitPanelController({
    onSelectCommit: (hash) => {
      selectedCommits.push(hash);
    },
  });
  controller.initialize();
  controller.status = {
    branch: {
      ahead: 0,
      behind: 0,
      name: 'main',
      upstream: 'origin/main',
    },
    isGitRepo: true,
    sections: [],
    summary: {
      additions: 0,
      changedFiles: 0,
      deletions: 0,
      staged: 0,
    },
  };
  controller.panelMode = 'history';
  controller.history = {
    commits: [{
      additions: 12,
      authorName: 'CollabMD Tests',
      deletions: 3,
      filesChanged: 2,
      hash: 'abc123456789',
      isMergeCommit: false,
      relativeDateLabel: '2h ago',
      shortHash: 'abc1234',
      subject: 'Add git history',
    }],
    error: '',
    hasMore: false,
    loaded: true,
    loading: false,
    loadingMore: false,
    offset: 1,
  };

  controller.render();

  assert.match(harness.panel.innerHTML, /History/);
  assert.match(harness.panel.innerHTML, /Add git history/);
  assert.match(harness.panel.innerHTML, /abc1234/);

  const commitButton = new FakeElement({
    'data-git-commit-hash': 'abc123456789',
  }, {
    '[data-git-commit-hash]': new FakeElement({
      'data-git-commit-hash': 'abc123456789',
    }),
  });
  harness.triggerClick(commitButton);

  assert.deepEqual(selectedCommits, ['abc123456789']);
});

test('GitPanelController uses plain-language commit inclusion labels', (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());
  const controller = new GitPanelController();
  controller.status = {
    sections: [{
      files: [{ code: 'M', path: 'README.md', scope: 'staged', status: 'modified' }],
      key: 'staged',
      label: 'Staged Changes',
    }],
    summary: { changedFiles: 1, staged: 1 },
  };

  const markup = controller.renderChangesPanel();

  assert.match(markup, /Included in Next Commit/u);
  assert.match(markup, /Remove from commit/u);
  assert.match(markup, /Commit 1 file/u);
});

test('GitPanelController renders and handles bulk staging actions', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());

  const actions = [];
  const controller = new GitPanelController({
    onStageAll: () => actions.push('stage-all'),
    onUnstageAll: () => actions.push('unstage-all'),
  });
  controller.initialize();
  controller.status = {
    branch: { name: 'main' },
    isGitRepo: true,
    sections: [],
    summary: { changedFiles: 3, staged: 1, untracked: 1, workingTree: 1 },
  };
  controller.render();

  assert.match(harness.panel.innerHTML, /Include all changes/u);
  assert.match(harness.panel.innerHTML, /Remove all from commit/u);

  for (const action of ['stage-all', 'unstage-all']) {
    const button = new FakeElement({ 'data-git-bulk-action': action });
    harness.triggerClick(new FakeElement({}, { '[data-git-bulk-action]': button }));
    await Promise.resolve();
  }

  assert.deepEqual(actions, ['stage-all', 'unstage-all']);
});

test('GitPanelController exposes the full file path as a hover title for trimmed file rows', async (t) => {
  const harness = createPanelHarness();
  t.after(() => harness.restore());

  const controller = new GitPanelController();
  controller.initialize();
  controller.status = {
    branch: {
      ahead: 0,
      behind: 0,
      name: 'main',
      upstream: 'origin/main',
    },
    isGitRepo: true,
    sections: [{
      files: [{
        code: 'M',
        path: 'Gold/Release Notes/release-process.md',
        scope: 'unstaged',
        status: 'modified',
      }],
      key: 'unstaged',
      title: 'Changes',
    }],
    summary: {
      additions: 0,
      changedFiles: 1,
      deletions: 0,
      staged: 0,
    },
  };

  controller.render();

  assert.match(
    harness.panel.innerHTML,
    /title="Gold\/Release Notes\/release-process\.md"/,
  );
});
