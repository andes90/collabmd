import test from 'node:test';
import assert from 'node:assert/strict';

import { BasesPreviewController } from '../../src/client/presentation/bases-preview-controller.js';

function createPlaceholder() {
  const classes = new Set(['bases-embed-placeholder', 'diagram-preview-shell']);
  return {
    classList: {
      add(...tokens) {
        tokens.forEach((token) => classes.add(token));
      },
      contains(token) {
        return classes.has(token);
      },
      remove(...tokens) {
        tokens.forEach((token) => classes.delete(token));
      },
    },
    innerHTML: '',
    isConnected: true,
  };
}

function createBaseResult({
  cell,
  columns = [{ id: 'note.value', label: 'Value' }],
  label = 'Row',
  meta = null,
  totalRows = 1,
  type = 'table',
} = {}) {
  return {
    columns,
    groups: [{
      key: 'All',
      label: 'All',
      rows: [{
        cells: {
          'note.value': cell ?? { text: label, type: 'string', value: label },
        },
        path: `notes/${label.toLowerCase()}.md`,
      }],
      summaries: [],
      value: { text: '', type: 'empty', value: null },
    }],
    rows: [],
    summaries: [],
    totalRows,
    meta: meta ?? {
      activeViewConfig: {
        filters: null,
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
    view: {
      id: 'view-0',
      name: 'Table',
      supported: true,
      type,
    },
    views: [{
      id: 'view-0',
      name: 'Table',
      supported: true,
      type,
    }],
  };
}

function createDeferred() {
  let resolve;
  let reject;
  const promise = new Promise((nextResolve, nextReject) => {
    resolve = nextResolve;
    reject = nextReject;
  });
  return { promise, reject, resolve };
}

function createWindowStub() {
  return {
    __COLLABMD_CONFIG__: { basePath: '' },
    location: {
      origin: 'http://localhost:5555',
    },
  };
}

class FakeShellNode {
  constructor() {
    this.innerHTML = '';
    this.textContent = '';
    this.value = '';
    this.querySelectorMap = new Map();
  }

  querySelector(selector) {
    return this.querySelectorMap.get(selector) ?? null;
  }
}

class FakeInputNode {
  constructor() {
    this.selectionEnd = 0;
    this.selectionStart = 0;
    this.value = '';
    this.focused = false;
  }

  focus() {
    this.focused = true;
    if (globalThis.document) {
      globalThis.document.activeElement = this;
    }
  }

  setSelectionRange(start, end) {
    this.selectionStart = start;
    this.selectionEnd = end;
  }
}

class FakePanelSlotNode {
  constructor() {
    this._innerHTML = '';
    this.filterValues = new Map();
    this.propertiesList = null;
    this.propertiesSearch = null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.filterValues = new Map();
    if (this._innerHTML.includes('data-base-properties-list')) {
      this.propertiesList = { scrollTop: 0 };
      const search = new FakeInputNode();
      search.value = this._innerHTML.match(/data-base-properties-search[^>]*value="([^"]*)"/u)?.[1] ?? '';
      search.selectionStart = search.value.length;
      search.selectionEnd = search.value.length;
      this.propertiesSearch = search;
    } else {
      this.propertiesList = null;
      this.propertiesSearch = null;
    }

    const filterInputMatches = this._innerHTML.matchAll(/<input[^>]*data-base-filter-value="([^"]+)"[^>]*>/gu);
    for (const match of filterInputMatches) {
      const tag = match[0] ?? '';
      const path = match[1] ?? '';
      const input = new FakeInputNode();
      input.dataset = { baseFilterValue: path };
      input.value = tag.match(/value="([^"]*)"/u)?.[1] ?? '';
      input.selectionStart = input.value.length;
      input.selectionEnd = input.value.length;
      this.filterValues.set(path, input);
    }
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (selector === '[data-base-properties-list]') {
      return this.propertiesList;
    }
    if (selector === '[data-base-properties-search]') {
      return this.propertiesSearch;
    }
    if (selector === '[data-base-filter-value]') {
      return this.filterValues.values().next().value ?? null;
    }
    const filterValueMatch = selector.match(/^\[data-base-filter-value="([^"]+)"\]$/u);
    if (filterValueMatch) {
      return this.filterValues.get(filterValueMatch[1]) ?? null;
    }
    return null;
  }
}

class FakeRenderedPlaceholder {
  constructor() {
    const classes = new Set(['bases-embed-placeholder', 'diagram-preview-shell']);
    this.classList = {
      add: (...tokens) => {
        tokens.forEach((token) => classes.add(token));
      },
      contains: (token) => classes.has(token),
      remove: (...tokens) => {
        tokens.forEach((token) => classes.delete(token));
      },
    };
    this.isConnected = true;
    this.renderCount = 0;
    this._innerHTML = '';
    this.shell = null;
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.renderCount += 1;

    const shellKeyMatch = this._innerHTML.match(/data-base-shell-key="([^"]+)"/u);
    if (!shellKeyMatch) {
      return;
    }

    const shell = new FakeShellNode();
    const tabs = new FakeShellNode();
    const meta = new FakeShellNode();
    const panelSlot = new FakePanelSlotNode();
    const summarySlot = new FakeShellNode();
    const content = new FakeShellNode();
    const input = new FakeShellNode();

