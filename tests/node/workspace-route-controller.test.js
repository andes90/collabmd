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
      revealFile: (filePath, options) => events.push(['explorer-reveal', filePath, options ?? null]),
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
    setSidebarVisibility: (value) => events.push(['sidebar-visibility', value]),
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

  const preservedFile = createController({
    navigation: {
      getHashRoute: () => ({ filePath: 'notes/from-comments.md', type: 'file' }),
      navigateToFile() {},
    },
  });
  preservedFile.controller.preserveSidebarTabForNextFileRoute('notes/from-comments.md');
  await preservedFile.controller.handleHashChange();
  assert.deepEqual(preservedFile.events, [
    ['lightbox-close'],
    ['git-selection'],
    ['diff-hide'],
    ['main-chrome', 'editor', null],
    ['open-file', 'notes/from-comments.md'],
    ['session', 'session-2'],
  ]);
});

test('WorkspaceRouteController focuses an Excalidraw element route after opening its file', async () => {
  const calls = [];
  const fixture = createController({
    excalidrawEmbed: {
      openElement: (...args) => calls.push(args),
      setHydrationPaused() {},
    },
    navigation: {
      getHashRoute: () => ({
        elementId: 'node-42',
        elementType: 'group',
        filePath: 'diagrams/architecture.excalidraw',
        type: 'file',
      }),
      navigateToFile() {},
    },
  });

  await fixture.controller.handleHashChange();

  assert.deepEqual(calls, [[
    'diagrams/architecture.excalidraw',
    'node-42',
    'group',
  ]]);
});

test('WorkspaceRouteController keeps the active Excalidraw route when reconnecting navigation is declined', async () => {
  const events = [];
  const fixture = createController({
    excalidrawEmbed: {
      async prepareFileDisconnect(filePath, options) {
        events.push(['prepare-disconnect', filePath, options.timeoutMs]);
        return false;
      },
      setHydrationPaused() {},
    },
    navigation: {
      getHashRoute: () => ({ filePath: 'next.md', type: 'file' }),
      navigateToFile: (filePath) => events.push(['navigate', filePath]),
    },
    workspaceCoordinator: {
      cleanupSession() {},
      getSession: () => null,
      isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
      openFile: async (filePath) => events.push(['open-file', filePath]),
      stateStore: {
        get: (key) => (key === 'currentFilePath' ? 'active.excalidraw' : null),
      },
    },
  });

  await fixture.controller.handleHashChange();

  assert.deepEqual(events, [
    ['prepare-disconnect', 'active.excalidraw', 10000],
    ['navigate', 'active.excalidraw'],
  ]);
});

