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
    const paint = ExcalidrawEmbedController.prototype.waitForAgentPaint.call(
      controller,
      entry.filePath,
      revision,
    );
    const paintRequest = posts.at(-1);
    assert.equal(paintRequest.type, 'wait-for-agent-revision');
    assert.equal(paintRequest.revision, revision);
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
    confirm: () => true,
    setTimeout(callback) {
      timers.push(callback);
      return timers.length;
    },
  };

  try {
    const controller = {
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
    timers.shift()();
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

test('iframe URLs forward the opt-in Excalidraw diagnostic flag', () => {
  const originalWindow = globalThis.window;
  globalThis.window = {
    __COLLABMD_CONFIG__: { basePath: '' },
    location: {
      origin: 'http://localhost:4173',
      search: '?excalidrawDebug=1',
    },
  };

  try {
    const controller = {
      getLocalUser: () => null,
      getTheme: () => 'dark',
      _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
    };
    const iframeUrl = ExcalidrawEmbedController.prototype._buildIframeUrl.call(controller, {
      filePath: 'debug.excalidraw',
      instanceId: '1',
      key: 'debug.excalidraw#file-preview',
    });

    assert.equal(iframeUrl.searchParams.get('excalidrawDebug'), '1');
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

test('reuses a warm direct-preview entry for the next direct file preview', () => {
  const warmEntry = {
    filePath: 'sample-a.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-a.excalidraw#file-preview',
    label: 'sample-a.excalidraw',
    wrapper: {},
  };
  const controller = {
    warmEntry,
    _claimEntryFromRemovedEntries: ExcalidrawEmbedController.prototype._claimEntryFromRemovedEntries,
    _claimReusableEntry: ExcalidrawEmbedController.prototype._claimReusableEntry,
    _claimWarmEntry: ExcalidrawEmbedController.prototype._claimWarmEntry,
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  };

  const reusedEntry = ExcalidrawEmbedController.prototype._claimReusableEntry.call(controller, {
    filePath: 'sample-b.excalidraw',
    key: 'sample-b.excalidraw#file-preview',
  }, []);

  assert.equal(reusedEntry, warmEntry);
  assert.equal(controller.warmEntry, null);
});

test('promotes a same-file embedded preview entry into a direct file preview', () => {
  const embeddedEntry = {
    filePath: 'sample-excalidraw.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-excalidraw.excalidraw#0',
    label: 'sample-excalidraw.excalidraw',
    wrapper: {},
  };
  const controller = {
    warmEntry: null,
    _claimEntryFromRemovedEntries: ExcalidrawEmbedController.prototype._claimEntryFromRemovedEntries,
    _claimReusableEntry: ExcalidrawEmbedController.prototype._claimReusableEntry,
    _claimWarmEntry: ExcalidrawEmbedController.prototype._claimWarmEntry,
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
  };
  const removedEntries = [embeddedEntry];

  const reusedEntry = ExcalidrawEmbedController.prototype._claimReusableEntry.call(controller, {
    filePath: 'sample-excalidraw.excalidraw',
    key: 'sample-excalidraw.excalidraw#file-preview',
  }, removedEntries);

  assert.equal(reusedEntry, embeddedEntry);
  assert.deepEqual(removedEntries, []);
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
    _shouldInlineFilePreview: ExcalidrawEmbedController.prototype._shouldInlineFilePreview,
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
    _shouldInlineFilePreview: ExcalidrawEmbedController.prototype._shouldInlineFilePreview,
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

test('hydrate reloads a reused direct-preview iframe when switching files', async () => {
  const calls = [];
  const entry = {
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    key: 'sample-next.excalidraw#file-preview',
    label: 'sample-next.excalidraw',
    loadedFilePath: 'sample-prev.excalidraw',
    loadedMode: 'edit',
    placeholder: {
      isConnected: true,
      replaceWith() {},
    },
    wrapper: {
      style: {},
    },
  };

  const controller = {
    followedPeerIdsByFilePath: new Map(),
    _attachWrapper: () => {
      calls.push('attach');
    },
    _entryNeedsHardReload: ExcalidrawEmbedController.prototype._entryNeedsHardReload,
    _getEntryMode: ExcalidrawEmbedController.prototype._getEntryMode,
    _isFilePreviewEntry: ExcalidrawEmbedController.prototype._isFilePreviewEntry,
    _reloadEntry: (targetEntry) => {
      calls.push(['reload', targetEntry.filePath]);
    },
    _updateEmbedLabel: () => {
      calls.push('label');
    },
  };

  await ExcalidrawEmbedController.prototype._hydrateEntry.call(controller, entry);

  assert.deepEqual(calls, [
    'label',
    ['reload', 'sample-next.excalidraw'],
    'attach',
  ]);
});

test('parking a warm entry clears readiness and disconnects the parked room', () => {
  const originalWindow = globalThis.window;
  const entry = {
    bootFilePath: 'sample-next.excalidraw',
    bootMode: 'edit',
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: {} },
    isReady: true,
    loadedFilePath: 'sample-next.excalidraw',
    loadedMode: 'edit',
    placeholder: { isConnected: true },
    wrapper: {
      parentElement: null,
      classList: { toggle() {} },
      dataset: {},
      remove() {},
      setAttribute() {},
    },
  };
  const messages = [];
  const warmCacheRoot = {
    appendChild(node) {
      node.parentElement = warmCacheRoot;
    },
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const controller = {
      _ensureWarmCacheRoot: () => warmCacheRoot,
      _exitMaximizedEmbed: () => {},
      _postMessageToEntry: (_entry, payload) => {
        messages.push(payload);
      },
      _setEntryLoadingState: () => {},
    };

    ExcalidrawEmbedController.prototype._parkWarmEntry.call(controller, entry);

    assert.equal(entry.isParked, true);
    assert.equal(entry.isReady, false);
    assert.equal(entry.bootFilePath, null);
    assert.equal(entry.bootMode, null);
    assert.equal(entry.loadedFilePath, null);
    assert.equal(entry.loadedMode, null);
    assert.deepEqual(messages, [{
      source: 'collabmd-host',
      type: 'park-room',
    }]);
  } finally {
    globalThis.window = originalWindow;
  }
});

test('ignores ready messages from parked iframes', () => {
  const originalWindow = globalThis.window;
  const iframeWindow = {};
  const entry = {
    bootFilePath: null,
    bootMode: null,
    filePath: 'sample-next.excalidraw',
    iframe: { contentWindow: iframeWindow },
    isParked: true,
    isReady: false,
    key: 'sample-next.excalidraw#file-preview',
    wrapper: {},
  };

  globalThis.window = {
    location: { origin: 'http://localhost:4173' },
  };

  try {
    const posts = [];
    const controller = {
      embedEntries: new Map([[entry.key, entry]]),
      getTheme: () => 'dark',
      _clearEntryBootTimeout: () => {},
      _entryNeedsHardReload: () => false,
      _findEntryByContentWindow: ExcalidrawEmbedController.prototype._findEntryByContentWindow,
      _postMessageToEntry: (_entry, payload) => {
        posts.push(payload);
      },
      _setEntryLoadingState: () => {},
      _syncEntryFollowState: () => {},
      _syncEntryUser: () => {},
    };

    ExcalidrawEmbedController.prototype._onMessage.call(controller, {
      data: {
        source: 'excalidraw-editor',
        type: 'ready',
      },
      origin: 'http://localhost:4173',
      source: iframeWindow,
    });

    assert.equal(entry.isReady, false);
    assert.deepEqual(posts, []);
  } finally {
    globalThis.window = originalWindow;
  }
});