    input.value = this._innerHTML.match(/class="bases-search-input" type="search" value="([^"]*)"/u)?.[1] ?? '';
    meta.textContent = this._innerHTML.match(/data-base-meta>([^<]*)</u)?.[1] ?? '';
    // Test-only fake DOM hydration from controller-owned markup.
    // pi-lens-ignore: no-inner-html-js
    panelSlot.innerHTML = this._innerHTML.match(/<div class="bases-panels" data-base-panel-slot>([\s\S]*?)<\/div>\s*<div data-base-summary-slot>/u)?.[1] ?? '';

    shell.querySelectorMap.set('[data-base-tabs]', tabs);
    shell.querySelectorMap.set('[data-base-meta]', meta);
    shell.querySelectorMap.set('[data-base-panel-slot]', panelSlot);
    shell.querySelectorMap.set('[data-base-summary-slot]', summarySlot);
    shell.querySelectorMap.set('[data-base-content]', content);
    shell.querySelectorMap.set('.bases-search-input', input);

    this.shell = shell;
    this.shellKey = shellKeyMatch[1];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  querySelector(selector) {
    if (!this.shell) {
      return null;
    }

    if (selector === '.bases-shell') {
      return this.shell;
    }

    if (selector === `[data-base-shell-key="${this.shellKey}"]`) {
      return this.shell;
    }

    return null;
  }
}

test('BasesPreviewController ignores stale query responses when newer renders finish later', async () => {
  const first = createDeferred();
  const second = createDeferred();
  const controller = new BasesPreviewController({
    vaultApiClient: {
      queryBase() {
        return [first.promise, second.promise].shift();
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'base-entry',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  const queuedResponses = [first.promise, second.promise];
  controller.vaultApiClient.queryBase = () => queuedResponses.shift();

  const firstRender = controller.renderEntry(entry);
  entry.payload.search = 'newer';
  const secondRender = controller.renderEntry(entry);

  second.resolve({ result: createBaseResult({ label: 'Newest', totalRows: 2 }) });
  await secondRender;
  assert.match(placeholder.innerHTML, /2 results/);
  assert.match(placeholder.innerHTML, /Newest/);

  first.resolve({ result: createBaseResult({ label: 'Older', totalRows: 1 }) });
  await firstRender;

  assert.match(placeholder.innerHTML, /2 results/);
  assert.match(placeholder.innerHTML, /Newest/);
  assert.doesNotMatch(placeholder.innerHTML, /Older/);
});

test('BasesPreviewController renders typed image cells through the attachment endpoint', async () => {
  const originalWindow = globalThis.window;
  globalThis.window = createWindowStub();
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            cell: {
              path: 'notes/images/cover.png',
              text: 'images/cover.png',
              type: 'image',
              value: 'notes/images/cover.png',
            },
          }),
        };
      },
    },
  });
  try {
  const placeholder = createPlaceholder();
  const entry = {
    key: 'image-entry',
    payload: {
      path: 'views/gallery.base',
      search: '',
      source: null,
      sourcePath: 'views/gallery.base',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /bases-inline-image/);
  assert.match(placeholder.innerHTML, /\/api\/attachment\?path=notes%2Fimages%2Fcover\.png/);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('BasesPreviewController removes the placeholder shell chrome after hydration', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({ label: 'Hydrated', totalRows: 2 }),
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'hydrated-entry',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.equal(placeholder.classList.contains('diagram-preview-shell'), false);
  assert.equal(placeholder.classList.contains('is-hydrated'), true);
});

test('BasesPreviewController renders file name cells as open-file buttons', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: {
            columns: [{ id: 'file.name', label: 'Name' }],
            groups: [{
              key: 'All',
              label: 'All',
              rows: [{
                cells: {
                  'file.name': {
                    text: 'alpha.md',
                    type: 'string',
                    value: 'alpha.md',
                  },
                },
                path: 'notes/alpha.md',
              }],
              summaries: [],
              value: { text: '', type: 'empty', value: null },
            }],
            rows: [],
            summaries: [],
            totalRows: 1,
            view: {
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            },
            views: [{
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            }],
          },
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'filename-entry',
    payload: {
      path: 'views/files.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /data-base-open-file="notes\/alpha\.md"/);
  assert.match(placeholder.innerHTML, /bases-link-button/);
  assert.match(placeholder.innerHTML, />alpha\.md</);
});

test('BasesPreviewController renders list link items as open-file buttons', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: {
            columns: [{ id: 'file.links', label: 'Links' }],
            groups: [{
              key: 'All',
              label: 'All',
              rows: [{
                cells: {
                  'file.links': {
                    items: [
                      {
                        path: 'notes/target-a.md',
                        text: 'target-a.md',
                        type: 'link',
                        value: 'target-a.md',
                      },
                      {
                        path: 'notes/target-b.md',
                        text: 'target-b.md',
                        type: 'file',
                        value: 'target-b.md',
                      },
                    ],
                    text: 'target-a.md, target-b.md',
                    type: 'list',
                    value: ['target-a.md', 'target-b.md'],
                  },
                },
                path: 'notes/source.md',
              }],
              summaries: [],
              value: { text: '', type: 'empty', value: null },
            }],
            rows: [],
            summaries: [],
            totalRows: 1,
            view: {
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            },
            views: [{
              id: 'view-0',
              name: 'Table',
              supported: true,
              type: 'table',
            }],
          },
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'list-links-entry',
    payload: {
      path: 'views/links.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /data-base-open-file="notes\/target-a\.md"/);
  assert.match(placeholder.innerHTML, /data-base-open-file="notes\/target-b\.md"/);
  assert.match(placeholder.innerHTML, /bases-value-pill/);
});

test('BasesPreviewController preserves the shell during search rerenders', async () => {
  const responses = [
    { result: createBaseResult({ label: 'Initial', totalRows: 1 }) },
    { result: createBaseResult({ label: 'Filtered', totalRows: 2 }) },
  ];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return responses.shift();
      },
    },
  });
  const placeholder = new FakeRenderedPlaceholder();
  const entry = {
    key: 'search-entry',
    payload: {
      path: 'views/search.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);
  assert.equal(placeholder.renderCount, 2);

  const firstInput = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('.bases-search-input');
  const firstContent = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('[data-base-content]');

  entry.search = 'Filtered';
  entry.payload.search = 'Filtered';
  await controller.renderEntry(entry);

  const secondInput = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('.bases-search-input');
  const secondContent = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('[data-base-content]');
  const meta = placeholder.querySelector('[data-base-shell-key="search-entry"]').querySelector('[data-base-meta]');

  assert.equal(placeholder.renderCount, 2);
  assert.equal(secondInput, firstInput);
  assert.equal(secondInput.value, 'Filtered');
  assert.equal(secondContent, firstContent);
  assert.match(secondContent.innerHTML, /Filtered/);
  assert.equal(meta.textContent, '2 results');
});

