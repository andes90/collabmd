import test from 'node:test';
import assert from 'node:assert/strict';

import { gitApiClient } from '../../src/client/infrastructure/git-api-client.js';
import { FileHistoryViewController } from '../../src/client/presentation/file-history-view-controller.js';
import { GitDiffViewController } from '../../src/client/presentation/git-diff-view-controller.js';

class FakeClassList {
  constructor() {
    this.values = new Set();
  }

  add(token) {
    this.values.add(token);
  }

  remove(token) {
    this.values.delete(token);
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.values.has(token)) {
        this.values.delete(token);
        return false;
      }
      this.values.add(token);
      return true;
    }

    if (force) {
      this.values.add(token);
      return true;
    }
    this.values.delete(token);
    return false;
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeElement {
  constructor({ attributes = {}, html = '', queryMap = {} } = {}) {
    this.attributes = { ...attributes };
    // Test-only fake DOM stores controller-owned markup for assertions.
    // pi-lens-ignore: no-inner-html-js
    this.innerHTML = html;
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.queryMap = queryMap;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  dispatch(type, target = this) {
    for (const handler of this.listeners.get(type) ?? []) {
      handler({
        preventDefault() {},
        stopPropagation() {},
        target,
      });
    }
  }

  getAttribute(name) {
    return this.attributes[name] ?? null;
  }

  toggleAttribute(name, force) {
    if (force) {
      this.attributes[name] = '';
      return;
    }
    delete this.attributes[name];
  }

  querySelector(selector) {
    return this.queryMap[selector] ?? null;
  }

  querySelectorAll(selector) {
    const value = this.queryMap[selector];
    return Array.isArray(value) ? value : [];
  }

  getBoundingClientRect() {
    return { top: 0 };
  }

  scrollIntoView() {}

  scrollTo() {}
}

function createButton(value) {
  const button = new FakeElement({
    attributes: value ? { 'data-diff-layout': value, 'data-diff-mode': value } : {},
  });
  return button;
}

function createHarness() {
  const elements = {
    'diff-page': new FakeElement(),
    diffContent: new FakeElement(),
    diffScroll: new FakeElement(),
    diffFileIndicator: new FakeElement(),
    diffOpenEditorBtn: new FakeElement(),
    diffPrimaryActionBtn: new FakeElement(),
    diffCommitBtn: new FakeElement(),
    diffBackToHistoryBtn: new FakeElement(),
    diffGitActionsGroup: new FakeElement(),
    diffEditorActionsGroup: new FakeElement(),
    diffToolbarDivider: new FakeElement(),
    diffStats: new FakeElement(),
    diffPrevBtn: new FakeElement(),
    diffNextBtn: new FakeElement(),
    diffLayoutToggle: new FakeElement(),
  };
  const modeButtons = [createButton('unified'), createButton('split')];
  modeButtons[0].attributes = { 'data-diff-mode': 'unified' };
  modeButtons[1].attributes = { 'data-diff-mode': 'split' };
  const layoutButtons = [createButton('stacked'), createButton('focused')];
  layoutButtons[0].attributes = { 'data-diff-layout': 'stacked' };
  layoutButtons[1].attributes = { 'data-diff-layout': 'focused' };

  const previousDocument = globalThis.document;
  globalThis.document = {
    getElementById(id) {
      return elements[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-diff-mode]') {
        return modeButtons;
      }
      if (selector === '[data-diff-layout]') {
        return layoutButtons;
      }
      return [];
    },
  };

  return {
    elements,
    layoutButtons,
    modeButtons,
    restore() {
      globalThis.document = previousDocument;
    },
  };
}

function createSectionId(pathValue) {
  return `diff-section-${encodeURIComponent(String(pathValue ?? '')).replace(/%/g, '_')}`;
}

