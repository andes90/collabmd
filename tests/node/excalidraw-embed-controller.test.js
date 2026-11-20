import test from 'node:test';
import assert from 'node:assert/strict';

import { ExcalidrawEmbedController } from '../../src/client/presentation/excalidraw-embed-controller.js';

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
  };
}

test('replays a queued follow target after the Excalidraw iframe reports ready', async () => {
  const originalWindow = globalThis.window;
  const posts = [];
  const iframeWindow = {};
  const entry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: iframeWindow },
    isReady: false,
    wrapper: {},
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#0', entry]]),
      followedPeerIdsByFilePath: new Map(),
      getTheme: () => 'dark',
      _clearEntryBootTimeout: () => {},
      _entryNeedsHardReload: () => false,
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      _findEntryByFilePath: ExcalidrawEmbedController.prototype._findEntryByFilePath,
      _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
      _postMessageToEntry: (_entry, payload) => {
        posts.push(payload);
      },
      _setEntryLoadingState: () => {},
      _syncEntryFollowState: ExcalidrawEmbedController.prototype._syncEntryFollowState,
      _syncEntryUser: () => {},
    };

    const didQueueFollow = await ExcalidrawEmbedController.prototype.setFollowedUser.call(
      controller,
      'sample-excalidraw.excalidraw',
      'peer-42',
    );

    assert.equal(didQueueFollow, true);
    assert.equal(entry.followedPeerId, 'peer-42');
    assert.deepEqual(posts, []);

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'ready',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.deepEqual(posts, [
      {
        source: 'collabmd-host',
        type: 'set-theme',
        theme: 'dark',
      },
      {
        source: 'collabmd-host',
        type: 'follow-user',
        peerId: 'peer-42',
      },
    ]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('opens a queued Excalidraw comment thread in a ready iframe', () => {
  const originalWindow = globalThis.window;
  const posts = [];
  const entry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: {} },
    isReady: true,
    wrapper: {},
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#file-preview', entry]]),
      _findEntryByFilePath: ExcalidrawEmbedController.prototype._findEntryByFilePath,
      _postMessageToEntry: (_entry, payload) => posts.push(payload),
      _postPendingCommentThread: ExcalidrawEmbedController.prototype._postPendingCommentThread,
    };

    const didQueueComment = ExcalidrawEmbedController.prototype.openCommentThread.call(
      controller,
      entry.filePath,
      'thread-42',
    );

    assert.equal(didQueueComment, true);
    assert.deepEqual(posts, [{
      source: 'collabmd-host',
      threadId: 'thread-42',
      type: 'open-comment-thread',
    }]);
    assert.equal(entry.pendingCommentThreadId, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('opens a queued Excalidraw element in a ready iframe', () => {
  const originalWindow = globalThis.window;
  const posts = [];
  const entry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: {} },
    isReady: true,
    wrapper: {},
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#file-preview', entry]]),
      _findEntryByFilePath: ExcalidrawEmbedController.prototype._findEntryByFilePath,
      _postMessageToEntry: (_entry, payload) => posts.push(payload),
      _postPendingElement: ExcalidrawEmbedController.prototype._postPendingElement,
    };

    const didQueueElement = ExcalidrawEmbedController.prototype.openElement.call(
      controller,
      entry.filePath,
      'node-42',
      'group',
    );

    assert.equal(didQueueElement, true);
    assert.deepEqual(posts, [{
      elementId: 'node-42',
      elementType: 'group',
      source: 'collabmd-host',
      type: 'focus-element',
    }]);
    assert.equal(entry.pendingElementFocus, null);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('flushes active diagram writes and waits for matching paint acknowledgement', async () => {
  const originalWindow = globalThis.window;
  const posts = [];
  const iframeWindow = {};
  const entry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: iframeWindow },
    isReady: true,
    key: 'sample-excalidraw.excalidraw#file-preview',
  };

  globalThis.window = {
    clearTimeout,
    location: { origin: 'http://localhost:4173' },
    setTimeout,
  };

  try {
    const controller = {
      agentBridgeRequestCounter: 0,
      embedEntries: new Map([[entry.key, entry]]),
      pendingAgentBridgeRequests: new Map(),
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      _findEntryByFilePath: ExcalidrawEmbedController.prototype._findEntryByFilePath,
      _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
      _postMessageToEntry: (_entry, payload) => posts.push(payload),
      _requestAgentBridge: ExcalidrawEmbedController.prototype._requestAgentBridge,
    };

    const flush = ExcalidrawEmbedController.prototype.flushPendingAgentWrites.call(
      controller,
      entry.filePath,
    );
    const flushRequest = posts.at(-1);
    assert.equal(flushRequest.type, 'flush-agent-writes');
    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        requestId: flushRequest.requestId,
        source: 'excalidraw-editor',
        type: 'agent-writes-flushed',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });
    assert.deepEqual(await flush, { status: 'flushed' });

    const revision = 'a'.repeat(64);
    const afterRevision = 'b'.repeat(64);
    const paint = ExcalidrawEmbedController.prototype.waitForAgentPaint.call(
      controller,
      entry.filePath,
      revision,
      { afterRevision },
    );
    const paintRequest = posts.at(-1);
    assert.equal(paintRequest.type, 'wait-for-agent-revision');
    assert.equal(paintRequest.revision, revision);
    assert.equal(paintRequest.afterRevision, afterRevision);
    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        requestId: paintRequest.requestId,
        revision,
        source: 'excalidraw-editor',
        type: 'agent-revision-painted',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });
    assert.deepEqual(await paint, { revision, status: 'painted' });
  } finally {
    globalThis.window = originalWindow;
  }
});