test('BasesPreviewController applies transformed standalone base source through the session callback', async () => {
  const transformed = {
    result: createBaseResult({ label: 'Updated', totalRows: 2 }),
    source: 'views:\n  - type: table\n',
  };
  const calls = [];
  const controller = new BasesPreviewController({
    replaceBaseSource(payload) {
      calls.push(['replace', payload.path, payload.source]);
    },
    vaultApiClient: {
      async transformBase() {
        return { result: transformed };
      },
    },
  });
  const entry = {
    key: 'standalone',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    requestVersion: 0,
    result: createBaseResult({ label: 'Before' }),
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: '',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.updateViewConfig(entry, (config) => config);

  assert.deepEqual(calls, [['replace', 'views/tasks.base', 'views:\n  - type: table\n']]);
  assert.equal(entry.payload.source, 'views:\n  - type: table\n');
  assert.equal(entry.result.totalRows, 2);
});

test('BasesPreviewController renders inline base editing controls as read-only', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: null,
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: false,
            },
          }),
        };
      },
    },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'inline-entry',
    payload: {
      path: '',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'notes/source.md',
      view: '',
    },
    placeholder,
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'sort',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);

  assert.match(placeholder.innerHTML, /Inline base previews are read-only/);
  assert.match(placeholder.innerHTML, /data-base-panel="sort" disabled/);
});

test('BasesPreviewController names generated sort, group, and filter controls', async () => {
  const result = createBaseResult();
  result.meta.activeViewConfig.groupBy = { direction: 'asc', property: 'note.value' };
  result.meta.activeViewConfig.sort = [{ direction: 'asc', property: 'note.value' }];
  result.meta.activeViewConfig.filters = 'note.value == "Row"';
  const controller = new BasesPreviewController({
    vaultApiClient: { queryBase: async () => ({ result }) },
  });
  const placeholder = createPlaceholder();
  const entry = {
    key: 'accessible-controls',
    payload: { path: 'views/tasks.base', search: '', sourcePath: 'views/tasks.base', view: '' },
    placeholder,
    requestVersion: 0,
    ui: { filterMode: 'builder', openPanel: 'sort', propertySearch: '', rawFilterText: '' },
  };

  await controller.renderEntry(entry);
  assert.match(placeholder.innerHTML, /aria-label="Group by property"/);
  assert.match(placeholder.innerHTML, /aria-label="Sort rule 1 property"/);
  assert.match(placeholder.innerHTML, /aria-label="Move sort rule 1 up"/);
  assert.match(placeholder.innerHTML, /aria-label="Delete sort rule 1"/);

  entry.ui.openPanel = 'filter';
  await controller.renderEntry(entry);
  assert.match(placeholder.innerHTML, /aria-label="Filter 1 property"/);
  assert.match(placeholder.innerHTML, /aria-label="Filter 1 operator"/);
  assert.match(placeholder.innerHTML, /aria-label="Filter 1 value"/);
  assert.match(placeholder.innerHTML, /aria-label="Delete filter 1"/);
});

test('BasesPreviewController marks implicitly visible properties as checked in the properties panel', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            columns: [
              { id: 'file.name', label: 'Name' },
              { id: 'note.value', label: 'Value' },
            ],
            meta: {
              activeViewConfig: {
                filters: null,
                groupBy: null,
                order: [],
                sort: [],
              },
              availableProperties: [
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'file.name',
                  kind: 'file',
                  label: 'Name',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.extra',
                  kind: 'note',
                  label: 'Extra',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: false,
                },
              ],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'properties-entry',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder: createPlaceholder(),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'properties',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);

  assert.match(entry.placeholder.innerHTML, /data-base-property-toggle="file\.name" checked/);
  assert.match(entry.placeholder.innerHTML, /data-base-property-toggle="note\.value" checked/);
  assert.doesNotMatch(entry.placeholder.innerHTML, /data-base-property-toggle="note\.extra" checked/);
});

