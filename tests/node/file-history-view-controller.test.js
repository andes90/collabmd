import test from 'node:test';
import assert from 'node:assert/strict';

import { FileHistoryViewController } from '../../src/client/presentation/file-history-view-controller.js';

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
}

class FakeElement {
  constructor({ attributes = {} } = {}) {
    this.attributes = { ...attributes };
    this.classList = new FakeClassList();
    this.innerHTML = '';
    this.listeners = new Map();
    this.querySelectorMap = {};
    this.scrollTop = 0;
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

  closest(selector) {
    return this.closestMap?.[selector] ?? null;
  }

  querySelector(selector) {
    return this.querySelectorMap?.[selector] ?? null;
  }
}

function createHarness() {
  const historyList = new FakeElement();
  const elements = {
    'diff-page': new FakeElement(),
    diffContent: new FakeElement(),
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
  elements.diffContent.querySelectorMap = {
    '[data-file-history-list]': historyList,
  };
  const modeButtons = [new FakeElement(), new FakeElement()];

  const previousDocument = globalThis.document;
  const previousElement = globalThis.Element;
  globalThis.Element = FakeElement;
  globalThis.document = {
    getElementById(id) {
      return elements[id] ?? null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-diff-mode]') {
        return modeButtons;
      }
      return [];
    },
  };

  return {
    elements,
    historyList,
    restore() {
      globalThis.document = previousDocument;
      globalThis.Element = previousElement;
    },
  };
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

function installFetchStub(t, responses) {
  const previousFetch = globalThis.fetch;
  globalThis.fetch = async () => {
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
}

test('FileHistoryViewController renders local changes and commit actions', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);
  installFetchStub(t, [
    {
      body: {
        files: [{
          hasStagedChanges: true,
          hasWorkingTreeChanges: true,
          path: 'README.md',
          status: 'modified',
        }],
        summary: { additions: 3, deletions: 1, filesChanged: 1 },
      },
    },
    {
      body: {
        commits: [{
          additions: 2,
          authorName: 'CollabMD Tests',
          deletions: 1,
          hash: 'abc1234',
          pathAtCommit: 'README.md',
          relativeDateLabel: '1h ago',
          shortHash: 'abc1234',
          status: 'modified',
          subject: 'Update README',
        }],
        hasMore: false,
      },
    },
    {
      body: {
        files: [{
          path: 'README.md',
          stats: { additions: 3, deletions: 1 },
          hunks: [],
        }],
        summary: { additions: 3, deletions: 1, filesChanged: 1 },
      },
    },
    {
      body: {
        commit: {
          hash: 'abc1234',
          shortHash: 'abc1234',
          subject: 'Update README',
        },
        files: [{
          path: 'README.md',
          stats: { additions: 2, deletions: 1 },
          hunks: [],
        }],
        summary: { additions: 2, deletions: 1, filesChanged: 1 },
      },
    },
  ]);

  const events = [];
  const controller = new FileHistoryViewController({
    diffRenderer: {
      mode: 'unified',
      renderDiffDetail(detail) {
        return `<div class="rendered-diff">${detail.path}</div>`;
      },
      renderFileHeader(file) {
        return `<div class="rendered-file-header">${file.path}</div>`;
      },
    },
    onOpenCommitDiff: (hash, { historyFilePath, path }) => events.push(['commit-diff', hash, path, historyFilePath]),
    onOpenFile: (filePath) => events.push(['open-file', filePath]),
    onOpenPreview: ({ hash, path, currentFilePath }) => events.push(['preview', hash, path, currentFilePath]),
    onOpenWorkspaceDiff: (filePath) => events.push(['workspace-diff', filePath]),
  });
  controller.initialize();

  await controller.openFileHistory({ filePath: 'README.md' });

  assert.match(harness.elements.diffContent.innerHTML, /Local changes/);
  assert.match(harness.elements.diffContent.innerHTML, /Update README/);
  assert.match(harness.elements.diffContent.innerHTML, /rendered-diff/);

  harness.elements.diffOpenEditorBtn.dispatch('click');

  const localDiffButton = new FakeElement();
  localDiffButton.closestMap = {
    '[data-file-history-open-selected-diff]': new FakeElement(),
  };
  harness.elements.diffContent.dispatch('click', localDiffButton);

  await controller.selectEntry(controller.getEntries()[1]);

  assert.match(harness.elements.diffContent.innerHTML, /Preview File/);

  const commitDiffButton = new FakeElement();
  commitDiffButton.closestMap = {
    '[data-file-history-open-selected-diff]': new FakeElement(),
  };
  harness.elements.diffContent.dispatch('click', commitDiffButton);

  const previewButton = new FakeElement();
  previewButton.closestMap = {
    '[data-file-history-open-selected-preview]': new FakeElement(),
  };
  harness.elements.diffContent.dispatch('click', previewButton);

  assert.deepEqual(events, [
    ['open-file', 'README.md'],
    ['workspace-diff', 'README.md'],
    ['commit-diff', 'abc1234', 'README.md', 'README.md'],
    ['preview', 'abc1234', 'README.md', 'README.md'],
  ]);
});

test('FileHistoryViewController preserves history list scroll position across selection renders', async (t) => {
  const harness = createHarness();
  t.after(() => harness.restore());
  installWindowStub(t);
  installFetchStub(t, [
    {
      body: {
        files: [],
        summary: { additions: 0, deletions: 0, filesChanged: 0 },
      },
    },
    {
      body: {
        commits: [
          {
            additions: 1,
            authorName: 'CollabMD Tests',
            deletions: 0,
            hash: 'abc1234',
            pathAtCommit: 'README.md',
            relativeDateLabel: '1h ago',
            shortHash: 'abc1234',
            status: 'modified',
            subject: 'First commit',
          },
          {
            additions: 2,
            authorName: 'CollabMD Tests',
            deletions: 1,
            hash: 'def5678',
            pathAtCommit: 'README.md',
            relativeDateLabel: '2h ago',
            shortHash: 'def5678',
            status: 'modified',
            subject: 'Second commit',
          },
        ],
        hasMore: false,
      },
    },
    {
      body: {
        commit: { hash: 'abc1234', shortHash: 'abc1234', subject: 'First commit' },
        files: [{ path: 'README.md', stats: { additions: 1, deletions: 0 }, hunks: [] }],
        summary: { additions: 1, deletions: 0, filesChanged: 1 },
      },
    },
    {
      body: {
        commit: { hash: 'def5678', shortHash: 'def5678', subject: 'Second commit' },
        files: [{ path: 'README.md', stats: { additions: 2, deletions: 1 }, hunks: [] }],
        summary: { additions: 2, deletions: 1, filesChanged: 1 },
      },
    },
  ]);

  const controller = new FileHistoryViewController({
    diffRenderer: {
      mode: 'unified',
      renderDiffDetail() {
        return '<div class="rendered-diff">README.md</div>';
      },
      renderFileHeader(file) {
        return `<div class="rendered-file-header">${file.path}</div>`;
      },
    },
  });
  controller.initialize();

  await controller.openFileHistory({ filePath: 'README.md' });
  harness.historyList.scrollTop = 240;
  harness.historyList.dispatch('scroll', harness.historyList);

  await controller.selectEntry(controller.getEntries()[1]);

  assert.equal(harness.historyList.scrollTop, 240);
});
