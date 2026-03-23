import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspaceRouteController } from '../../src/client/application/workspace-route-controller.js';

function createClassListRecorder() {
  const events = [];
  return {
    events,
    add(token) {
      events.push(['add', token]);
    },
    remove(token) {
      events.push(['remove', token]);
    },
  };
}

function createController(overrides = {}) {
  const events = [];
  let sessionLoadToken = overrides.sessionLoadToken ?? 0;
  let currentFilePath = overrides.currentFilePath ?? 'README.md';
  let session = overrides.session ?? { id: 'session-1' };
  const previewContent = {
    dataset: {},
    innerHTML: 'stale',
  };

  const controller = new WorkspaceRouteController({
    backlinksPanel: { clear: () => events.push(['backlinks-clear']) },
    clearInitialFileBootstrap: () => events.push(['clear-bootstrap']),
    closeSidebarOnMobile: () => events.push(['close-sidebar']),
    elements: {
      activeFileName: { textContent: '' },
      diffPage: { classList: createClassListRecorder() },
      editorPage: { classList: createClassListRecorder() },
      emptyState: { classList: createClassListRecorder() },
      markdownToolbar: { classList: createClassListRecorder() },
      outlineToggle: { classList: createClassListRecorder() },
      previewContent,
    },
    excalidrawEmbed: {
      setHydrationPaused: (value) => events.push(['embed-hydration', value]),
    },
    fileExplorer: {
      setActiveFile: (filePath) => events.push(['explorer-active', filePath]),
    },
    getIsTabActive: () => overrides.isTabActive ?? true,
    getSessionLoadToken: () => sessionLoadToken,
    gitDiffView: {
      hide: () => events.push(['diff-hide']),
    },
    gitPanel: {
      setSelection: () => events.push(['git-selection']),
    },
    imageLightbox: {
      close: () => events.push(['lightbox-close']),
    },
    layoutController: {
      reset: () => events.push(['layout-reset']),
    },
    lobby: {
      setCurrentFile: (filePath) => events.push(['lobby-file', filePath]),
    },
    navigation: overrides.navigation ?? {
      getHashRoute: () => ({ filePath: 'README.md', type: 'file' }),
      navigateToFile: (filePath) => events.push(['navigate', filePath]),
    },
    previewRenderer: {
      setHydrationPaused: (value) => events.push(['preview-hydration', value]),
    },
    renderAvatars: () => events.push(['render-avatars']),
    renderPresence: () => events.push(['render-presence']),
    resetPreviewMode: () => events.push(['reset-preview']),
    scrollSyncController: {
      invalidatePreviewBlocks: () => events.push(['invalidate-preview']),
      setLargeDocumentMode: (value) => events.push(['large-doc', value]),
    },
    setCurrentFilePath: (value) => {
      currentFilePath = value;
      events.push(['current-file', value]);
    },
    setSession: (value) => {
      session = value;
      events.push(['session', value ? value.id : null]);
    },
    setSessionLoadToken: (value) => {
      sessionLoadToken = value;
      events.push(['session-token', value]);
    },
    setSidebarTab: (value) => events.push(['sidebar-tab', value]),
    showGitCommit: async (route) => {
      events.push(['show-git-commit', route.hash ?? null, route.path ?? null, route.historyFilePath ?? null]);
    },
    showGitDiff: async (route) => {
      events.push(['show-git-diff', route.scope ?? 'all', route.filePath ?? null]);
    },
    showGitFileHistory: async (route) => {
      events.push(['show-git-file-history', route.filePath ?? null]);
    },
    showGitFilePreview: async (route) => {
      events.push(['show-git-file-preview', route.hash ?? null, route.filePath ?? null, route.currentFilePath ?? null]);
    },
    showGitHistory: async () => {
      events.push(['show-git-history']);
    },
    syncMainChrome: ({ mode, title = null }) => events.push(['main-chrome', mode, title]),
    workspaceCoordinator: {
      cleanupSession: () => events.push(['cleanup-session']),
      getSession: () => ({ id: 'session-2' }),
      openFile: async (filePath) => events.push(['open-file', filePath]),
    },
    ...overrides,
  });

  return {
    controller,
    currentFilePath: () => currentFilePath,
    events,
    previewContent,
    session: () => session,
    sessionLoadToken: () => sessionLoadToken,
  };
}

