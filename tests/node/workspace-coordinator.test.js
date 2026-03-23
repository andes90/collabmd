import test from 'node:test';
import assert from 'node:assert/strict';

import { EditorSession } from '../../src/client/infrastructure/editor-session.js';
import { WorkspaceCoordinator } from '../../src/client/application/workspace-coordinator.js';

function createStateStore() {
  const state = new Map([
    ['connectionState', null],
    ['connectionHelpShown', false],
    ['currentFilePath', null],
    ['sessionLoadToken', 0],
  ]);

  return {
    get(key) {
      return state.get(key);
    },
    nextSessionLoadToken() {
      const nextToken = (state.get('sessionLoadToken') ?? 0) + 1;
      state.set('sessionLoadToken', nextToken);
      return nextToken;
    },
    set(key, value) {
      state.set(key, value);
    },
  };
}

function createCoordinator(overrides = {}) {
  const events = [];
  const stateStore = createStateStore();
  const session = overrides.session ?? {
    activateCollaborativeView() {
      events.push('activate-collab');
    },
    applyTheme() {
      events.push('apply-theme');
    },
    destroy() {
      events.push('destroy');
    },
    ensureInitialContent() {
      events.push('ensure-content');
    },
    getScrollContainer() {
      return null;
    },
    hasBootstrapContent() {
      return false;
    },
    initialize: async () => {
      events.push('initialize');
    },
    requestMeasure() {
      events.push('measure');
    },
    showBootstrapContent() {
      events.push('show-bootstrap');
      return true;
    },
    waitForInitialSync: async () => {
      events.push('wait-sync');
    },
  };

  const coordinator = new WorkspaceCoordinator({
    attachEditorScroller: () => {},
    beginDocumentLoad: () => {
      events.push('begin-load');
    },
    cleanupAfterSessionDestroy: () => {
      events.push('cleanup-session');
    },
    createEditorSession: () => session,
    getDisplayName: () => 'README',
    getFileList: () => [],
    getLineWrappingEnabled: () => true,
    getLocalUser: () => null,
    getStoredUserName: () => 'Tester',
    getTheme: () => 'light',
    isDrawioFile: () => false,
    isExcalidrawFile: () => false,
    isMermaidFile: () => false,
    isPlantUmlFile: () => false,
    isTabActive: () => true,
    loadBootstrapContent: async () => null,
    loadEditorSessionClass: async () => EditorSession,
    loadBacklinks: () => {
      events.push('load-backlinks');
    },
    onBeforeFileOpen: () => {
      events.push('before-open');
    },
    onConnectionChange: () => {},
    onContentChange: () => {
      events.push('content-change');
    },
    onFileAwarenessChange: () => {},
    onFileOpenError: () => {
      events.push('open-error');
    },
    onFileOpenReady: () => {
      events.push('open-ready');
    },
    onImagePaste: () => {
      events.push('image-paste');
    },
    onRenderDrawioPreview: () => {
      events.push('render-drawio');
    },
    onRenderExcalidrawPreview: () => {
      events.push('render-excalidraw');
    },
    onRenderImagePreview: () => {
      events.push('render-image');
    },
    onSyncWrapToggle: () => {
      events.push('sync-wrap');
    },
    onUpdateActiveFile: () => {},
    onUpdateCurrentFile: () => {},
    onUpdateLobbyCurrentFile: () => {},
    onUpdateVisibleChrome: () => {},
    onViewModeReset: () => {
      events.push('reset-view');
    },
    renderPresence: () => {
      events.push('render-presence');
    },
    scrollContainerForSession: () => null,
    shouldUseDrawioPreview: () => true,
    showEditorLoading: () => {
      events.push('show-loading');
    },
    stateStore,
    ...overrides,
  });

  coordinator.waitForNextPaint = async () => {
    events.push('wait-next-paint');
  };

  return { coordinator, events, session, stateStore };
}

test('EditorSession emitContentChange deduplicates repeated content', () => {
  const notifications = [];
  const session = Object.create(EditorSession.prototype);
  session.onContentChange = () => {
    notifications.push('change');
  };
  session.getText = () => 'hello';
  session.hasDeliveredContent = false;
  session.lastDeliveredContent = null;

  assert.equal(session.emitContentChange(), true);
  assert.equal(session.emitContentChange(), false);

  session.getText = () => 'hello world';
  assert.equal(session.emitContentChange(), true);
  assert.deepEqual(notifications, ['change', 'change']);
});

test('WorkspaceCoordinator marks file open before post-paint work completes', async () => {
  const { coordinator, events } = createCoordinator();

  await coordinator.openFile('README.md');

  assert.ok(events.indexOf('open-ready') >= 0);
  assert.ok(events.indexOf('wait-next-paint') >= 0);
  assert.ok(events.indexOf('open-ready') < events.indexOf('wait-next-paint'));
  assert.ok(events.indexOf('ensure-content') > events.indexOf('wait-sync'));
  assert.ok(events.indexOf('load-backlinks') > events.indexOf('wait-next-paint'));
});

