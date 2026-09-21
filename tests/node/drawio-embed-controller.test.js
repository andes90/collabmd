import test from 'node:test';
import assert from 'node:assert/strict';

import { DrawioEmbedController } from '../../src/client/presentation/drawio-embed-controller.js';

function createClassList() {
  const values = new Set();
  return {
    add(value) {
      values.add(value);
    },
    contains(value) {
      return values.has(value);
    },
    remove(value) {
      values.delete(value);
    },
    toggle(value, force) {
      if (force === false) {
        values.delete(value);
        return false;
      }
      values.add(value);
      return true;
    },
  };
}

function createPlaceholder({
  filePath = 'diagram.drawio',
  key = 'diagram.drawio#0',
  label = 'diagram.drawio',
  mode = 'view',
  replaceWith = () => {},
} = {}) {
  return {
    classList: createClassList(),
    dataset: {
      drawioKey: key,
      drawioLabel: label,
      drawioMode: mode,
      drawioTarget: filePath,
    },
    isConnected: true,
    offsetLeft: 24,
    offsetTop: 12,
    offsetWidth: 640,
    removeAttribute(name) {
      delete this.dataset[name];
    },
    replaceWith,
    style: {},
  };
}

function createWrapper({ height = 460, parentElement = null, remove = () => {} } = {}) {
  return {
    classList: createClassList(),
    dataset: {},
    getBoundingClientRect() {
      return { height };
    },
    isConnected: true,
    offsetHeight: height,
    parentElement,
    querySelector() {
      return null;
    },
    remove,
    style: {},
  };
}

function createController(overrides = {}) {
  return {
    attachWrapper: DrawioEmbedController.prototype.attachWrapper,
    createEntry: DrawioEmbedController.prototype.createEntry,
    destroyEntry: DrawioEmbedController.prototype.destroyEntry,
    embedEntries: new Map(),
    ensureOverlayRoot: DrawioEmbedController.prototype.ensureOverlayRoot,
    entryMatchesDescriptor: DrawioEmbedController.prototype.entryMatchesDescriptor,
    findPlaceholder: DrawioEmbedController.prototype.findPlaceholder,
    hydrateVisibleEmbeds: () => {},
    hydrationPaused: true,
    resetPlaceholderLayout: DrawioEmbedController.prototype.resetPlaceholderLayout,
    shouldInlineEntry: DrawioEmbedController.prototype.shouldInlineEntry,
    syncEntryLayout: DrawioEmbedController.prototype.syncEntryLayout,
    syncLayout: DrawioEmbedController.prototype.syncLayout,
    syncMountedEntryMetadata: DrawioEmbedController.prototype.syncMountedEntryMetadata,
    _disconnectPlaceholderObserver: () => {},
    _ensurePlaceholderObserver: () => {},
    _enterMaximizedEntry: DrawioEmbedController.prototype._enterMaximizedEntry,
    _exitMaximizedEntry: () => {},
    ...overrides,
  };
}

