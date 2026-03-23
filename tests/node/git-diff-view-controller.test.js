import test from 'node:test';
import assert from 'node:assert/strict';

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
    this.innerHTML = html;
    this.listeners = new Map();
    this.classList = new FakeClassList();
    this.queryMap = queryMap;
  }

  addEventListener(type, handler) {
    this.listeners.set(type, handler);
  }

  dispatch(type, target = this) {
    this.listeners.get(type)?.({
      preventDefault() {},
      stopPropagation() {},
      target,
    });
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

  const controller = new GitDiffViewController();
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

  const controller = new GitDiffViewController();
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

  const controller = new GitDiffViewController();
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