test('WorkspaceCoordinator ensures initial content after sync wait even without early content events', async () => {
  let ensureCalls = 0;
  const { coordinator } = createCoordinator({
    session: {
      applyTheme() {},
      destroy() {},
      ensureInitialContent() {
        ensureCalls += 1;
      },
      getScrollContainer() {
        return null;
      },
      hasBootstrapContent() {
        return false;
      },
      initialize: async () => {},
      requestMeasure() {},
      showBootstrapContent() {
        return false;
      },
      waitForInitialSync: async () => {},
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(ensureCalls, 1);
});

test('WorkspaceCoordinator forwards image paste handling into the editor session options', async () => {
  let sessionOptions = null;
  const { coordinator } = createCoordinator({
    createEditorSession: (_EditorSessionClass, options) => {
      sessionOptions = options;
      return {
        applyTheme() {},
        destroy() {},
        ensureInitialContent() {},
        getScrollContainer() {
          return null;
        },
        hasBootstrapContent() {
          return false;
        },
        initialize: async () => {},
        requestMeasure() {},
        showBootstrapContent() {
          return false;
        },
        waitForInitialSync: async () => {},
      };
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(typeof sessionOptions?.onImagePaste, 'function');
});

test('WorkspaceCoordinator skips creating an editor session for Excalidraw files', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    isExcalidrawFile: (filePath) => filePath?.endsWith('.excalidraw'),
  });

  await coordinator.openFile('vault/new-diagram.excalidraw');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-excalidraw'));
});

test('WorkspaceCoordinator skips creating an editor session for draw.io files', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    isDrawioFile: (filePath) => filePath?.endsWith('.drawio'),
    shouldUseDrawioPreview: () => true,
  });

  await coordinator.openFile('vault/architecture.drawio');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-drawio'));
});

test('WorkspaceCoordinator skips creating an editor session for image attachments', async () => {
  let createSessionCalls = 0;
  const { coordinator, events } = createCoordinator({
    createEditorSession: () => {
      createSessionCalls += 1;
      return {
        destroy() {},
      };
    },
    isImageFile: (filePath) => filePath?.endsWith('.png'),
  });

  await coordinator.openFile('README.assets/diagram.png');

  assert.equal(createSessionCalls, 0);
  assert.equal(coordinator.getSession(), null);
  assert.ok(events.includes('open-ready'));
  assert.ok(events.includes('render-image'));
});

test('WorkspaceCoordinator shows bootstrap content before live sync completes', async () => {
  let resolveInitialSync;
  const initialSyncPromise = new Promise((resolve) => {
    resolveInitialSync = resolve;
  });
  const { coordinator, events } = createCoordinator({
    loadBootstrapContent: async () => '# Bootstrap\n',
    session: {
      activateCollaborativeView() {
        events.push('activate-collab');
      },
      applyTheme() {
        events.push('apply-theme');
      },
      destroy() {
        events.push('destroy');
      },
      ensureInitialContent() {
        events.push('ensure-content');
      },
      getScrollContainer() {
        return null;
      },
      hasBootstrapContent() {
        return true;
      },
      initialize: async () => {
        events.push('initialize');
      },
      requestMeasure() {
        events.push('measure');
      },
      showBootstrapContent() {
        events.push('show-bootstrap');
        return true;
      },
      waitForInitialSync: async () => {
        events.push('wait-sync');
        await initialSyncPromise;
      },
    },
  });

  const openPromise = coordinator.openFile('README.md');
  await new Promise((resolve) => setTimeout(resolve, 200));

  assert.ok(events.includes('show-bootstrap'));
  assert.ok(events.includes('open-ready'));
  assert.equal(events.includes('activate-collab'), false);

  resolveInitialSync();
  await openPromise;

  assert.ok(events.includes('activate-collab'));
  assert.ok(events.indexOf('show-bootstrap') < events.indexOf('open-ready'));
});

test('WorkspaceCoordinator skips bootstrap when live sync wins the race', async () => {
  const { coordinator, events } = createCoordinator({
    loadBootstrapContent: async () => '# Bootstrap\n',
    session: {
      activateCollaborativeView() {
        events.push('activate-collab');
      },
      applyTheme() {
        events.push('apply-theme');
      },
      destroy() {
        events.push('destroy');
      },
      ensureInitialContent() {
        events.push('ensure-content');
      },
      getScrollContainer() {
        return null;
      },
      hasBootstrapContent() {
        return false;
      },
      initialize: async () => {
        events.push('initialize');
      },
      requestMeasure() {
        events.push('measure');
      },
      showBootstrapContent() {
        events.push('show-bootstrap');
        return true;
      },
      waitForInitialSync: async () => {
        events.push('wait-sync');
      },
    },
  });

  await coordinator.openFile('README.md');

  assert.equal(events.includes('show-bootstrap'), false);
  assert.ok(events.includes('activate-collab'));
});