function installFetchStub(t, responses) {
  const calls = [];
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    calls.push(String(url));
    const next = responses.shift();
    return {
      async json() {
        return next.body;
      },
      ok: next.ok !== false,
    };
  };
  t.after(() => {
    globalThis.fetch = previousFetch;
  });
  return calls;
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

test('GitDiffViewController describes staged state as inclusion in the next commit', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());

  const controller = new GitDiffViewController();
  controller.data = {
    files: [{ hasStagedChanges: true, path: 'README.md' }],
    summary: {},
  };
  controller.repoStatus = { summary: { staged: 1 } };
  controller.syncToolbar();

  assert.equal(harness.elements.diffFileIndicator.textContent, '1 of 1');
  assert.equal(harness.elements.diffPrimaryActionBtn.textContent, 'Remove');
  assert.equal(harness.elements.diffCommitBtn.textContent, 'Commit 1 file');
  assert.equal(harness.elements.diffCommitBtn.classList.contains('hidden'), false);
  assert.match(controller.renderFileHeader(controller.data.files[0]), /✓ Included/u);

  controller.data.files[0] = { hasWorkingTreeChanges: true, path: 'README.md' };
  controller.repoStatus = { summary: { staged: 0 } };
  controller.syncToolbar();

  assert.equal(harness.elements.diffPrimaryActionBtn.textContent, 'Include in commit');
  assert.equal(harness.elements.diffPrimaryActionBtn.classList.contains('ui-button--primary'), true);
  assert.equal(harness.elements.diffCommitBtn.classList.contains('hidden'), true);
  assert.doesNotMatch(controller.renderFileHeader(controller.data.files[0]), /✓ Included/u);

  const repoStatus = controller.repoStatus;
  controller.hide();
  assert.equal(controller.repoStatus, repoStatus);
});

test('GitDiffViewController does not show pending copy when both actions are null', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  const controller = new GitDiffViewController();
  controller.data = { files: [], summary: {} };

  controller.syncToolbar();

  assert.equal(controller.pendingAction, null);
  assert.equal(controller.getPrimaryAction(), null);
  assert.equal(harness.elements.diffPrimaryActionBtn.textContent, 'Include in commit');
});

test('GitDiffViewController shows pending copy for the active primary action', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  const controller = new GitDiffViewController();
  controller.data = {
    files: [{ hasWorkingTreeChanges: true, path: 'README.md' }],
    summary: {},
  };
  controller.pendingAction = 'stage';

  controller.syncToolbar();

  assert.equal(controller.getPrimaryAction(), 'stage');
  assert.equal(harness.elements.diffPrimaryActionBtn.textContent, 'Working…');
});

test('GitDiffViewController marks focused and stacked per-file failures as alerts', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  const controller = new GitDiffViewController();
  controller.data = {
    files: [
      { path: 'README.md', status: 'modified', stats: {} },
      { path: 'docs/guide.md', status: 'modified', stats: {} },
    ],
    summary: {},
  };
  controller.activeFilePath = 'README.md';
  controller.currentIndex = 0;
  controller.fileErrors.set('README.md', 'Failed to load file diff');
  controller.fileErrors.set('docs/guide.md', 'Failed to load file diff');

  assert.match(controller.renderFocusedFileBody(), /role="alert">Failed to load file diff/u);
  assert.match(controller.renderStackedSection(controller.data.files[1], 1), /role="alert">Failed to load file diff/u);
});

test('GitDiffViewController keeps Open in editor available for an empty workspace diff', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);
  installFetchStub(t, [{
    body: {
      files: [],
      summary: { additions: 0, deletions: 0, filesChanged: 0 },
    },
  }]);
  const openedFiles = [];
  const controller = new GitDiffViewController({
    gitApiClient: gitApiClient,
    onOpenFile: (filePath) => openedFiles.push(filePath),
  });
  controller.initialize();

  await controller.openWorkspaceDiff({ filePath: '1-on-1.md', scope: 'all' });
  harness.elements.diffOpenEditorBtn.dispatch('click');

  assert.equal('disabled' in harness.elements.diffOpenEditorBtn.attributes, false);
  assert.deepEqual(openedFiles, ['1-on-1.md']);
});

