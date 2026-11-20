import assert from 'node:assert/strict';
import test from 'node:test';

import { commentsFeature } from '../../src/client/application/app-shell/comments-feature.js';

function createOverviewContext(overrides = {}) {
  return {
    ...commentsFeature,
    closeSidebarOnMobile() {},
    commentUi: { setThreads() {}, openThreadFromOverview: () => false },
    currentFilePath: 'notes/current.md',
    navigation: { navigateToFile: () => true },
    setSidebarTab() {},
    setSidebarVisibility() {},
    workspaceRouteController: { preserveSidebarTabForNextFileRoute() {} },
    ...overrides,
  };
}

test('comment overview waits for the file route and focuses a thread when it arrives', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  let available = false;
  const context = createOverviewContext({
    commentUi: {
      setThreads(threads) { available = threads.some(({ id }) => id === 'thread-1'); },
      openThreadFromOverview: (threadId) => { calls.push(['focus', threadId]); return available; },
    },
    navigation: { navigateToFile: (filePath, options) => { calls.push(['route', filePath, options]); return true; } },
  });

  context.openCommentOverviewThread({ anchor: { startLine: 12 }, filePath: 'notes/target.md', threadId: 'thread-1' });
  assert.deepEqual(calls, [['route', 'notes/target.md', { line: 12 }]]);
  context.handleCommentOverviewRouteChange('notes/target.md');
  context.currentFilePath = 'notes/target.md';
  context.handleCommentThreadsChange([]);
  t.mock.timers.tick(2_000);
  assert.equal(calls.length, 2);
  context.handleCommentThreadsChange([{ id: 'thread-1' }]);
  assert.deepEqual(calls.at(-1), ['focus', 'thread-1']);
  assert.equal(context._pendingCommentOverviewFocus, null);
  assert.equal(context._commentOverviewFocusTimer, null);
});

test('comment overview focuses diagram threads after the route mounts the preview', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const calls = [];
  const filePath = 'diagrams/target.excalidraw';
  const context = createOverviewContext({
    excalidrawEmbed: { openCommentThread: (...args) => { calls.push(args); return true; } },
  });
  context.openCommentOverviewThread({ filePath, threadId: 'thread-diagram' });
  assert.deepEqual(calls, []);
  context.handleCommentOverviewRouteChange(filePath);
  context.currentFilePath = filePath;
  assert.equal(context.focusPendingCommentOverviewThread(), true);
  assert.deepEqual(calls, [[filePath, 'thread-diagram']]);
});

test('comment overview clears pending focus and refresh timers when leaving the route', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const context = createOverviewContext({ commentsOverview: { refresh: () => assert.fail('Refresh ran after leaving') } });
  context.openCommentOverviewThread({ filePath: 'notes/target.md', threadId: 'thread-1' });
  context.scheduleCommentOverviewRefresh();
  context.handleCommentOverviewRouteChange(null);
  t.mock.timers.tick(15_000);
  assert.equal(context._pendingCommentOverviewFocus, null);
  assert.equal(context._commentOverviewRefreshTimer, null);
  assert.equal(context._commentOverviewStale, true);
});

test('comment overview tree changes refresh only while comments tab is active', () => {
  const calls = [];
  const filesContext = {
    activeSidebarTab: 'files',
    scheduleCommentOverviewRefresh: (options) => calls.push(['files-refresh', options]),
  };

  commentsFeature.handleCommentOverviewWorkspaceTreeChange.call(filesContext);

  assert.equal(filesContext._commentOverviewStale, true);
  assert.deepEqual(calls, []);

  const commentsContext = {
    activeSidebarTab: 'comments',
    scheduleCommentOverviewRefresh: (options) => calls.push(['comments-refresh', options]),
  };

  commentsFeature.handleCommentOverviewWorkspaceTreeChange.call(commentsContext);

  assert.equal(commentsContext._commentOverviewStale, true);
  assert.deepEqual(calls, [['comments-refresh', { delayMs: 0 }]]);
});

test('comment overview sidebar open clears stale state and refreshes', () => {
  const calls = [];
  const context = {
    _commentOverviewStale: true,
    commentsOverview: {
      refresh: () => calls.push(['refresh']),
    },
  };

  commentsFeature.refreshCommentOverviewForSidebarOpen.call(context);

  assert.equal(context._commentOverviewStale, false);
  assert.deepEqual(calls, [['refresh']]);
});