test('BasesPreviewController preserves implicit columns when enabling a new property', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: createBaseResult({
            columns: [
              { id: 'file.name', label: 'Name' },
              { id: 'note.value', label: 'Value' },
              { id: 'note.extra', label: 'Extra' },
            ],
            meta: {
              activeViewConfig: payload.mutation.config,
              availableProperties: [
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'file.name',
                  kind: 'file',
                  label: 'Name',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.extra',
                  kind: 'note',
                  label: 'Extra',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
              ],
              editable: true,
            },
          }),
        };
      },
      async writeFile() {},
    },
  });
  const entry = {
    key: 'implicit-toggle',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      columns: [
        { id: 'file.name', label: 'Name' },
        { id: 'note.value', label: 'Value' },
      ],
      meta: {
        activeViewConfig: {
          filters: null,
          groupBy: null,
          order: [],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'file.name',
            kind: 'file',
            label: 'Name',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.value',
            kind: 'note',
            label: 'Value',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.extra',
            kind: 'note',
            label: 'Extra',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: false,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      filterMode: 'builder',
      openPanel: 'properties',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const propertyToggle = {
    checked: true,
    dataset: { basePropertyToggle: 'note.extra' },
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-property-toggle]':
            return propertyToggle;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls[0].mutation.config.order, [
    'file.name',
    'note.value',
    'note.extra',
  ]);
});