test('forwards valid Excalidraw element links but ignores external links', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  const targets = [];

  globalThis.window = {
    location: {
      origin: 'http://localhost:4173',
    },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#0', {
        filePath: 'sample-excalidraw.excalidraw',
        iframe: { contentWindow: iframeWindow },
      }]]),
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      onOpenElement: (target) => targets.push(target),
    };

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        href: 'http://localhost:4173/#file=target.excalidraw&element=node-42',
        source: 'excalidraw-editor',
        type: 'open-element-link',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });
    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        href: 'https://example.com/#file=target.excalidraw&element=node-42',
        source: 'excalidraw-editor',
        type: 'open-element-link',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.deepEqual(targets, [{
      elementId: 'node-42',
      elementType: 'element',
      filePath: 'target.excalidraw',
    }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('forwards Excalidraw shell requests from known same-origin iframe', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  let stopCalls = 0;
  let toggleCalls = 0;

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      embedEntries: new Map([['sample-excalidraw.excalidraw#0', {
        filePath: 'sample-excalidraw.excalidraw',
        iframe: { contentWindow: iframeWindow },
      }]]),
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      onStopFollowing: () => {
        stopCalls += 1;
      },
      onToggleQuickSwitcher: () => {
        toggleCalls += 1;
      },
    };

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'request-toggle-quick-switcher',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });
    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'stop-following',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.equal(toggleCalls, 1);
    assert.equal(stopCalls, 1);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('persists follow intent even before the embed entry exists', async () => {
  const controller = {
    embedEntries: new Map(),
    followedPeerIdsByFilePath: new Map(),
    _findEntryByFilePath: () => null,
  };

  const didQueueFollow = await ExcalidrawEmbedController.prototype.setFollowedUser.call(
    controller,
    'sample-excalidraw.excalidraw',
    'peer-99',
  );

  assert.equal(didQueueFollow, true);
  assert.equal(controller.followedPeerIdsByFilePath.get('sample-excalidraw.excalidraw'), 'peer-99');
});

