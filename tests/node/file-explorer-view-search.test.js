import test from 'node:test';
import assert from 'node:assert/strict';

import { FILE_TREE_SEARCH_DEBOUNCE_MS, FileExplorerView } from '../../src/client/presentation/file-explorer-view.js';

function installDocumentStub(t) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      classList: {
        add() {},
        remove() {},
      },
    },
    getElementById() {
      return null;
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });
}

function createView({ onSearchChange } = {}) {
  const view = new FileExplorerView({
    mobileBreakpointQuery: {},
    onSearchChange,
  });
  view.searchInput = { value: '' };
  view.treeContainer = { dataset: {}, innerHTML: '' };
  return view;
}

test('FileExplorerView debounces search commits to the last value', async (t) => {
  installDocumentStub(t);
  const committed = [];
  const view = createView({ onSearchChange: (value) => committed.push(value) });

  view.handleSearchInput('a');
  view.handleSearchInput('ab');
  assert.deepEqual(committed, []);

  await new Promise((resolve) => setTimeout(resolve, FILE_TREE_SEARCH_DEBOUNCE_MS + 100));
  assert.deepEqual(committed, ['ab']);
});

test('FileExplorerView preserves uncommitted keystrokes across external renders', (t) => {
  installDocumentStub(t);
  const view = createView({ onSearchChange: () => {} });

  view.searchInput.value = 'abc';
  view.pendingSearchValue = 'abc';
  view.render({ expandedDirs: new Set(), searchMatches: [], searchQuery: 'a', tree: [] });
  assert.equal(view.searchInput.value, 'abc');

  view.cancelPendingSearch();
  view.render({ expandedDirs: new Set(), searchMatches: [], searchQuery: '', tree: [] });
  assert.equal(view.searchInput.value, '');
});

test('FileExplorerView drops a cancelled search instead of committing it', async (t) => {
  installDocumentStub(t);
  const committed = [];
  const view = createView({ onSearchChange: (value) => committed.push(value) });

  view.handleSearchInput('ab');
  view.cancelPendingSearch();

  await new Promise((resolve) => setTimeout(resolve, FILE_TREE_SEARCH_DEBOUNCE_MS + 100));
  assert.deepEqual(committed, []);
});