test('BasesPreviewController resets filter operator and value when switching properties', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBasePropertyValues() {
        return { result: { values: [] } };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [
                  {
                    filterOperators: ['contains', 'does not contain'],
                    groupable: true,
                    id: 'note.title',
                    kind: 'note',
                    label: 'Title',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['>', '<', 'is empty'],
                    groupable: true,
                    id: 'note.score',
                    kind: 'note',
                    label: 'Score',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'number',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'filter-property-operator-sync',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      meta: {
        activeViewConfig: {
          filters: 'note.title.contains("done")',
          groupBy: null,
          order: ['note.title'],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['contains', 'does not contain'],
            groupable: true,
            id: 'note.title',
            kind: 'note',
            label: 'Title',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['>', '<', 'is empty'],
            groupable: true,
            id: 'note.score',
            kind: 'note',
            label: 'Score',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'number',
            visible: true,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterProperty = {
    dataset: { baseFilterProperty: '0' },
    value: 'note.score',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-property]':
            return filterProperty;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    and: ['note.score > ""'],
  });
  assert.equal(entry.ui.builderFilter.children[0].propertyId, 'note.score');
  assert.equal(entry.ui.builderFilter.children[0].operator, '>');
  assert.equal(entry.ui.builderFilter.children[0].value, '');
});

test('BasesPreviewController resets filter state even when the next property supports the same operator', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBasePropertyValues() {
        return { result: { values: [] } };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [
                  {
                    filterOperators: ['contains', 'does not contain'],
                    groupable: true,
                    id: 'note.title',
                    kind: 'note',
                    label: 'Title',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['contains', 'does not contain'],
                    groupable: true,
                    id: 'note.tags',
                    kind: 'note',
                    label: 'Tags',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'filter-property-reset-same-operator',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      meta: {
        activeViewConfig: {
          filters: 'note.title.contains("done")',
          groupBy: null,
          order: ['note.title'],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['contains', 'does not contain'],
            groupable: true,
            id: 'note.title',
            kind: 'note',
            label: 'Title',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['contains', 'does not contain'],
            groupable: true,
            id: 'note.tags',
            kind: 'note',
            label: 'Tags',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: {
        children: [{
          operator: 'does not contain',
          propertyId: 'note.title',
          type: 'rule',
          value: 'done',
        }],
        conjunction: 'and',
        type: 'group',
      },
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterProperty = {
    dataset: { baseFilterProperty: '0' },
    value: 'note.tags',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-property]':
            return filterProperty;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    and: ['note.tags.contains("")'],
  });
  assert.equal(entry.ui.builderFilter.children[0].propertyId, 'note.tags');
  assert.equal(entry.ui.builderFilter.children[0].operator, 'contains');
  assert.equal(entry.ui.builderFilter.children[0].value, '');
});

test('BasesPreviewController preserves properties search focus while typing', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const controller = new BasesPreviewController({
      vaultApiClient: {
        async queryBase() {
          return {
            result: createBaseResult({
              columns: [
                { id: 'file.name', label: 'Name' },
                { id: 'note.value', label: 'Value' },
              ],
              meta: {
                activeViewConfig: {
                  filters: null,
                  groupBy: null,
                  order: ['file.name', 'note.value'],
                  sort: [],
                },
                availableProperties: [
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'file.name',
                    kind: 'file',
                    label: 'Name',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'note.value',
                    kind: 'note',
                    label: 'Value',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
          };
        },
      },
    });
    const placeholder = new FakeRenderedPlaceholder();
    const entry = {
      key: 'properties-search-focus',
      payload: {
        path: 'views/tasks.base',
        search: '',
        source: null,
        sourcePath: '',
        view: '',
      },
      placeholder,
      propertyValueOptions: new Map(),
      requestVersion: 0,
      result: null,
      search: '',
      ui: {
        builderFilter: null,
        filterMode: 'builder',
        openPanel: 'properties',
        propertySearch: '',
        rawFilterText: '',
      },
    };
    controller.entries.set(entry.key, entry);

    await controller.renderEntry(entry);

    const renderedShell = placeholder.querySelector('[data-base-shell-key="properties-search-focus"]');
    const panelSlot = renderedShell.querySelector('[data-base-panel-slot]');
    const contentSlot = renderedShell.querySelector('[data-base-content]');
    contentSlot.innerHTML = 'stable-results-body';
    const searchInput = panelSlot.querySelector('[data-base-properties-search]');
    searchInput.value = 'n';
    searchInput.selectionStart = 1;
    searchInput.selectionEnd = 1;
    searchInput.focus();

    const shell = {
      dataset: { baseShellKey: entry.key },
      closest(selector) {
        return selector === '[data-base-shell-key]' ? this : null;
      },
    };
    searchInput.closest = (selector) => (selector === '[data-base-shell-key]' ? shell : null);

    controller.handleInput({
      target: {
        closest(selector) {
          switch (selector) {
            case '.bases-search-input':
              return null;
            case '[data-base-properties-search]':
              return searchInput;
            default:
              return null;
          }
        },
      },
    });

    const nextSearchInput = panelSlot.querySelector('[data-base-properties-search]');
    assert.equal(entry.ui.propertySearch, 'n');
    assert.equal(contentSlot.innerHTML, 'stable-results-body');
    assert.equal(globalThis.document.activeElement, nextSearchInput);
    assert.equal(nextSearchInput.selectionStart, 1);
    assert.equal(nextSearchInput.selectionEnd, 1);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('BasesPreviewController filters property suggestions while typing a filter value', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: 'note.value == ""',
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'typing-filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
          { count: 1, text: 'Todo', value: 'Todo' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  await controller.renderEntry(entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterInput = {
    dataset: { baseFilterValue: '0' },
    value: 'doi',
    closest(selector) {
      return selector === '[data-base-shell-key]' ? shell : null;
    },
  };

  controller.handleInput({
    target: {
      closest(selector) {
        switch (selector) {
          case '.bases-search-input':
            return null;
          case '[data-base-properties-search]':
            return null;
          case '[data-base-filter-advanced]':
            return null;
          case '[data-base-filter-value]':
            return filterInput;
          default:
            return null;
        }
      },
    },
  });

  assert.equal(entry.ui.builderFilter.children[0].value, 'doi');
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Doing"/);
  assert.doesNotMatch(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Done"/);
  assert.doesNotMatch(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Todo"/);
});

test('BasesPreviewController preserves filter value focus and selection while typing', async () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: null };
  try {
    const controller = new BasesPreviewController({
      vaultApiClient: {
        async queryBase() {
          return {
            result: createBaseResult({
              meta: {
                activeViewConfig: {
                  filters: 'note.value == ""',
                  groupBy: null,
                  order: ['note.value'],
                  sort: [],
                },
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
          };
        },
      },
    });
    const placeholder = new FakeRenderedPlaceholder();
    const entry = {
      key: 'filter-value-focus',
      payload: {
        path: 'views/tasks.base',
        search: '',
        source: 'views:\n  - type: table\n',
        sourcePath: 'views/tasks.base',
        view: '',
      },
      placeholder,
      propertyValueOptions: new Map([
        ['note.value', {
          cacheKey: JSON.stringify({
            filters: null,
            path: 'views/tasks.base',
            source: 'views:\n  - type: table\n',
            sourcePath: 'views/tasks.base',
            view: 'view-0',
          }),
          values: [
            { count: 4, text: 'Done', value: 'Done' },
            { count: 2, text: 'Doing', value: 'Doing' },
          ],
        }],
      ]),
      requestVersion: 0,
      result: null,
      search: '',
      ui: {
        builderFilter: null,
        filterMode: 'builder',
        openPanel: 'filter',
        propertySearch: '',
        rawFilterText: '',
      },
    };
    controller.entries.set(entry.key, entry);

    await controller.renderEntry(entry);

    const panelSlot = placeholder.querySelector('[data-base-shell-key="filter-value-focus"]').querySelector('[data-base-panel-slot]');
    const filterInput = panelSlot.querySelector('[data-base-filter-value="0"]');
    filterInput.value = 'doi';
    filterInput.selectionStart = 3;
    filterInput.selectionEnd = 3;
    filterInput.focus();

    const shell = {
      dataset: { baseShellKey: entry.key },
      closest(selector) {
        return selector === '[data-base-shell-key]' ? this : null;
      },
    };
    filterInput.closest = (selector) => (selector === '[data-base-shell-key]' ? shell : null);

    controller.handleInput({
      target: {
        closest(selector) {
          switch (selector) {
            case '.bases-search-input':
              return null;
            case '[data-base-properties-search]':
              return null;
            case '[data-base-filter-advanced]':
              return null;
            case '[data-base-filter-value]':
              return filterInput;
            default:
              return null;
          }
        },
      },
    });

    const nextFilterInput = panelSlot.querySelector('[data-base-filter-value="0"]');
    assert.equal(entry.ui.builderFilter.children[0].value, 'doi');
    assert.equal(globalThis.document.activeElement, nextFilterInput);
    assert.equal(nextFilterInput.selectionStart, 3);
    assert.equal(nextFilterInput.selectionEnd, 3);
    assert.match(panelSlot.innerHTML, /data-base-filter-suggestion-value="Doing"/);
  } finally {
    globalThis.document = previousDocument;
  }
});

test('BasesPreviewController preserves properties-list scroll position when toggling a property', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            columns: [
              { id: 'file.name', label: 'Name' },
              { id: 'note.value', label: 'Value' },
            ],
            meta: {
              activeViewConfig: {
                filters: null,
                groupBy: null,
                order: ['file.name', 'note.value'],
                sort: [],
              },
              availableProperties: [
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'file.name',
                  kind: 'file',
                  label: 'Name',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                },
                {
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.extra',
                  kind: 'note',
                  label: 'Extra',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: false,
                },
              ],
              editable: true,
            },
          }),
        };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              columns: [
                { id: 'file.name', label: 'Name' },
                { id: 'note.value', label: 'Value' },
                { id: 'note.extra', label: 'Extra' },
              ],
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'file.name',
                    kind: 'file',
                    label: 'Name',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'note.value',
                    kind: 'note',
                    label: 'Value',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['is', 'is not'],
                    groupable: true,
                    id: 'note.extra',
                    kind: 'note',
                    label: 'Extra',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
      async writeFile() {},
    },
  });
  const placeholder = new FakeRenderedPlaceholder();
  const entry = {
    key: 'properties-scroll',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder,
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      columns: [
        { id: 'file.name', label: 'Name' },
        { id: 'note.value', label: 'Value' },
      ],
      meta: {
        activeViewConfig: {
          filters: null,
          groupBy: null,
          order: ['file.name', 'note.value'],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'file.name',
            kind: 'file',
            label: 'Name',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.value',
            kind: 'note',
            label: 'Value',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['is', 'is not'],
            groupable: true,
            id: 'note.extra',
            kind: 'note',
            label: 'Extra',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: false,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'properties',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  await controller.renderEntry(entry);
  const panelSlot = placeholder.querySelector('[data-base-shell-key="properties-scroll"]').querySelector('[data-base-panel-slot]');
  const propertiesList = panelSlot.querySelector('[data-base-properties-list]');
  propertiesList.scrollTop = 240;

  const shell = { dataset: { baseShellKey: entry.key } };
  const propertyToggle = {
    checked: true,
    dataset: { basePropertyToggle: 'note.extra' },
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-property-toggle]':
            return propertyToggle;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(transformCalls[0].mutation.config.order.includes('note.extra'), true);
  assert.equal(panelSlot.querySelector('[data-base-properties-list]').scrollTop, 240);
});

test('BasesPreviewController preserves empty filter group conjunction selections in the builder UI', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'empty-filter-conjunction',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult(),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterConjunction = {
    dataset: { baseFilterConjunction: '' },
    value: 'or',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-conjunction]':
            return filterConjunction;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(transformCalls[0].mutation.config.filters, null);
  assert.match(entry.placeholder.innerHTML, /<option value="or" selected>Any of the following are true<\/option>/);
});

test('BasesPreviewController serializes not filter groups as arrays', async () => {
  const transformCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'not-filter-array',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      meta: {
        activeViewConfig: {
          filters: {
            not: [
              'note.value == "before"',
            ],
          },
          groupBy: null,
          order: ['note.value'],
          sort: [],
        },
        availableProperties: [{
          filterOperators: ['is', 'is not'],
          groupable: true,
          id: 'note.value',
          kind: 'note',
          label: 'Value',
          sortable: true,
          sortDirections: [{ id: 'asc', label: 'A → Z' }],
          valueType: 'text',
          visible: true,
        }],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterConjunction = {
    dataset: { baseFilterConjunction: '' },
    value: 'not',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-conjunction]':
            return filterConjunction;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    not: ['note.value == "before"'],
  });
});

test('BasesPreviewController parses nested not filter objects into builder state', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: {
                  not: {
                    or: [
                      'note.value == "before"',
                    ],
                  },
                },
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'parse-nested-not-filter',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: null,
      sourcePath: '',
      view: '',
    },
    placeholder: createPlaceholder(),
    requestVersion: 0,
    result: null,
    search: '',
  };

  await controller.renderEntry(entry);

  assert.deepEqual(entry.ui.builderFilter, {
    children: [{
      operator: 'is',
      propertyId: 'note.value',
      type: 'rule',
      value: 'before',
    }],
    conjunction: 'not',
    type: 'group',
  });
});

test('BasesPreviewController renders custom filter value suggestions and applies selection', async () => {
  const transformCalls = [];
  const baseResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == "Do"',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
  });
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return { result: baseResult };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  await controller.renderEntry(entry);

  assert.match(entry.placeholder.innerHTML, /bases-filter-suggestion-list/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Done"/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Doing"/);
  assert.doesNotMatch(entry.placeholder.innerHTML, /<datalist/);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterSuggestion = {
    dataset: {
      baseFilterSuggestion: '0',
      baseFilterSuggestionValue: 'Doing',
    },
  };

  controller.handleClick({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-suggestion]':
            return filterSuggestion;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    and: ['note.value == "Doing"'],
  });
});