test('prepareFileDisconnect requires explicit discard after reconnect timeout', async () => {
  const originalWindow = globalThis.window;
  const timers = [];
  const messages = [];
  const entry = {
    filePath: 'reconnecting.excalidraw',
    iframe: { contentWindow: {} },
  };

  globalThis.window = {
    clearTimeout() {},
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  };

  try {
    const controller = {
      confirmDiscard: async () => true,
      disconnectRequestCounter: 0,
      pendingDisconnectRequests: new Map(),
      _findEntryByFilePath: () => entry,
      _postMessageToEntry: (_entry, payload) => messages.push(payload),
    };

    const result = ExcalidrawEmbedController.prototype.prepareFileDisconnect.call(
      controller,
      entry.filePath,
      { timeoutMs: 25 },
    );
    await timers.shift()();
    timers.shift()();

    assert.equal(await result, true);
    assert.deepEqual(messages.map((message) => message.type), [
      'prepare-disconnect',
      'discard-and-disconnect',
    ]);
    assert.equal(controller.pendingDisconnectRequests.size, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('replays a pending disconnect when a starting iframe becomes ready', async () => {
  const originalWindow = globalThis.window;
  const messages = [];
  const entry = {
    filePath: 'starting.excalidraw',
    iframe: { contentWindow: {} },
    isReady: false,
  };
  globalThis.window = {
    clearTimeout() {},
    location: { origin: 'http://localhost:4173' },
    setTimeout: () => 1,
  };

  try {
    const controller = Object.assign(Object.create(ExcalidrawEmbedController.prototype), {
      disconnectRequestCounter: 0,
      embedEntries: new Map([[entry.filePath, entry]]),
      pendingDisconnectRequests: new Map(),
      _clearEntryBootTimeout() {},
      _entryNeedsHardReload: () => false,
      _postMessageToEntry: (_entry, payload) => messages.push(payload),
      _setEntryLoadingState() {},
      _syncEntryFollowState() {},
      _syncEntryUser() {},
    });
    const result = controller.prepareFileDisconnect(entry.filePath);
    const requestId = messages[0].requestId;
    // The first message can arrive before the iframe installs its listener.
    controller._onMessage({
      data: { source: 'excalidraw-editor', type: 'ready' },
      origin: window.location.origin,
      source: entry.iframe.contentWindow,
    });
    assert.deepEqual(messages.filter((message) => message.type === 'prepare-disconnect'), [
      { source: 'collabmd-host', type: 'prepare-disconnect', requestId },
      { source: 'collabmd-host', type: 'prepare-disconnect', requestId },
    ]);
    controller._onMessage({
      data: { source: 'excalidraw-editor', type: 'disconnect-ready', requestId },
      origin: window.location.origin,
      source: entry.iframe.contentWindow,
    });
    assert.equal(await result, true);
    assert.equal(controller.pendingDisconnectRequests.size, 0);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('iframe URLs only forward test options in development and test', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: { basePath: '', vaults: [{ id: 'alpha' }, { id: 'beta' }] },
    location: {
      origin: 'http://localhost:4173',
      search: '?vault=beta&excalidrawDebug=1&test=1&syncTimeoutMs=50',
    },
  };

  try {
    const controller = {
      getLocalUser: () => null,
      getTheme: () => 'dark',
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
    };
    const entry = {
      filePath: 'debug.excalidraw',
      instanceId: '1',
      key: 'debug.excalidraw#file-preview',
    };
    for (const environment of ['production', 'development', 'test']) {
      window.__COLLABMD_CONFIG__.environment = environment;
      const iframeUrl = ExcalidrawEmbedController.prototype._buildIframeUrl.call(controller, entry);
      const allowTestOptions = environment !== 'production';

      assert.equal(iframeUrl.searchParams.get('excalidrawDebug'), allowTestOptions ? '1' : null);
      assert.equal(iframeUrl.searchParams.get('test'), allowTestOptions ? '1' : null);
      assert.equal(iframeUrl.searchParams.get('syncTimeoutMs'), allowTestOptions ? '50' : null);
      assert.equal(iframeUrl.searchParams.get('vault'), 'beta');
    }
  } finally {
    globalThis.window = originalWindow;
  }
});

test('detachForCommit exits maximized mode before hiding overlay roots', () => {
  let exitCalls = 0;
  const controller = {
    _disconnectPlaceholderObserver: () => {},
    _exitMaximizedEmbed: () => {
      exitCalls += 1;
    },
    embedEntries: new Map([['sample-excalidraw.excalidraw#0', { queued: true, placeholder: { isConnected: true } }]]),
    hydrationIdleId: null,
    hydrationInProgress: true,
    hydrationQueue: ['sample-excalidraw.excalidraw#0'],
    overlayRoot: { hidden: false },
  };

  ExcalidrawEmbedController.prototype.detachForCommit.call(controller);

  assert.equal(exitCalls, 1);
  assert.equal(controller.hydrationInProgress, false);
  assert.deepEqual(controller.hydrationQueue, []);
  assert.equal(controller.overlayRoot.hidden, true);
  assert.equal(controller.embedEntries.get('sample-excalidraw.excalidraw#0').queued, false);
  assert.equal(controller.embedEntries.get('sample-excalidraw.excalidraw#0').placeholder, null);
});

test('only reuses a same-file embed that stays in the live overlay', () => {
  const overlayRoot = { isConnected: true };
  const filePath = 'sample-excalidraw.excalidraw';
  const inlineEntry = { filePath, key: `${filePath}#file-preview`, wrapper: {} };
  const embeddedEntry = { filePath, key: `${filePath}#0`, wrapper: { parentElement: overlayRoot } };
  const controller = Object.assign(Object.create(ExcalidrawEmbedController.prototype), { overlayRoot });
  const removedEntries = [inlineEntry, embeddedEntry];

  assert.equal(controller._claimReusableEntry(inlineEntry, removedEntries), null);
  assert.equal(controller._claimReusableEntry({ filePath, key: `${filePath}#1` }, removedEntries), embeddedEntry);
  assert.deepEqual(removedEntries, [inlineEntry]);
});

test('treats a reused direct-preview entry with a new file path as needing reload', () => {
  const entry = {
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-next.excalidraw#file-preview',
    loadedFilePath: 'sample-prev.excalidraw',
    loadedMode: 'edit',
    wrapper: {},
  };

  const needsReload = ExcalidrawEmbedController.prototype._entryNeedsHardReload.call({
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  }, entry);

  assert.equal(needsReload, true);
});

test('does not reload again while the iframe is already booting the desired file', () => {
  const entry = {
    bootFilePath: 'sample-next.excalidraw',
    bootMode: 'edit',
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    isReady: false,
    key: 'sample-next.excalidraw#file-preview',
    loadedFilePath: null,
    loadedMode: null,
    wrapper: {},
  };

  const needsReload = ExcalidrawEmbedController.prototype._entryNeedsHardReload.call({
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  }, entry);

  assert.equal(needsReload, false);
});

test('does not hard reload a ready Excalidraw iframe for unchanged file and mode', () => {
  const entry = {
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    isReady: true,
    key: 'sample-next.excalidraw#file-preview',
    loadedFilePath: 'sample-next.excalidraw',
    loadedMode: 'edit',
    wrapper: {},
  };

  const needsReload = ExcalidrawEmbedController.prototype._entryNeedsHardReload.call({
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  }, entry);

  assert.equal(needsReload, false);
});

test('Excalidraw layout sync preserves iframe src while updating placeholder geometry', () => {
  let srcWrites = 0;
  const iframe = {
    offsetHeight: 500,
    style: { height: '500px' },
  };
  Object.defineProperty(iframe, 'src', {
    get() {
      return 'http://localhost:4173/excalidraw-editor.html?file=diagram.excalidraw';
    },
    set() {
      srcWrites += 1;
    },
  });

  const placeholder = {
    classList: createClassList(),
    dataset: { embedKey: 'diagram"evil]#0' },
    isConnected: false,
    offsetLeft: 30,
    offsetTop: 18,
    offsetWidth: 720,
    style: {},
  };
  const wrapper = {
    classList: createClassList(),
    querySelector(selector) {
      if (selector === '.excalidraw-embed-header') {
        return { offsetHeight: 44 };
      }
      if (selector === '.excalidraw-embed-resizer') {
        return { offsetHeight: 6 };
      }
      return null;
    },
    style: {},
  };
  const entry = {
    filePath: 'diagram.excalidraw',
    iframe,
    key: 'diagram"evil]#0',
    placeholder,
    wrapper,
  };
  const controller = {
    embedEntries: new Map([[entry.key, entry]]),
    previewElement: { querySelectorAll: () => [placeholder] },
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
    _syncEntryLayout: ExcalidrawEmbedController.prototype._syncEntryLayout,
  };

  ExcalidrawEmbedController.prototype.syncLayout.call(controller);

  assert.equal(srcWrites, 0);
  assert.equal(placeholder.style.height, '550px');
  assert.equal(wrapper.style.position, 'absolute');
  assert.equal(wrapper.style.width, '720px');
});

test('Excalidraw embedded height resize updates height without recreating iframe', () => {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  let resizeEndCalls = 0;
  let srcWrites = 0;
  const resizer = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
  };
  const iframe = {
    offsetHeight: 420,
    style: {},
  };
  Object.defineProperty(iframe, 'src', {
    get() {
      return 'http://localhost:4173/excalidraw-editor.html?file=diagram.excalidraw';
    },
    set() {
      srcWrites += 1;
    },
  });

  globalThis.document = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
  };

  try {
    ExcalidrawEmbedController.prototype._setupResizer.call(
      {},
      resizer,
      iframe,
      () => {
        resizeEndCalls += 1;
      },
    );

    listeners.get('pointerdown')({
      clientY: 100,
      preventDefault() {},
    });
    listeners.get('pointermove')({ clientY: 150 });
    listeners.get('pointerup')();

    assert.equal(srcWrites, 0);
    assert.equal(iframe.style.height, '470px');
    assert.equal(iframe.style.pointerEvents, '');
    assert.equal(resizeEndCalls, 1);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('Excalidraw resizer cleanup removes active document listeners without finishing the resize', () => {
  const originalDocument = globalThis.document;
  const listeners = new Map();
  let resizeEndCalls = 0;
  const resizer = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
  };
  const iframe = {
    offsetHeight: 420,
    style: {},
  };

  globalThis.document = {
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    removeEventListener(type, handler) {
      if (listeners.get(type) === handler) {
        listeners.delete(type);
      }
    },
  };

  try {
    const cleanup = ExcalidrawEmbedController.prototype._setupResizer.call(
      {},
      resizer,
      iframe,
      () => {
        resizeEndCalls += 1;
      },
    );

    listeners.get('pointerdown')({
      clientY: 100,
      preventDefault() {},
    });
    cleanup();

    assert.equal(listeners.has('pointerdown'), false);
    assert.equal(listeners.has('pointermove'), false);
    assert.equal(listeners.has('pointerup'), false);
    assert.equal(iframe.style.pointerEvents, '');
    assert.equal(resizeEndCalls, 0);
  } finally {
    globalThis.document = originalDocument;
  }
});

test('Excalidraw maximize keeps the iframe wrapper mounted in place', () => {
  let srcWrites = 0;
  const iframe = {};
  Object.defineProperty(iframe, 'src', {
    get() {
      return 'http://localhost:4173/excalidraw-editor.html?file=diagram.excalidraw';
    },
    set() {
      srcWrites += 1;
    },
  });

  const parent = {
    appendChild() {
      throw new Error('maximize should not reparent the wrapper');
    },
    insertBefore() {
      throw new Error('embedded maximize should not insert a replacement node');
    },
  };
  const overlayClassList = createClassList();
  const wrapper = {
    dataset: {},
    parentElement: parent,
    style: {},
  };
  const entry = {
    filePath: 'diagram.excalidraw',
    iframe,
    key: 'diagram.excalidraw#0',
    wrapper,
  };
  const controller = {
    overlayRoot: { classList: overlayClassList },
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  };

  ExcalidrawEmbedController.prototype._enterMaximizedEntryLayout.call(controller, entry);

  assert.equal(wrapper.parentElement, parent);
  assert.equal(srcWrites, 0);
  assert.equal(wrapper.dataset.excalidrawMaximized, 'true');
  assert.equal(wrapper.style.width, 'auto');
  assert.equal(wrapper.style.height, 'auto');
  assert.equal(wrapper.style.minHeight, '0');
  assert.equal(overlayClassList.contains('has-maximized-entry'), true);

  ExcalidrawEmbedController.prototype._restoreMaximizedEntryLayout.call(controller, entry);

  assert.equal(wrapper.parentElement, parent);
  assert.equal(srcWrites, 0);
  assert.equal(wrapper.dataset.excalidrawMaximized, undefined);
  assert.equal(wrapper.style.width, '');
  assert.equal(wrapper.style.height, '');
  assert.equal(wrapper.style.minHeight, '');
  assert.equal(overlayClassList.contains('has-maximized-entry'), false);
});

test('Excalidraw preview viewport fit request posts without reloading iframe', () => {
  const originalWindow = globalThis.window;
  const posts = [];
  let srcWrites = 0;
  const iframe = {
    contentWindow: {
      postMessage(payload, origin) {
        posts.push({ origin, payload });
      },
    },
  };
  Object.defineProperty(iframe, 'src', {
    get() {
      return 'http://localhost:4173/excalidraw-editor.html?file=diagram.excalidraw&mode=preview';
    },
    set() {
      srcWrites += 1;
    },
  });

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
      _postMessageToEntry: ExcalidrawEmbedController.prototype._postMessageToEntry,
    };
    const entry = {
      filePath: 'diagram.excalidraw',
      iframe,
      key: 'diagram.excalidraw#0',
    };

    ExcalidrawEmbedController.prototype._requestPreviewViewportFit.call(controller, entry);

    assert.equal(srcWrites, 0);
    assert.deepEqual(posts, [{
      origin: 'http://localhost:4173',
      payload: {
        source: 'collabmd-host',
        type: 'fit-preview-viewport',
      },
    }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('Excalidraw direct file preview skips preview viewport fit requests', () => {
  const originalWindow = globalThis.window;
  const posts = [];
  const iframe = {
    contentWindow: {
      postMessage(payload, origin) {
        posts.push({ origin, payload });
      },
    },
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
      _postMessageToEntry: ExcalidrawEmbedController.prototype._postMessageToEntry,
    };

    ExcalidrawEmbedController.prototype._requestPreviewViewportFit.call(controller, {
      filePath: 'diagram.excalidraw',
      iframe,
      key: 'diagram.excalidraw#file-preview',
    });

    assert.deepEqual(posts, []);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('starts the iframe after mounting the inline file preview', async () => {
  const filePath = 'sample-next.excalidraw';
  const wrapper = { style: {} };
  const entry = {
    filePath,
    key: `${filePath}#file-preview`,
    placeholder: {
      isConnected: true,
      replaceWith(node) {
        assert.equal(node, wrapper);
        node.isConnected = true;
        this.isConnected = false;
      },
    },
  };
  const navigations = [];
  const iframe = {
    set src(value) {
      assert.equal(wrapper.isConnected, true);
      navigations.push(value);
    },
  };
  const controller = Object.assign(Object.create(ExcalidrawEmbedController.prototype), {
    followedPeerIdsByFilePath: new Map(),
    _createEmbedContainer: () => ({ iframe, wrapper }),
    _syncMountedEntryMetadata() {},
    _buildIframeUrl: () => new URL('https://example.test/excalidraw-editor.html'),
    _setEntryLoadingState() {},
    _armEntryBootTimeout() {},
  });

  await controller._hydrateEntry(entry);
  await controller._hydrateEntry(entry);

  assert.deepEqual(navigations, ['https://example.test/excalidraw-editor.html']);
  assert.equal(entry.bootFilePath, filePath);
  assert.equal(entry.bootMode, 'edit');
});