test('GitDiffViewController opens commit diffs in stacked mode and lazy-loads expanded files', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);

  const calls = installFetchStub(t, [
    {
      body: {
        commit: { hash: 'abc1234', shortHash: 'abc1234', subject: 'Commit title' },
        files: [
          { path: 'README.md', stats: { additions: 3, deletions: 1 }, status: 'modified' },
          { path: 'docs/guide.md', stats: { additions: 2, deletions: 0 }, status: 'added' },
        ],
        summary: { additions: 5, deletions: 1, filesChanged: 2 },
      },
    },
    {
      body: {
        files: [{
          path: 'README.md',
          hunks: [{ header: '@@ -1 +1 @@', lines: [] }],
          stats: { additions: 3, deletions: 1 },
          status: 'modified',
        }],
      },
    },
    {
      body: {
        files: [{
          path: 'docs/guide.md',
          hunks: [{ header: '@@ -0,0 +1 @@', lines: [] }],
          stats: { additions: 2, deletions: 0 },
          status: 'added',
        }],
      },
    },
  ]);

  const controller = new GitDiffViewController({ gitApiClient: gitApiClient });
  controller.initialize();

  await controller.openCommitDiff({ hash: 'abc1234' });

  assert.equal(controller.layoutMode, 'stacked');
  assert.equal(controller.activeFilePath, 'README.md');
  assert.equal(controller.isFileCollapsed('README.md'), false);
  assert.equal(controller.isFileCollapsed('docs/guide.md'), true);
  assert.match(harness.elements.diffContent.innerHTML, /Changed Files/);
  assert.match(harness.elements.diffContent.innerHTML, /data-diff-index-path="README\.md"/);
  assert.equal(calls.length, 2);

  await controller.toggleFileSection('docs/guide.md');

  assert.equal(controller.isFileCollapsed('docs/guide.md'), false);
  assert.equal(calls.length, 3);
});

test('GitDiffViewController file index switches files in focused commit mode', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);

  installFetchStub(t, [
    {
      body: {
        commit: { hash: 'def5678', shortHash: 'def5678', subject: 'Commit title' },
        files: [
          { path: 'README.md', stats: { additions: 1, deletions: 0 }, status: 'modified' },
          { path: 'docs/guide.md', stats: { additions: 2, deletions: 0 }, status: 'added' },
        ],
        summary: { additions: 3, deletions: 0, filesChanged: 2 },
      },
    },
    {
      body: {
        files: [{
          path: 'README.md',
          hunks: [{ header: '@@ -1 +1 @@', lines: [] }],
          stats: { additions: 1, deletions: 0 },
          status: 'modified',
        }],
      },
    },
    {
      body: {
        files: [{
          path: 'docs/guide.md',
          hunks: [{ header: '@@ -0,0 +1 @@', lines: [] }],
          stats: { additions: 2, deletions: 0 },
          status: 'added',
        }],
      },
    },
  ]);

  const controller = new GitDiffViewController({ gitApiClient: gitApiClient });
  controller.initialize();

  await controller.openCommitDiff({ hash: 'def5678' });
  await controller.setLayoutMode('focused');
  await controller.handleIndexSelection('docs/guide.md');

  assert.equal(controller.layoutMode, 'focused');
  assert.equal(controller.activeFilePath, 'docs/guide.md');
  assert.equal(controller.currentIndex, 1);
  assert.match(harness.elements.diffContent.innerHTML, /docs\/guide\.md/);
});

