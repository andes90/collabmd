import test from 'node:test';
import assert from 'node:assert/strict';

import { gitFeature } from '../../src/client/application/app-shell/git-feature.js';

function createContext(overrides = {}) {
  const events = [];
  const gitOperationStatus = {
    _text: '',
    _hidden: true,
    classList: {
      toggle(name, force) {
        if (name === 'hidden') {
          gitOperationStatus._hidden = Boolean(force);
        }
      },
    },
    set textContent(value) {
      gitOperationStatus._text = value;
    },
    get textContent() {
      return gitOperationStatus._text;
    },
  };
  const context = {
    ...gitFeature,
    currentFilePath: 'README.md',
    elements: {
      gitOperationStatus,
    },
    fileExplorer: {
      async refresh() {
        events.push(['refresh-explorer']);
      },
    },
    getDisplayName(filePath) {
      return filePath.replace(/\.md$/u, '');
    },
    gitPanel: {
      async refresh() {
        events.push(['refresh-git-panel']);
      },
    },
    isTabActive: true,
    lobby: {
      sendWorkspaceEvent(payload) {
        events.push(['workspace-event', payload]);
      },
    },
    navigation: {
      getHashRoute() {
        return { scope: 'all', type: 'empty' };
      },
      navigateToGitCommit(payload) {
        events.push(['navigate-commit', payload]);
      },
      navigateToFile(filePath) {
        events.push(['navigate-file', filePath]);
      },
      navigateToGitDiff(payload) {
        events.push(['navigate-diff', payload]);
      },
      navigateToGitFileHistory(payload) {
        events.push(['navigate-file-history', payload]);
      },
      navigateToGitFilePreview(payload) {
        events.push(['navigate-file-preview', payload]);
      },
      navigateToGitHistory() {
        events.push(['navigate-history']);
      },
    },
    showGitDiff: async () => {
      events.push(['show-git-diff']);
    },
    toastController: {
      show(message) {
        events.push(['toast', message]);
      },
    },
    ...overrides,
  };

  return { context, events, gitOperationStatus };
}

function installWindowStub(t) {
  const previousWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: {},
    location: {
      host: 'localhost',
      origin: 'http://localhost',
      protocol: 'http:',
      search: '',
    },
  };
  t.after(() => {
    globalThis.window = previousWindow;
  });
}

test('gitFeature finalizes git actions by refreshing locally without publishing a lobby workspace event', async () => {
  const { context, events } = createContext();

  await gitFeature.finalizeGitAction.call(context, {
    action: 'stage',
    preferredScope: 'staged',
    result: {
      workspaceChange: {
        changedPaths: [],
        deletedPaths: [],
        refreshExplorer: true,
        renamedPaths: [],
      },
    },
  });

  assert.deepEqual(events, [
    ['refresh-explorer'],
    ['refresh-git-panel'],
  ]);
});

test('gitFeature closes the current file when an incoming workspace event deletes it', async () => {
  const { context, events } = createContext();

  await gitFeature.handleIncomingWorkspaceEvent.call(context, {
    action: 'pull',
    origin: 'git',
    workspaceChange: {
      changedPaths: [],
      deletedPaths: ['README.md'],
      refreshExplorer: true,
      renamedPaths: [],
    },
  });

  assert.deepEqual(events, [
    ['refresh-git-panel'],
    ['navigate-file', null],
    ['toast', 'README was removed after a pull operation'],
  ]);
});

test('gitFeature follows the renamed current file for incoming workspace events', async () => {
  const { context, events } = createContext();

  await gitFeature.handleIncomingWorkspaceEvent.call(context, {
    action: 'filesystem-sync',
    origin: 'filesystem',
    workspaceChange: {
      changedPaths: [],
      deletedPaths: [],
      refreshExplorer: true,
      renamedPaths: [{ oldPath: 'README.md', newPath: 'docs/README.md' }],
    },
  });

  assert.deepEqual(events, [
    ['navigate-file', 'docs/README.md'],
    ['toast', 'README moved on disk'],
  ]);
});

test('gitFeature highlights single-file filesystem updates for the current file instead of showing a toast', async () => {
  const flashCalls = [];
  const { context, events } = createContext({
    session: {
      flashExternalUpdate(range) {
        flashCalls.push(range);
        return true;
      },
    },
  });

  await gitFeature.handleIncomingWorkspaceEvent.call(context, {
    action: 'filesystem-sync',
    highlightRanges: [{ path: 'README.md', from: 2, to: 8 }],
    origin: 'filesystem',
    workspaceChange: {
      changedPaths: ['README.md'],
      deletedPaths: [],
      refreshExplorer: true,
      renamedPaths: [],
    },
  });

  assert.deepEqual(flashCalls, [{ path: 'README.md', from: 2, to: 8 }]);
  assert.deepEqual(events, []);
});

test('gitFeature keeps the toast fallback for multi-file filesystem updates', async () => {
  const flashCalls = [];
  const { context, events } = createContext({
    session: {
      flashExternalUpdate(range) {
        flashCalls.push(range);
        return true;
      },
    },
  });

  await gitFeature.handleIncomingWorkspaceEvent.call(context, {
    action: 'filesystem-sync',
    highlightRanges: [{ path: 'README.md', from: 2, to: 8 }],
    origin: 'filesystem',
    workspaceChange: {
      changedPaths: ['README.md', 'docs/guide.md'],
      deletedPaths: [],
      refreshExplorer: true,
      renamedPaths: [],
    },
  });

  assert.deepEqual(flashCalls, []);
  assert.deepEqual(events, [['toast', 'README updated from disk']]);
});