test('WorkspaceRouteController routes hash changes to empty, git diff, git file history, git file preview, git history, git commit, and file views', async () => {
  const empty = createController({
    navigation: {
      getHashRoute: () => ({ type: 'empty' }),
      navigateToFile() {},
    },
  });
  await empty.controller.handleHashChange();
  assert.deepEqual(empty.events.slice(0, 3), [
    ['git-selection'],
    ['diff-hide'],
    ['cleanup-session'],
  ]);

  const gitDiff = createController({
    navigation: {
      getHashRoute: () => ({ filePath: 'README.md', scope: 'working-tree', type: 'git-diff' }),
      navigateToFile() {},
    },
  });
  await gitDiff.controller.handleHashChange();
  assert.deepEqual(gitDiff.events, [
    ['sidebar-tab', 'git'],
    ['show-git-diff', 'working-tree', 'README.md'],
  ]);

  const gitHistory = createController({
    navigation: {
      getHashRoute: () => ({ type: 'git-history' }),
      navigateToFile() {},
    },
  });
  await gitHistory.controller.handleHashChange();
  assert.deepEqual(gitHistory.events, [
    ['sidebar-tab', 'git'],
    ['show-git-history'],
  ]);

  const gitFileHistory = createController({
    navigation: {
      getHashRoute: () => ({ filePath: 'README.md', type: 'git-file-history' }),
      navigateToFile() {},
    },
  });
  await gitFileHistory.controller.handleHashChange();
  assert.deepEqual(gitFileHistory.events, [
    ['sidebar-tab', 'files'],
    ['show-git-file-history', 'README.md'],
  ]);

  const gitFilePreview = createController({
    navigation: {
      getHashRoute: () => ({
        currentFilePath: 'docs/README.md',
        filePath: 'README.md',
        hash: 'abc1234',
        type: 'git-file-preview',
      }),
      navigateToFile() {},
    },
  });
  await gitFilePreview.controller.handleHashChange();
  assert.deepEqual(gitFilePreview.events, [
    ['sidebar-tab', 'files'],
    ['show-git-file-preview', 'abc1234', 'README.md', 'docs/README.md'],
  ]);

  const gitCommit = createController({
    navigation: {
      getHashRoute: () => ({
        hash: 'abc1234',
        historyFilePath: 'docs/README.md',
        path: 'README.md',
        type: 'git-commit',
      }),
      navigateToFile() {},
    },
  });
  await gitCommit.controller.handleHashChange();
  assert.deepEqual(gitCommit.events, [
    ['sidebar-tab', 'git'],
    ['show-git-commit', 'abc1234', 'README.md', 'docs/README.md'],
  ]);

  const file = createController({
    navigation: {
      getHashRoute: () => ({ filePath: 'notes/today.md', type: 'file' }),
      navigateToFile() {},
    },
  });
  await file.controller.handleHashChange();
  assert.deepEqual(file.events, [
    ['sidebar-tab', 'files'],
    ['lightbox-close'],
    ['git-selection'],
    ['diff-hide'],
    ['main-chrome', 'editor', null],
    ['open-file', 'notes/today.md'],
    ['session', 'session-2'],
  ]);
});

test('WorkspaceRouteController resets editor state when showing the empty workspace', () => {
  const { controller, currentFilePath, events, previewContent, session, sessionLoadToken } = createController();

  controller.showEmptyState();

  assert.equal(session(), null);
  assert.equal(sessionLoadToken(), 1);
  assert.equal(currentFilePath(), null);
  assert.equal(previewContent.innerHTML, '');
  assert.equal(previewContent.dataset.renderPhase, 'ready');
  assert.equal(events.includes(['current-file', null]), false);
  assert.deepEqual(events.filter(([type]) => type === 'current-file'), [['current-file', null]]);
  assert.ok(events.some(([type]) => type === 'lightbox-close'));
});

test('WorkspaceRouteController resets into diff mode and keeps navigation helpers simple', () => {
  const { controller, events, previewContent, session, sessionLoadToken } = createController();

  controller.showDiffState();
  controller.handleFileSelection('README.md', { closeSidebarOnMobile: true });

  assert.equal(session(), null);
  assert.equal(sessionLoadToken(), 1);
  assert.equal(previewContent.innerHTML, '');
  assert.equal(previewContent.dataset.renderPhase, 'ready');
  assert.ok(events.some(([type]) => type === 'lightbox-close'));
  assert.deepEqual(events.slice(-2), [
    ['close-sidebar'],
    ['navigate', 'README.md'],
  ]);
});