test('GitDiffViewController scrolls stacked commit view to selected file section', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);

  installFetchStub(t, [
    {
      body: {
        commit: { hash: 'ghi9012', shortHash: 'ghi9012', subject: 'Commit title' },
        files: [
          { path: 'README.md', stats: { additions: 1, deletions: 0 }, status: 'modified' },
          { path: '.DS_Store', stats: { additions: 0, deletions: 0 }, status: 'added' },
        ],
        summary: { additions: 1, deletions: 0, filesChanged: 2 },
      },
    },
    {
      body: {
        files: [{
          path: 'README.md',
          hunks: [{ header: '@@ -1 +1 @@', lines: [] }],
          stats: { additions: 1, deletions: 0 },
          status: 'modified',
        }],
      },
    },
    {
      body: {
        files: [{
          path: '.DS_Store',
          hunks: [{ header: '@@ -0,0 +0,0 @@', lines: [] }],
          stats: { additions: 0, deletions: 0 },
          status: 'added',
        }],
      },
    },
  ]);

  const controller = new GitDiffViewController({ gitApiClient: gitApiClient });
  controller.initialize();

  harness.elements.diffScroll.scrollTop = 40;
  harness.elements.diffScroll.getBoundingClientRect = () => ({ top: 100 });
  harness.elements.diffScroll.scrollTo = (options) => {
    harness.elements.diffScroll.lastScrollTo = options;
  };

  await controller.openCommitDiff({ hash: 'ghi9012' });

  const targetSection = new FakeElement({
    attributes: { 'data-diff-section-path': '.DS_Store' },
  });
  targetSection.getBoundingClientRect = () => ({ top: 340 });
  harness.elements[createSectionId('.DS_Store')] = targetSection;

  await controller.handleIndexSelection('.DS_Store');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(controller.activeFilePath, '.DS_Store');
  assert.deepEqual(harness.elements.diffScroll.lastScrollTo, {
    top: 272,
    behavior: 'smooth',
  });
});

test('GitDiffViewController routes back to file history when commit diff carries file history context', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);

  installFetchStub(t, [
    {
      body: {
        commit: { hash: 'abc1234', shortHash: 'abc1234', subject: 'Commit title' },
        files: [
          { path: 'docs/old-name.md', stats: { additions: 1, deletions: 0 }, status: 'modified' },
        ],
        summary: { additions: 1, deletions: 0, filesChanged: 1 },
      },
    },
    {
      body: {
        files: [{
          path: 'docs/old-name.md',
          hunks: [{ header: '@@ -1 +1 @@', lines: [] }],
          stats: { additions: 1, deletions: 0 },
          status: 'modified',
        }],
      },
    },
  ]);

  const events = [];
  const controller = new GitDiffViewController({
    gitApiClient: gitApiClient,
    onBackToHistory: (payload) => events.push(payload),
  });
  controller.initialize();

  await controller.openCommitDiff({
    hash: 'abc1234',
    historyFilePath: 'docs/current-name.md',
    path: 'docs/old-name.md',
  });
  harness.elements.diffBackToHistoryBtn.dispatch('click');

  assert.deepEqual(events, [{
    hash: 'abc1234',
    historyFilePath: 'docs/current-name.md',
  }]);
});

test('GitDiffViewController diff mode toggle ignores inactive file history listeners', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);

  installFetchStub(t, [
    {
      body: {
        commit: { hash: 'xyz9876', shortHash: 'xyz9876', subject: 'Commit title' },
        files: [
          { path: 'README.md', stats: { additions: 1, deletions: 1 }, status: 'modified' },
        ],
        summary: { additions: 1, deletions: 1, filesChanged: 1 },
      },
    },
    {
      body: {
        files: [{
          path: 'README.md',
          hunks: [{
            header: '@@ -1 +1 @@',
            lines: [
              { type: 'deletion', oldLine: 1, newLine: null, content: 'before' },
              { type: 'addition', oldLine: null, newLine: 1, content: 'after' },
            ],
          }],
          stats: { additions: 1, deletions: 1 },
          status: 'modified',
        }],
      },
    },
  ]);

  const controller = new GitDiffViewController({ gitApiClient: gitApiClient });
  const fileHistoryView = new FileHistoryViewController({
    diffRenderer: controller,
    gitApiClient: gitApiClient,
  });
  controller.initialize();
  fileHistoryView.initialize();

  await controller.openCommitDiff({ hash: 'xyz9876' });
  harness.modeButtons[1].dispatch('click');

  assert.equal(controller.mode, 'split');
  assert.equal(fileHistoryView.currentFilePath, null);
  assert.match(harness.elements.diffContent.innerHTML, /diff-split-row/);
  assert.doesNotMatch(harness.elements.diffContent.innerHTML, /No file selected\./);
});