test('BasesPreviewController applies filter suggestions on pointer down before blur can consume the first click', async () => {
  const transformCalls = [];
  const baseResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == "Do"',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
  });
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return { result: baseResult };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'pointerdown-filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  await controller.renderEntry(entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterSuggestion = {
    dataset: {
      baseFilterSuggestion: '0',
      baseFilterSuggestionValue: 'Doing',
    },
  };
  let prevented = false;

  controller.handlePointerDown({
    preventDefault() {
      prevented = true;
    },
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-suggestion]':
            return filterSuggestion;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.equal(prevented, true);
  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    and: ['note.value == "Doing"'],
  });
});

test('BasesPreviewController does not let a stale filter input change override a clicked suggestion', async () => {
  const transformCalls = [];
  const baseResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == ""',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
  });
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return { result: baseResult };
      },
      async transformBase(payload) {
        transformCalls.push(payload);
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [{
                  filterOperators: ['is', 'is not'],
                  groupable: true,
                  id: 'note.value',
                  kind: 'note',
                  label: 'Value',
                  sortable: true,
                  sortDirections: [{ id: 'asc', label: 'A → Z' }],
                  valueType: 'text',
                  visible: true,
                }],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'stale-change-after-suggestion',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);

  await controller.renderEntry(entry);

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterInput = {
    dataset: { baseFilterValue: '0' },
    value: 'Do',
    closest(selector) {
      return selector === '[data-base-shell-key]' ? shell : null;
    },
  };

  controller.handleInput({
    target: {
      closest(selector) {
        switch (selector) {
          case '.bases-search-input':
            return null;
          case '[data-base-properties-search]':
            return null;
          case '[data-base-filter-advanced]':
            return null;
          case '[data-base-filter-value]':
            return filterInput;
          default:
            return null;
        }
      },
    },
  });

  const filterSuggestion = {
    dataset: {
      baseFilterSuggestion: '0',
      baseFilterSuggestionValue: 'Doing',
    },
  };

  controller.handlePointerDown({
    preventDefault() {},
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-suggestion]':
            return filterSuggestion;
          default:
            return null;
        }
      },
    },
  });

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-value]':
            return filterInput;
          default:
            return null;
        }
      },
    },
  });

  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(transformCalls.at(-1).mutation.config.filters, {
    and: ['note.value == "Doing"'],
  });
});