test('forwards draw.io quick switcher requests from known same-origin iframe', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['diagram.drawio#0', {
        filePath: 'diagram.drawio',
        iframe: { contentWindow: iframeWindow },
        instanceId: 'drawio-1',
      }]]),
      _findEntryByInstanceId: DrawioEmbedController.prototype._findEntryByInstanceId,
      _isMessageFromEntry: DrawioEmbedController.prototype._isMessageFromEntry,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    DrawioEmbedController.prototype._onMessage.call(controller, {
      data: {
        instanceId: 'drawio-1',
        source: 'drawio-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.equal(toggleCalls, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('reconcile preserves mounted draw.io iframe entries for unchanged descriptors', () => {
  const originalDocument = globalThis.document;
  let placeholderReplaceCalls = 0;
  const placeholder = createPlaceholder({
    replaceWith: () => {
      placeholderReplaceCalls += 1;
    },
  });
  const previewElement = {
    querySelectorAll: () => [placeholder],
    querySelector: () => null,
  };
  const overlayRoot = {
    hidden: true,
    isConnected: true,
    parentElement: previewElement,
    appendChild(node) {
      node.parentElement = overlayRoot;
    },
  };
  const iframe = { src: 'http://localhost:4173/drawio-editor.html?file=diagram.drawio' };
  const wrapper = createWrapper();
  const entry = {
    filePath: 'diagram.drawio',
    iframe,
    inlineHeightPx: null,
    instanceId: 'drawio-1',
    key: 'diagram.drawio#0',
    label: 'diagram.drawio',
    mode: 'view',
    placeholder: null,
    queued: false,
    viewerElement: null,
    wrapper,
  };
  const controller = createController({
    embedEntries: new Map([[entry.key, entry]]),
    overlayRoot,
    previewElement,
  });

  globalThis.document = {
    createElement() {
      throw new Error('existing overlay root should be reused');
    },
  };

  try {
    DrawioEmbedController.prototype.reconcileEmbeds.call(controller, previewElement);

    const reconciledEntry = controller.embedEntries.get(entry.key);
    assert.equal(reconciledEntry, entry);
    assert.equal(reconciledEntry.iframe, iframe);
    assert.equal(wrapper.parentElement, overlayRoot);
    assert.equal(placeholderReplaceCalls, 0);
    assert.equal(placeholder.style.height, '460px');
    assert.equal(wrapper.style.position, 'absolute');
    assert.equal(wrapper.style.width, '640px');
  } finally {
    globalThis.document = originalDocument;
  }
});

test('draw.io layout sync does not rewrite iframe src', () => {
  let srcWrites = 0;
  const iframe = {};
  Object.defineProperty(iframe, 'src', {
    get() {
      return 'http://localhost:4173/drawio-editor.html?file=diagram.drawio';
    },
    set() {
      srcWrites += 1;
    },
  });

  const placeholder = createPlaceholder();
  const wrapper = createWrapper({ height: 512 });
  const entry = {
    filePath: 'diagram.drawio',
    iframe,
    inlineHeightPx: null,
    key: 'diagram.drawio#0',
    mode: 'view',
    placeholder,
    wrapper,
  };
  const controller = createController({
    embedEntries: new Map([[entry.key, entry]]),
  });

  DrawioEmbedController.prototype.syncLayout.call(controller);

  assert.equal(srcWrites, 0);
  assert.equal(placeholder.style.height, '512px');
  assert.equal(wrapper.style.position, 'absolute');
});

test('draw.io layout sync clears overlay geometry while maximized', () => {
  const placeholder = createPlaceholder();
  const wrapper = createWrapper({ height: 512 });
  wrapper.classList.add('is-maximized');
  wrapper.style.position = 'absolute';
  wrapper.style.top = '12px';
  wrapper.style.left = '24px';
  wrapper.style.width = '640px';
  wrapper.style.margin = '0';
  const entry = {
    filePath: 'diagram.drawio',
    iframe: {},
    inlineHeightPx: 512,
    key: 'diagram.drawio#0',
    mode: 'view',
    placeholder,
    wrapper,
  };
  const controller = createController({
    embedEntries: new Map([[entry.key, entry]]),
  });

  DrawioEmbedController.prototype.syncLayout.call(controller);

  assert.equal(wrapper.style.position, '');
  assert.equal(wrapper.style.top, '');
  assert.equal(wrapper.style.left, '');
  assert.equal(wrapper.style.width, 'auto');
  assert.equal(wrapper.style.height, 'auto');
  assert.equal(wrapper.style.minHeight, '0');
  assert.equal(wrapper.style.margin, '');
  assert.equal(placeholder.style.height, '512px');
});

test('draw.io maximize keeps iframe wrapper in the same parent', () => {
  const originalDocument = globalThis.document;
  const originalBody = globalThis.document?.body;
  const originalWindow = globalThis.window;
  const wrapper = createWrapper({ height: 512 });
  const parent = {
    isConnected: true,
    insertBefore(node, nextSibling) {
      assert.equal(nextSibling, wrapper);
      node.parentElement = parent;
    },
  };
  wrapper.parentElement = parent;
  const entry = {
    filePath: 'diagram.drawio',
    iframe: {},
    key: 'diagram.drawio#0',
    mode: 'view',
    wrapper,
  };
  let bodyAppendCalls = 0;

  globalThis.document = {
    body: {
      appendChild() {
        bodyAppendCalls += 1;
      },
      classList: createClassList(),
      querySelector() {
        return null;
      },
    },
    createElement() {
      return {
        className: '',
        parentElement: null,
        remove() {
          this.parentElement = null;
        },
        style: {},
      };
    },
  };
  globalThis.window = { document: globalThis.document };

  try {
    const controller = createController({
      embedEntries: new Map([[entry.key, entry]]),
      maximizedEntry: null,
      overlayRoot: null,
    });

    DrawioEmbedController.prototype._enterMaximizedEntry.call(controller, entry, wrapper);

    assert.equal(wrapper.parentElement, parent);
    assert.equal(bodyAppendCalls, 0);
    assert.equal(wrapper.dataset.drawioMaximized, 'true');

    DrawioEmbedController.prototype._exitMaximizedEntry.call(controller);

    assert.equal(wrapper.parentElement, parent);
    assert.equal(wrapper.dataset.drawioMaximized, undefined);
  } finally {
    globalThis.document = originalDocument;
    if (originalDocument && originalBody) {
      globalThis.document.body = originalBody;
    }
    globalThis.window = originalWindow;
  }
});

test('reconcile removes draw.io entries whose descriptors disappeared', () => {
  let removed = false;
  const placeholder = createPlaceholder();
  const entry = {
    filePath: 'diagram.drawio',
    iframe: {},
    key: 'diagram.drawio#0',
    mode: 'view',
    placeholder,
    wrapper: createWrapper({
      remove: () => {
        removed = true;
      },
    }),
  };
  const previewElement = {
    querySelectorAll: () => [],
  };
  const controller = createController({
    embedEntries: new Map([[entry.key, entry]]),
    previewElement,
  });

  DrawioEmbedController.prototype.reconcileEmbeds.call(controller, previewElement);

  assert.equal(removed, true);
  assert.equal(controller.embedEntries.size, 0);
  assert.equal(entry.wrapper, null);
  assert.equal(entry.iframe, null);
});

test('detachForCommit hides preserved draw.io overlay roots during preview swaps', () => {
  let exitCalls = 0;
  const entry = {
    placeholder: { isConnected: true },
    queued: true,
  };
  const controller = {
    embedEntries: new Map([['diagram.drawio#0', entry]]),
    hydrationIdleId: null,
    hydrationQueue: ['diagram.drawio#0'],
    overlayRoot: { hidden: false },
    _disconnectPlaceholderObserver: () => {},
    _exitMaximizedEntry: () => {
      exitCalls += 1;
    },
  };

  DrawioEmbedController.prototype.detachForCommit.call(controller);

  assert.equal(exitCalls, 1);
  assert.deepEqual(controller.hydrationQueue, []);
  assert.equal(controller.overlayRoot.hidden, true);
  assert.equal(entry.queued, false);
  assert.equal(entry.placeholder, null);
});

test('ignores draw.io quick switcher requests from other origins', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['diagram.drawio#0', {
        filePath: 'diagram.drawio',
        iframe: { contentWindow: iframeWindow },
        instanceId: 'drawio-1',
      }]]),
      _findEntryByInstanceId: DrawioEmbedController.prototype._findEntryByInstanceId,
      _isMessageFromEntry: DrawioEmbedController.prototype._isMessageFromEntry,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    DrawioEmbedController.prototype._onMessage.call(controller, {
      data: {
        instanceId: 'drawio-1',
        source: 'drawio-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'https://example.com',
      source: iframeWindow,
    });

    assert.equal(toggleCalls, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('ignores draw.io quick switcher requests from same-origin non-entry senders', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  const otherWindow = {};
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['diagram.drawio#0', {
        filePath: 'diagram.drawio',
        iframe: { contentWindow: iframeWindow },
        instanceId: 'drawio-1',
      }]]),
      _findEntryByInstanceId: DrawioEmbedController.prototype._findEntryByInstanceId,
      _isMessageFromEntry: DrawioEmbedController.prototype._isMessageFromEntry,
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    DrawioEmbedController.prototype._onMessage.call(controller, {
      data: {
        instanceId: 'drawio-1',
        source: 'drawio-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'http://localhost:4173',
      source: otherWindow,
    });

    assert.equal(toggleCalls, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});


test('draw.io editor URLs preserve the URL vault over stored selection', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: { vaults: [{ id: 'alpha' }, { id: 'beta' }] },
    localStorage: { getItem: () => 'alpha' },
    location: { origin: 'https://example.test', search: '?vault=beta' },
  };
  try {
    const url = new URL(DrawioEmbedController.prototype.buildIframeUrl.call({}, {
      filePath: 'test.drawio', mode: 'edit', instanceId: 'test',
    }));
    assert.equal(url.searchParams.get('vault'), 'beta');
  } finally {
    globalThis.window = originalWindow;
  }
});