test('GitDiffViewController renders binary image diffs as a before and after comparison', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);

  const controller = new GitDiffViewController({
    gitApiClient: {
      getFileAttachmentUrl: ({ hash, path }) => `/api/git/file-attachment?hash=${hash}&path=${path}`,
    },
  });
  controller.isActive = true;
  controller.data = {
    files: [{
      byteLength: 128,
      fileKind: 'image',
      hunks: [],
      isBinary: true,
      path: 'assets/diagram.webp',
      status: 'untracked',
      stats: { additions: 0, deletions: 0 },
    }],
    summary: { additions: 0, deletions: 0, filesChanged: 1 },
  };
  controller.render();

  assert.match(harness.elements.diffContent.innerHTML, /diff-media-grid/);
  assert.match(harness.elements.diffContent.innerHTML, /Image comparison/);
  assert.match(harness.elements.diffContent.innerHTML, /attachment\?path=assets%2Fdiagram.webp/);
  assert.doesNotMatch(harness.elements.diffContent.innerHTML, /RIFF/);
});

test('GitDiffViewController renders Excalidraw changes as scene summary plus readable JSON', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());

  const controller = new GitDiffViewController();
  const scene = JSON.stringify({
    appState: { viewBackgroundColor: '#ffffff' },
    elements: [{ id: 'rectangle-1', type: 'rectangle', x: 24, y: 32, width: 180, height: 90 }],
    files: {},
    type: 'excalidraw',
    version: 2,
  });
  const markup = controller.renderExcalidrawDiff({
    fileKind: 'excalidraw',
    hunks: [{
      lines: [{ content: scene, newLine: 1, oldLine: null, type: 'addition' }],
    }],
    path: 'test.excalidraw',
    status: 'untracked',
  });

  assert.match(markup, /Excalidraw scene changes/);
  assert.match(markup, /diff-scene-stat--add/);
  assert.match(markup, /\+1/);
  assert.match(markup, /Structured scene/);
  assert.match(markup, /rectangle-1/);
  assert.match(markup, /diff-excalidraw-preview/);
});

test('GitDiffViewController renders draw.io changes as visual panes plus XML fallback', (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());

  const controller = new GitDiffViewController();
  const before = [
    '<mxfile>',
    '  <diagram>',
    '    <mxGraphModel><root>',
    '      <mxCell id="0" />',
    '      <mxCell id="1" parent="0" />',
    '      <mxCell id="shape-1" value="Before" vertex="1" parent="1" />',
    '    </root></mxGraphModel>',
    '  </diagram>',
    '</mxfile>',
  ].join('\n');
  const after = before
    .replace('value="Before"', 'value="After"')
    .replace('    </root>', '      <mxCell id="shape-2" value="New" vertex="1" parent="1" />\n    </root>');
  const markup = controller.renderDrawioDiff({
    fileKind: 'drawio',
    hunks: [{
      lines: [
        { content: before, newLine: null, oldLine: 1, type: 'deletion' },
        { content: after, newLine: 1, oldLine: null, type: 'addition' },
      ],
    }],
    path: 'test.drawio',
    status: 'modified',
  });

  assert.match(markup, /draw\.io diagram changes/);
  assert.match(markup, /diff-drawio-grid/);
  assert.match(markup, /XML source/);
  assert.match(markup, /diff-drawio-preview/);
  assert.match(markup, /shape-2/);
});