test('WorkspaceRouteController guards non-file routes before leaving an active Excalidraw room', async () => {
  const events = [];
  const fixture = createController({
    excalidrawEmbed: {
      async prepareFileDisconnect(filePath) {
        events.push(['prepare-disconnect', filePath]);
        return false;
      },
      setHydrationPaused() {},
    },
    navigation: {
      getHashRoute: () => ({ type: 'git-history' }),
      navigateToFile: (filePath) => events.push(['navigate', filePath]),
    },
    workspaceCoordinator: {
      cleanupSession() {},
      getSession: () => null,
      isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
      openFile() {},
      stateStore: {
        get: (key) => (key === 'currentFilePath' ? 'active.excalidraw' : null),
      },
    },
  });

  await fixture.controller.handleHashChange();

  assert.deepEqual(events, [
    ['prepare-disconnect', 'active.excalidraw'],
    ['navigate', 'active.excalidraw'],
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

test('WorkspaceRouteController waits for canvas edits before changing files or opening git history', async () => {
  const events = [];
  let canLeave = false;
  let route = { filePath: 'next.md', type: 'file' };
  const { controller } = createController({
    canvasEmbed: {
      prepareFileDisconnect: async (filePath) => {
        events.push(['flush-canvas', filePath]);
        return canLeave;
      },
    },
    navigation: {
      getHashRoute: () => route,
      navigateToFile: (filePath) => events.push(['navigate', filePath]),
    },
    workspaceCoordinator: {
      getSession: () => null,
      isCanvasFile: (filePath) => filePath.endsWith('.canvas'),
      openFile: async (filePath) => { events.push(['open-file', filePath]); return true; },
      stateStore: { currentFilePath: 'ideas.canvas' },
    },
    showGitHistory: async () => events.push(['git-history']),
  });
  await controller.handleHashChange();
  assert.deepEqual(events, [['flush-canvas', 'ideas.canvas'], ['navigate', 'ideas.canvas']]);
  events.length = 0;
  assert.equal(await controller.openFile('next.md'), false);
  assert.deepEqual(events, [['flush-canvas', 'ideas.canvas'], ['navigate', 'ideas.canvas']]);
  events.length = 0;
  route = { type: 'git-history' };
  await controller.handleHashChange();
  assert.deepEqual(events, [['flush-canvas', 'ideas.canvas'], ['navigate', 'ideas.canvas']]);
  events.length = 0;
  canLeave = true;
  await controller.handleHashChange();
  assert.deepEqual(events, [['flush-canvas', 'ideas.canvas'], ['git-history']]);
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

test('WorkspaceRouteController keeps historical files selected while resetting the editor session', () => {
  for (const [method, editorVisible] of [['showFileHistoryState', false], ['showPreviewOnlyState', true]]) {
    const { controller, currentFilePath, events, previewContent, session, sessionLoadToken } = createController();

    controller[method]('docs/history.md');

    assert.equal(session(), null);
    assert.equal(sessionLoadToken(), 1);
    assert.equal(currentFilePath(), 'docs/history.md');
    assert.equal(previewContent.innerHTML, '');
    assert.equal(previewContent.dataset.renderPhase, 'ready');
    assert.deepEqual(events.slice(0, 10), [
      ['diff-hide'],
      ['session-token', 1],
      ['clear-bootstrap'],
      ['cleanup-session'],
      ['session', null],
      ['reset-preview'],
      ['layout-reset'],
      ['current-file', 'docs/history.md'],
      ['lobby-file', null],
      ['explorer-active', 'docs/history.md'],
    ]);
    assert.deepEqual(controller.elements.editorPage.classList.events, [[editorVisible ? 'remove' : 'add', 'hidden']]);
    assert.deepEqual(controller.elements.diffPage.classList.events, [[editorVisible ? 'add' : 'remove', 'hidden']]);
  }
});

test('WorkspaceRouteController reveals the file tree once for quick-switcher opens without changing navigation semantics', async () => {
  const { controller, events } = createController();

  controller.handleFileSelection('notes/today.md', {
    closeSidebarOnMobile: true,
    revealInTree: true,
  });

  assert.deepEqual(events.slice(-1), [
    ['navigate', 'notes/today.md'],
  ]);
  assert.equal(events.some(([type]) => type === 'explorer-reveal'), false);
  assert.equal(events.some(([type]) => type === 'close-sidebar'), false);

  await controller.openFile('notes/today.md');
  await controller.openFile('notes/today.md');

  assert.deepEqual(events.filter(([type]) => type === 'explorer-reveal'), [
    ['explorer-reveal', 'notes/today.md', { clearSearch: true }],
  ]);
  assert.deepEqual(events.filter(([type]) => type === 'sidebar-tab').slice(-1), [
    ['sidebar-tab', 'files'],
  ]);
  assert.deepEqual(events.filter(([type]) => type === 'sidebar-visibility').slice(-1), [
    ['sidebar-visibility', true],
  ]);
});

test('WorkspaceRouteController reveals the current file immediately for quick-switcher reselection', () => {
  const { controller, events } = createController();

  controller.handleFileSelection('README.md', { revealInTree: true });

  assert.deepEqual(events.filter(([type]) => type === 'sidebar-tab'), [
    ['sidebar-tab', 'files'],
  ]);
  assert.deepEqual(events.filter(([type]) => type === 'sidebar-visibility'), [
    ['sidebar-visibility', true],
  ]);
  assert.deepEqual(events.filter(([type]) => type === 'explorer-reveal'), [
    ['explorer-reveal', 'README.md', { clearSearch: true }],
  ]);
  assert.equal(events.some(([type]) => type === 'navigate'), false);
});

test('WorkspaceRouteController navigates instead of fast-revealing when draw.io text mode is active', () => {
  const { controller, events } = createController({
    navigation: {
      getHashRoute: () => ({
        drawioMode: 'text',
        filePath: 'diagrams/architecture.drawio',
        type: 'file',
      }),
      navigateToFile: (filePath) => events.push(['navigate', filePath]),
    },
  });

  controller.handleFileSelection('diagrams/architecture.drawio', { revealInTree: true });

  assert.deepEqual(events.filter(([type]) => type === 'navigate'), [
    ['navigate', 'diagrams/architecture.drawio'],
  ]);
  assert.equal(events.some(([type]) => type === 'explorer-reveal'), false);
  assert.equal(events.some(([type]) => type === 'sidebar-visibility'), false);
});