test('gitFeature falls back to a toast when a filesystem update cannot be highlighted', async () => {
  const flashCalls = [];
  const { context, events } = createContext({
    session: {
      flashExternalUpdate(range) {
        flashCalls.push(range);
        return false;
      },
    },
  });

  await gitFeature.handleIncomingWorkspaceEvent.call(context, {
    action: 'filesystem-sync',
    highlightRanges: [{ path: 'README.md', from: 2, to: 8 }],
    origin: 'filesystem',
    workspaceChange: {
      changedPaths: ['README.md'],
      deletedPaths: [],
      refreshExplorer: true,
      renamedPaths: [],
    },
  });

  assert.deepEqual(flashCalls, [{ path: 'README.md', from: 2, to: 8 }]);
  assert.deepEqual(events, [['toast', 'README updated from disk']]);
});

test('gitFeature shows and clears the shared git operation status around a long-running action', async () => {
  const states = [];
  const { context, gitOperationStatus } = createContext();

  await gitFeature.runGitActionWithStatus.call(context, 'Resetting file...', async () => {
    states.push([gitOperationStatus.textContent, gitOperationStatus._hidden]);
  });

  states.push([gitOperationStatus.textContent, gitOperationStatus._hidden]);

  assert.deepEqual(states, [
    ['Resetting file...', false],
    ['', true],
  ]);
});

test('gitFeature shows a pull backup toast after a successful overlap backup pull', async (t) => {
  installWindowStub(t);
  const { context, events } = createContext({
    finalizeGitAction: async ({ action, result }) => {
      events.push(['finalize', action, result.pullBackup?.fileCount ?? 0]);
    },
    postGitAction: async () => ({
      pullBackup: {
        fileCount: 2,
      },
      workspaceChange: {
        changedPaths: [],
        deletedPaths: [],
        refreshExplorer: true,
        renamedPaths: [],
      },
    }),
  });

  await gitFeature.pullGitBranch.call(context);

  assert.deepEqual(events, [
    ['finalize', 'pull', 2],
    ['toast', 'Pulled latest changes. 2 overlapping local files were backed up.'],
  ]);
});

test('gitFeature shows a specific toast when pull fails because fast-forward is not possible', async (t) => {
  installWindowStub(t);
  const { context, events } = createContext({
    postGitAction: async () => {
      const error = new Error('ff only');
      error.code = 'pull_diverged_ff_only';
      throw error;
    },
  });

  await gitFeature.pullGitBranch.call(context);

  assert.deepEqual(events, [
    ['toast', 'Cannot pull because local and remote commits have diverged. Fast-forward only pull is not possible.'],
  ]);
});

test('gitFeature opens history preview against the current workspace file when the commit path is historical', async (t) => {
  installWindowStub(t);
  const fetchCalls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    fetchCalls.push(String(url));
    return {
      ok: true,
      async json() {
        return {
          content: '# Historical snapshot',
          fileKind: 'markdown',
          hash: 'abc1234',
          path: 'docs/old-name.md',
        };
      },
    };
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });

  const previewDocuments = [];
  const { context, events } = createContext({
    commentUi: {
      attachSession(value) {
        events.push(['attach-session', value]);
      },
      setCurrentFile(filePath, options) {
        events.push(['comment-file', filePath, options.fileKind, options.supported]);
      },
    },
    getCommentFileKind(filePath) {
      return filePath.endsWith('.md') ? 'markdown' : 'unknown';
    },
    handleCommentSelectionChange(value) {
      events.push(['comment-selection', value]);
    },
    handleCommentThreadsChange(threads) {
      events.push(['comment-threads', threads.length]);
    },
    layoutController: {
      setView(view, options) {
        events.push(['layout-view', view, options.persist]);
      },
    },
    previewRenderer: {
      beginDocumentLoad() {
        events.push(['preview-load']);
      },
      queueRender() {
        events.push(['preview-render']);
      },
    },
    resetPreviewMode() {
      events.push(['reset-preview']);
    },
    setStaticPreviewDocument(document) {
      previewDocuments.push(document);
    },
    supportsFileHistory() {
      return true;
    },
    syncMainChrome({ badgeLabel, mode, title }) {
      events.push(['main-chrome', badgeLabel, mode, title]);
    },
    syncFileHistoryButton({ filePath, mode }) {
      events.push(['history-button', filePath, mode]);
    },
    workspaceRouteController: {
      showEmptyState() {
        events.push(['show-empty']);
      },
      showPreviewOnlyState(filePath) {
        events.push(['preview-only', filePath]);
      },
    },
  });

  await gitFeature.showGitFilePreview.call(context, {
    hash: 'abc1234',
    filePath: 'docs/old-name.md',
    currentFilePath: 'docs/current-name.md',
  });

  assert.deepEqual(fetchCalls, ['/api/git/file-snapshot?hash=abc1234&path=docs%2Fold-name.md']);
  assert.deepEqual(previewDocuments, [{
    content: '# Historical snapshot',
    currentFilePath: 'docs/current-name.md',
    fileKind: 'markdown',
    hash: 'abc1234',
    path: 'docs/old-name.md',
  }]);
  assert.ok(events.some((event) => (
    event[0] === 'preview-only'
    && event[1] === 'docs/current-name.md'
  )));
  assert.ok(events.some((event) => (
    event[0] === 'history-button'
    && event[1] === 'docs/current-name.md'
    && event[2] === 'history-preview'
  )));
});
