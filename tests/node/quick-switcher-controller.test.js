import test from 'node:test';
import assert from 'node:assert/strict';

import { FILE_FILTER_DEBOUNCE_MS, QuickSwitcherController } from '../../src/client/presentation/quick-switcher-controller.js';

function createElementStub({ dataset = {} } = {}) {
  const listeners = new Map();

  return {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    classList: {
      add() {},
      remove() {},
      toggle() {},
    },
    dataset,
    dispatchEvent(event) {
      listeners.get(event.type)?.(event);
    },
    innerHTML: '',
    querySelectorAll() {
      return [];
    },
    setAttribute() {},
    textContent: '',
    value: '',
  };
}

function installDocumentStub(t, { modeTabs = [] } = {}) {
  const elements = new Map([
    ['quickSwitcher', createElementStub()],
    ['quickSwitcherHint', createElementStub()],
    ['quickSwitcherInput', createElementStub()],
    ['quickSwitcherResults', createElementStub()],
  ]);

  const originalDocument = globalThis.document;
  globalThis.document = {
    activeElement: null,
    getElementById(id) {
      return elements.get(id) ?? null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-qs-mode]') {
        return modeTabs;
      }

      return [];
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  return elements;
}

test('QuickSwitcherController keeps a bounded top-30 result set and rebuilds corpus only when files change', (t) => {
  const elements = installDocumentStub(t);
  const firstFileList = Array.from({ length: 40 }, (_, index) => `docs/guide-${String(index).padStart(2, '0')}.md`);
  const secondFileList = [...firstFileList, 'archive/guide-special.md'];
  let currentFiles = firstFileList;

  const controller = new QuickSwitcherController({
    getFileList: () => currentFiles,
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.input.value = 'guide';
  controller.filterFiles();

  assert.equal(controller.fileCorpus.length, 40);
  assert.equal(controller.filteredFiles.length, 30);
  const firstCorpusRef = controller.fileCorpus;

  controller.filterFiles();
  assert.equal(controller.fileCorpus, firstCorpusRef);

  currentFiles = secondFileList;
  controller.filterFiles();

  assert.equal(controller.fileCorpus.length, 41);
  assert.notEqual(controller.fileCorpus, firstCorpusRef);
  assert.equal(controller.filteredFiles.length, 30);

  controller.input.value = 'special';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['archive/guide-special.md']);
});

test('QuickSwitcherController matches query spaces across path separators', (t) => {
  const elements = installDocumentStub(t);
  const controller = new QuickSwitcherController({
    getFileList: () => [
      'RDN/JAWARA/Buy Releaser.excalidraw',
      'RDN/JAWARA/Notification/RDN Buy Release Notification.md',
    ],
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.input.value = 'jawara buy';
  controller.filterFiles();

  assert.deepEqual(controller.filteredFiles, [
    'RDN/JAWARA/Buy Releaser.excalidraw',
    'RDN/JAWARA/Notification/RDN Buy Release Notification.md',
  ]);

  controller.input.value = 'jawara   buy';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, [
    'RDN/JAWARA/Buy Releaser.excalidraw',
    'RDN/JAWARA/Notification/RDN Buy Release Notification.md',
  ]);
});

test('QuickSwitcherController ranks compact fuzzy path matches first', (t) => {
  const elements = installDocumentStub(t);
  const controller = new QuickSwitcherController({
    getFileList: () => [
      'a/a/unrelated/deep/folder/b.md',
      `b/a/${'x'.repeat(100)}/b.md`,
      'z/a/b.md',
    ],
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.input.value = 'ab';
  controller.filterFiles();

  assert.deepEqual(controller.filteredFiles, [
    'z/a/b.md',
    'a/a/unrelated/deep/folder/b.md',
  ]);
});

test('QuickSwitcherController searches file extensions', (t) => {
  const elements = installDocumentStub(t);
  const controller = new QuickSwitcherController({
    getFileList: () => ['docs/guide.pdf', 'notes/guide.md'],
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.input.value = 'pdf';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['docs/guide.pdf']);

  controller.input.value = '.md';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['notes/guide.md']);
});

test('QuickSwitcherController keeps path-only matches visible and reports capped results', (t) => {
  const elements = installDocumentStub(t);
  const files = [
    'Clippings/Vrite.md',
    'Clippings/Other.md',
    ...Array.from({ length: 32 }, (_, index) => `notes/guide-${index}.md`),
  ];
  const controller = new QuickSwitcherController({
    getFileList: () => files,
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.input.value = 'clippings';
  controller.filterFiles();

  assert.equal(controller.fileMatchCount, 2);
  assert.deepEqual(controller.fileMatches.get('Clippings/Vrite.md')?.indices, [
    0, 1, 2, 3, 4, 5, 6, 7, 8,
  ]);
  assert.equal(controller.fileResultsTruncated, false);

  controller.input.value = 'guide';
  controller.filterFiles();

  assert.equal(controller.filteredFiles.length, 30);
  assert.equal(controller.fileMatchCount, 32);
  assert.equal(controller.fileResultsTruncated, true);

  controller.input.value = 'notes';
  controller.filterFiles();

  assert.equal(controller.fileMatchCount, 32);
  assert.equal(controller.fileResultsTruncated, true);

  controller.input.value = '';
  controller.filterFiles();

  assert.equal(controller.filteredFiles.length, 30);
  assert.equal(controller.fileMatchCount, 34);
  assert.equal(controller.fileResultsTruncated, true);
});

test('QuickSwitcherController puts recent files first without overriding relevance', (t) => {
  const elements = installDocumentStub(t);
  const files = [
    'archive/notes.md',
    'projects/alpha.md',
    'projects/beta.md',
    'notes.md',
    'archive.md',
  ];
  const controller = new QuickSwitcherController({
    getFileList: () => files,
    getRecentFiles: () => ['projects/beta.md', 'projects/alpha.md', 'archive/notes.md'],
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, [
    'projects/beta.md',
    'projects/alpha.md',
    'archive/notes.md',
    'notes.md',
    'archive.md',
  ]);

  controller.input.value = 'notes';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['archive/notes.md', 'notes.md']);

  controller.input.value = 'archive';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['archive.md', 'archive/notes.md']);

  controller.input.value = 'projects';
  controller.filterFiles();
  assert.deepEqual(controller.filteredFiles, ['projects/beta.md', 'projects/alpha.md']);
});

test('QuickSwitcherController orders empty results by modified time before recency', (t) => {
  const elements = installDocumentStub(t);
  const files = ['old.md', 'recent-tie.md', 'new.md', 'tie-other.md'];
  const controller = new QuickSwitcherController({
    getFileList: () => files,
    getFileMetadata: () => [
      { mtimeMs: 100, path: 'old.md' },
      { mtimeMs: 200, path: 'recent-tie.md' },
      { mtimeMs: 300, path: 'new.md' },
      { mtimeMs: 200, path: 'tie-other.md' },
    ],
    getRecentFiles: () => ['tie-other.md'],
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.filterFiles();

  assert.deepEqual(controller.filteredFiles, [
    'new.md',
    'tie-other.md',
    'recent-tie.md',
    'old.md',
  ]);
});

test('QuickSwitcherController shows unavailable text search when ripgrep is missing', (t) => {
  const elements = installDocumentStub(t);

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: false, minQueryLength: 2 }),
    onFileSelect() {},
    searchText: async () => {
      throw new Error('should not search without ripgrep');
    },
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.hint = elements.get('quickSwitcherHint');
  controller.resultsList = elements.get('quickSwitcherResults');

  controller.input.value = 'needle';
  controller.setMode('text', { preserveInput: true });

  assert.match(controller.hint.textContent, /requires ripgrep/i);
});

test('QuickSwitcherController preserves the query when switching search modes', (t) => {
  const textTab = createElementStub({ dataset: { qsMode: 'text' } });
  const elements = installDocumentStub(t, { modeTabs: [textTab] });

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
    onFileSelect() {},
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.input.value = 'needle';

  textTab.dispatchEvent({ type: 'click' });

  assert.equal(controller.mode, 'text');
  assert.equal(controller.input.value, 'needle');
});

test('QuickSwitcherController ignores text search results after close', async (t) => {
  const elements = installDocumentStub(t);
  let resolveSearch;
  let markSearchStarted;
  const searchStarted = new Promise((resolve) => {
    markSearchStarted = resolve;
  });
  const searchResult = new Promise((resolve) => {
    resolveSearch = resolve;
  });
  let rendered = false;

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
    onFileSelect() {},
    searchDebounceMs: 0,
    searchText: async () => {
      markSearchStarted();
      return searchResult;
    },
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.hint = elements.get('quickSwitcherHint');
  controller.overlay = elements.get('quickSwitcher');
  controller.resultsList = elements.get('quickSwitcherResults');
  controller.renderTextResults = () => {
    rendered = true;
  };

  controller.isOpen = true;
  controller.input.value = 'needle';
  controller.setMode('text', { preserveInput: true });
  await searchStarted;

  controller.close();
  resolveSearch({
    files: [{
      file: 'README.md',
      kind: 'markdown',
      matchCount: 1,
      snippets: [{
        column: 1,
        line: 1,
        matchEnd: 6,
        matchStart: 0,
        text: 'needle',
      }],
    }],
  });
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(rendered, false);
});

test('QuickSwitcherController confirms text search matches with navigation payload', async (t) => {
  const elements = installDocumentStub(t);
  let selectedMatch = null;

  const controller = new QuickSwitcherController({
    getFileList: () => ['README.md'],
    getSearchConfig: () => ({ available: true, minQueryLength: 2 }),
    onFileSelect() {},
    onTextMatchSelect(match) {
      selectedMatch = match;
    },
    searchDebounceMs: 0,
    searchText: async () => ({
      files: [{
        file: 'diagram.drawio',
        kind: 'drawio',
        matchCount: 1,
        snippets: [{
          column: 4,
          line: 7,
          matchEnd: 9,
          matchStart: 3,
          text: 'abcneedle',
        }],
      }],
    }),
  });

  controller.input = elements.get('quickSwitcherInput');
  controller.hint = elements.get('quickSwitcherHint');
  controller.overlay = elements.get('quickSwitcher');
  controller.resultsList = elements.get('quickSwitcherResults');

  controller.isOpen = true;
  controller.input.value = 'needle';
  controller.setMode('text', { preserveInput: true });
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));

  controller.confirmSelection();

  assert.deepEqual(selectedMatch, {
    column: 4,
    file: 'diagram.drawio',
    kind: 'drawio',
    line: 7,
    matchLength: 6,
    snippet: {
      column: 4,
      line: 7,
      matchEnd: 9,
      matchStart: 3,
      text: 'abcneedle',
    },
  });
});

test('QuickSwitcherController debounces file filtering on input events', async (t) => {
  const elements = installDocumentStub(t);
  const controller = new QuickSwitcherController({
    getFileList: () => ['docs/guide.md', 'notes/todo.md'],
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');
  controller.isOpen = true;

  controller.input.value = 'gui';
  elements.get('quickSwitcherInput').dispatchEvent({ type: 'input' });
  assert.deepEqual(controller.filteredFiles, []);

  controller.input.value = 'guide';
  elements.get('quickSwitcherInput').dispatchEvent({ type: 'input' });
  await new Promise((resolve) => setTimeout(resolve, FILE_FILTER_DEBOUNCE_MS + 100));

  assert.deepEqual(controller.filteredFiles, ['docs/guide.md']);
});

test('QuickSwitcherController indexes the corpus and caches metadata ranks until inputs change', (t) => {
  const elements = installDocumentStub(t);
  const fileMetadata = [
    { mtimeMs: 2, path: 'b.md' },
    { mtimeMs: 1, path: 'a.md' },
  ];
  const recentFiles = ['a.md'];
  const controller = new QuickSwitcherController({
    getFileList: () => ['a.md', 'b.md'],
    getFileMetadata: () => fileMetadata,
    getRecentFiles: () => recentFiles,
    onFileSelect() {},
  });
  controller.renderResults = () => {};
  controller.input = elements.get('quickSwitcherInput');

  controller.filterFiles();

  assert.equal(controller.fileCorpusByPath.get('a.md')?.lowerPath, 'a.md');
  assert.deepEqual(controller.filteredFiles, ['b.md', 'a.md']);
  const modifiedTimes = controller.cachedModifiedTimes;
  const recentRanks = controller.cachedRecentRanks;

  controller.filterFiles();

  assert.equal(controller.cachedModifiedTimes, modifiedTimes);
  assert.equal(controller.cachedRecentRanks, recentRanks);
});