test('BasesPreviewController reuses property suggestions while typing the same property filter', async () => {
  let currentResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == "Do"',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
  });
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return { result: currentResult };
      },
    },
  });
  const entry = {
    key: 'stable-filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Done"/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Doing"/);

  currentResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == "Doi"',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: currentResult.meta.availableProperties,
      editable: true,
    },
  });

  await controller.renderEntry(entry);

  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Doing"/);
  assert.doesNotMatch(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Done"/);
});

test('BasesPreviewController keeps alternate property suggestions visible after selecting an exact value', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: 'note.value == "Done"',
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'selected-filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
          { count: 1, text: 'Todo', value: 'Todo' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);

  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Done"/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Doing"/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Todo"/);
});

test('BasesPreviewController does not render stale property suggestions after filters change', async () => {
  const placeholder = createPlaceholder();
  const initialResult = createBaseResult({
    meta: {
      activeViewConfig: {
        filters: 'note.value == "before"',
        groupBy: null,
        order: ['note.value'],
        sort: [],
      },
      availableProperties: [{
        filterOperators: ['is', 'is not'],
        groupable: true,
        id: 'note.value',
        kind: 'note',
        label: 'Value',
        sortable: true,
        sortDirections: [{ id: 'asc', label: 'A → Z' }],
        valueType: 'text',
        visible: true,
      }],
      editable: true,
    },
  });
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async transformBase(payload) {
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: initialResult.meta.availableProperties,
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'stale-values',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder,
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: 'old-cache-key',
        values: [{ count: 1, text: 'stale', value: 'stale' }],
      }],
    ]),
    requestVersion: 0,
    result: initialResult,
    search: '',
    ui: {
      builderFilter: {
        children: [{
          operator: 'is',
          propertyId: 'note.value',
          type: 'rule',
          value: 'sta',
        }],
        conjunction: 'and',
        type: 'group',
      },
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.updateViewConfig(entry, (config) => ({
    ...config,
    filters: 'note.value == "after"',
  }));

  assert.doesNotMatch(placeholder.innerHTML, /data-base-filter-suggestion-value="stale"/);
});

test('BasesPreviewController renders cached property suggestions for empty filter values', async () => {
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBase() {
        return {
          result: createBaseResult({
            meta: {
              activeViewConfig: {
                filters: 'note.value == ""',
                groupBy: null,
                order: ['note.value'],
                sort: [],
              },
              availableProperties: [{
                filterOperators: ['is', 'is not'],
                groupable: true,
                id: 'note.value',
                kind: 'note',
                label: 'Value',
                sortable: true,
                sortDirections: [{ id: 'asc', label: 'A → Z' }],
                valueType: 'text',
                visible: true,
              }],
              editable: true,
            },
          }),
        };
      },
    },
  });
  const entry = {
    key: 'empty-filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map([
      ['note.value', {
        cacheKey: JSON.stringify({
          filters: null,
          path: 'views/tasks.base',
          source: 'views:\n  - type: table\n',
          sourcePath: 'views/tasks.base',
          view: 'view-0',
        }),
        values: [
          { count: 4, text: 'Done', value: 'Done' },
          { count: 2, text: 'Doing', value: 'Doing' },
        ],
      }],
    ]),
    requestVersion: 0,
    result: null,
    search: '',
    ui: {
      builderFilter: null,
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };

  await controller.renderEntry(entry);

  assert.match(entry.placeholder.innerHTML, /bases-filter-suggestion-list/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Done"/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="Doing"/);
});

test('BasesPreviewController refreshes property suggestions after switching filter property', async () => {
  const propertyValueCalls = [];
  const controller = new BasesPreviewController({
    vaultApiClient: {
      async queryBasePropertyValues(payload) {
        propertyValueCalls.push(payload);
        return {
          result: {
            values: [
              { count: 3, text: '1', value: '1' },
              { count: 1, text: '2', value: '2' },
            ],
          },
        };
      },
      async transformBase(payload) {
        return {
          result: {
            result: createBaseResult({
              meta: {
                activeViewConfig: payload.mutation.config,
                availableProperties: [
                  {
                    filterOperators: ['contains', 'does not contain'],
                    groupable: true,
                    id: 'note.title',
                    kind: 'note',
                    label: 'Title',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'text',
                    visible: true,
                  },
                  {
                    filterOperators: ['>', '<', 'is empty'],
                    groupable: true,
                    id: 'note.score',
                    kind: 'note',
                    label: 'Score',
                    sortable: true,
                    sortDirections: [{ id: 'asc', label: 'A → Z' }],
                    valueType: 'number',
                    visible: true,
                  },
                ],
                editable: true,
              },
            }),
            source: 'views:\n  - type: table\n',
          },
        };
      },
    },
  });
  const entry = {
    key: 'refresh-filter-suggestions',
    payload: {
      path: 'views/tasks.base',
      search: '',
      source: 'views:\n  - type: table\n',
      sourcePath: 'views/tasks.base',
      view: '',
    },
    placeholder: createPlaceholder(),
    propertyValueOptions: new Map(),
    requestVersion: 0,
    result: createBaseResult({
      meta: {
        activeViewConfig: {
          filters: 'note.title.contains("done")',
          groupBy: null,
          order: ['note.title'],
          sort: [],
        },
        availableProperties: [
          {
            filterOperators: ['contains', 'does not contain'],
            groupable: true,
            id: 'note.title',
            kind: 'note',
            label: 'Title',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'text',
            visible: true,
          },
          {
            filterOperators: ['>', '<', 'is empty'],
            groupable: true,
            id: 'note.score',
            kind: 'note',
            label: 'Score',
            sortable: true,
            sortDirections: [{ id: 'asc', label: 'A → Z' }],
            valueType: 'number',
            visible: true,
          },
        ],
        editable: true,
      },
    }),
    search: '',
    ui: {
      builderFilter: {
        children: [{
          operator: 'contains',
          propertyId: 'note.title',
          type: 'rule',
          value: 'done',
        }],
        conjunction: 'and',
        type: 'group',
      },
      filterMode: 'builder',
      openPanel: 'filter',
      propertySearch: '',
      rawFilterText: '',
    },
  };
  controller.entries.set(entry.key, entry);
  entry.placeholder.innerHTML = '<section class="bases-shell" data-base-shell-key="refresh-filter-suggestions"><div class="bases-panels" data-base-panel-slot></div><div data-base-summary-slot></div><div data-base-content></div></section>';

  const shell = { dataset: { baseShellKey: entry.key } };
  const filterProperty = {
    dataset: { baseFilterProperty: '0' },
    value: 'note.score',
  };

  controller.handleChange({
    target: {
      closest(selector) {
        switch (selector) {
          case '[data-base-shell-key]':
            return shell;
          case '[data-base-filter-property]':
            return filterProperty;
          default:
            return null;
        }
      },
    },
  });

  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(propertyValueCalls.length, 1);
  assert.equal(propertyValueCalls[0].propertyId, 'note.score');
  assert.deepEqual(entry.propertyValueOptions.get('note.score')?.values, [
    { count: 3, text: '1', value: '1' },
    { count: 1, text: '2', value: '2' },
  ]);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="1"/);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-suggestion-value="2"/);
});

test('BasesPreviewController keeps compound expressions in Advanced and decodes simple literal escapes', async () => {
  const result = createBaseResult();
  const controller = new BasesPreviewController({ vaultApiClient: { queryBase: async () => ({ result }) } });
  const entry = {
    key: 'expression-filter',
    payload: {},
    placeholder: createPlaceholder(),
    ui: { openPanel: 'filter' },
  };
  result.meta.activeViewConfig.filters = 'note.value == "open" && note.priority == "high"';
  await controller.renderEntry(entry);
  assert.equal(entry.ui.builderFilter, null);
  assert.match(entry.placeholder.innerHTML, /data-base-filter-advanced/u);

  const value = 'line\nnext \\ folder "quoted"';
  result.meta.activeViewConfig.filters = `note.value == ${JSON.stringify(value)}`;
  await controller.renderEntry(entry);
  assert.deepEqual(entry.ui.builderFilter.children[0], { operator: 'is', propertyId: 'note.value', type: 'rule', value });
});

test('BasesPreviewController removes missing embeds, invalidates their renders, and cancels their searches', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new BasesPreviewController({ vaultApiClient: {} });
  const entry = { key: 'removed', placeholder: createPlaceholder() };
  controller.entries.set(entry.key, entry);
  controller.searchTimers.set(entry.key, setTimeout(() => assert.fail('Removed embed search ran'), 180));

  controller.reconcileEmbeds({ querySelectorAll: () => [] });
  t.mock.timers.tick(180);

  assert.equal(controller.entries.size, 0);
  assert.equal(controller.searchTimers.size, 0);
  assert.equal(entry.placeholder, null);
});
