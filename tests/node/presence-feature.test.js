import test from 'node:test';
import assert from 'node:assert/strict';

import { presenceFeature } from '../../src/client/application/app-shell/presence-feature.js';

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.filter(Boolean).forEach((token) => this.tokens.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.tokens.delete(token));
  }

  toggle(token, force) {
    if (force === true) {
      this.tokens.add(token);
      return true;
    }

    if (force === false) {
      this.tokens.delete(token);
      return false;
    }

    if (this.tokens.has(token)) {
      this.tokens.delete(token);
      return false;
    }

    this.tokens.add(token);
    return true;
  }

  contains(token) {
    return this.tokens.has(token);
  }
}

class FakeDocumentFragment {
  constructor() {
    this.children = [];
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = String(tagName).toUpperCase();
    this.attributes = new Map();
    this.children = [];
    this.classList = new FakeClassList();
    this._className = '';
    this.disabled = false;
    this.listeners = new Map();
    this.parentElement = null;
    this.style = {};
    this.textContent = '';
    this.type = '';
    this.popoverOpen = false;
  }

  get className() {
    return this._className;
  }

  set className(value) {
    this._className = String(value ?? '');
    this.classList = new FakeClassList();
    this._className.split(/\s+/u).filter(Boolean).forEach((token) => this.classList.add(token));
  }

  appendChild(child) {
    if (child instanceof FakeDocumentFragment) {
      child.children.forEach((entry) => this.appendChild(entry));
      return child;
    }

    this.children.push(child);
    child.parentElement = this;
    return child;
  }

  append(...children) {
    children.forEach((child) => this.appendChild(child));
  }

  replaceChildren(...children) {
    this.children = [];
    if (children.length > 0) {
      this.append(...children);
    }
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  matches(selector) {
    return selector === ':popover-open' && this.popoverOpen;
  }

  showPopover() {
    this.popoverOpen = true;
  }

  hidePopover() {
    this.popoverOpen = false;
  }

  click() {
    const handlers = this.listeners.get('click') ?? [];
    const event = {
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      target: this,
    };
    handlers.forEach((handler) => handler(event));
  }

  contains(target) {
    if (!target) {
      return false;
    }

    if (target === this) {
      return true;
    }

    return this.children.some((child) => child.contains?.(target));
  }
}

function createBadge() {
  return new FakeElement('button');
}

function createFakeDocument() {
  return {
    createDocumentFragment() {
      return new FakeDocumentFragment();
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
}

function getTreeText(node) {
  return `${node?.textContent ?? ''}${(node?.children ?? []).map((child) => getTreeText(child)).join('')}`;
}

function findFirstByClass(node, className) {
  if (node?.classList?.contains?.(className)) {
    return node;
  }

  for (const child of node?.children ?? []) {
    const match = findFirstByClass(child, className);
    if (match) {
      return match;
    }
  }

  return null;
}

function withFakeDocument(callback) {
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  globalThis.document = createFakeDocument();
  globalThis.requestAnimationFrame = (handler) => {
    handler();
    return 1;
  };

  try {
    callback();
  } finally {
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  }
}

function createPresenceContext(overrides = {}) {
  const userCount = new FakeElement('button');
  const userAvatars = new FakeElement('div');
  const presencePanel = new FakeElement('section');
  const presencePanelList = new FakeElement('div');
  const presencePanelStatus = new FakeElement('p');
  const followCalls = [];
  const navigateCalls = [];

  const context = {
    ...presenceFeature,
    closeChatPanel() {},
    closeToolbarOverflowMenu() {},
    connectionState: { status: 'connected', unreachable: false },
    currentFilePath: 'README.md',
    elements: {
      presencePanel,
      presencePanelList,
      presencePanelStatus,
      userAvatars,
      userCount,
    },
    followedCursorSignature: '',
    followedUserClientId: null,
    getDisplayName(filePath) {
      return String(filePath).replace(/\.md$/u, '');
    },
    globalUsers: [],
    isDrawioFile: () => false,
    isExcalidrawFile: () => false,
    isImageFile: () => false,
    navigation: {
      navigateToFile(filePath) {
        navigateCalls.push(filePath);
      },
    },
    presencePanelOpen: false,
    renderChat() {},
    renderPresence: presenceFeature.renderPresence,
    renderPresencePanel: presenceFeature.renderPresencePanel,
    renderAvatars: presenceFeature.renderAvatars,
    followUserCursor(user, options) {
      followCalls.push({ options, user });
    },
    openPresencePanel: presenceFeature.openPresencePanel,
    closePresencePanel: presenceFeature.closePresencePanel,
    startFollowingUser: presenceFeature.startFollowingUser,
    stopFollowingUser: presenceFeature.stopFollowingUser,
    toggleFollowUser: presenceFeature.toggleFollowUser,
    syncFollowedUser: presenceFeature.syncFollowedUser,
    ...overrides,
  };

  return {
    context,
    followCalls,
    navigateCalls,
    presencePanel,
    presencePanelList,
    presencePanelStatus,
    userAvatars,
    userCount,
  };
}

test('presenceFeature follows remote editor viewport before cursor fallback', () => {
  let scrollToViewportCalls = 0;
  let scrollToCursorCalls = 0;

  const context = {
    ...presenceFeature,
    currentFilePath: 'README.md',
    followedCursorSignature: '',
    isExcalidrawFile: () => false,
    resolveFileClientId: () => 7,
    session: {
      getUserCursor: () => ({ cursorAnchor: 90, cursorHead: 120, cursorLine: 8 }),
      getUserViewport: () => ({ topLine: 42, viewportRatio: 0.35 }),
      scrollToLine() {
        throw new Error('unexpected scrollToLine fallback');
      },
      scrollToPosition() {
        throw new Error('unexpected scrollToPosition fallback');
      },
      scrollToUserCursor() {
        scrollToCursorCalls += 1;
        return false;
      },
      scrollToUserViewport() {
        scrollToViewportCalls += 1;
        return true;
      },
    },
  };

  context.followUserCursor({ clientId: 'global-1', peerId: 'peer-1' }, { force: true });

  assert.equal(scrollToViewportCalls, 1);
  assert.equal(scrollToCursorCalls, 0);
  assert.match(context.followedCursorSignature, /^global-1:42:/);
});

test('presenceFeature routes excalidraw follow through the embed controller', async () => {
  const calls = [];
  const context = {
    ...presenceFeature,
    currentFilePath: 'diagram.excalidraw',
    followedCursorSignature: '',
    followedUserClientId: 'global-2',
    excalidrawEmbed: {
      async setFollowedUser(filePath, peerId) {
        calls.push({ filePath, peerId });
        return true;
      },
    },
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
  };

  context.followUserCursor({ clientId: 'global-2', peerId: 'peer-2' }, { force: true });
  await Promise.resolve();
  await Promise.resolve();

  assert.deepEqual(calls, [{
    filePath: 'diagram.excalidraw',
    peerId: 'peer-2',
  }]);
  assert.equal(context.followedCursorSignature, 'excalidraw:diagram.excalidraw:peer-2');
});

test('presenceFeature leaves Excalidraw follow retryable when the embed controller is not ready', async () => {
  const context = {
    ...presenceFeature,
    currentFilePath: 'diagram.excalidraw',
    followedCursorSignature: '',
    followedUserClientId: 'global-3',
    excalidrawEmbed: {
      async setFollowedUser() {
        return false;
      },
    },
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
  };

  context.followUserCursor({ clientId: 'global-3', peerId: 'peer-3' }, { force: true });
  await Promise.resolve();

  assert.equal(context.followedCursorSignature, '');
});

test('presenceFeature renders lobby presence on the empty workspace when no editor session exists', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'disconnected', unreachable: false },
    currentFilePath: null,
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: null,
  };

  context.renderPresence();

  assert.equal(badge.textContent, '1 online');
  assert.equal(badge.style.opacity, '1');
});

test('presenceFeature renders lobby presence for excalidraw routes without a markdown editor session', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'disconnected', unreachable: false },
    currentFilePath: 'diagram.excalidraw',
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: null,
  };

  context.renderPresence();

  assert.equal(badge.textContent, '1 online');
  assert.equal(badge.style.opacity, '1');
});

test('presenceFeature renders lobby presence for drawio routes without a markdown editor session', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'disconnected', unreachable: false },
    currentFilePath: 'diagram.drawio',
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    isDrawioFile: (filePath) => filePath.endsWith('.drawio'),
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: null,
  };

  context.renderPresence();

  assert.equal(badge.textContent, '1 online');
  assert.equal(badge.style.opacity, '1');
});

test('presenceFeature still prioritizes editor session connection state for markdown files', () => {
  const badge = createBadge();
  const context = {
    ...presenceFeature,
    connectionState: { status: 'connecting', unreachable: true },
    currentFilePath: 'README.md',
    elements: { userCount: badge },
    globalUsers: [{ clientId: 'local', isLocal: true, name: 'Andes' }],
    isExcalidrawFile: () => false,
    lobby: {
      getConnectionState() {
        return { status: 'connected', unreachable: false };
      },
    },
    session: {},
  };

  context.renderPresence();

  assert.equal(badge.textContent, 'Unreachable');
  assert.equal(badge.style.opacity, '0.6');
});

test('presenceFeature clears open trigger state when presence disconnects', () => {
  withFakeDocument(() => {
    const badge = createBadge();
    const presencePanel = new FakeElement('section');
    const presencePanelList = new FakeElement('div');
    const context = {
      ...presenceFeature,
      connectionState: { status: 'connecting', unreachable: false },
      currentFilePath: 'README.md',
      elements: {
        presencePanel,
        presencePanelList,
        userCount: badge,
      },
      globalUsers: [{ clientId: 'local', color: '#111111', currentFile: 'README.md', isLocal: true, name: 'Andes' }],
      isExcalidrawFile: () => false,
      presencePanelOpen: true,
      session: {},
    };
    presencePanel.showPopover();

    context.renderPresence();

    assert.equal(context.presencePanelOpen, false);
    assert.equal(badge.classList.contains('is-active'), false);
    assert.equal(presencePanel.matches(':popover-open'), false);
  });
});

test('presenceFeature does not suggest following when only the local user is online', () => {
  withFakeDocument(() => {
    const { context, presencePanelStatus } = createPresenceContext({
      globalUsers: [
        { clientId: 'local', color: '#111111', currentFile: 'README.md', isLocal: true, name: 'Owner' },
      ],
      presencePanelOpen: true,
    });

    context.renderPresencePanel();

    assert.equal(presencePanelStatus.textContent, 'You’re the only person here right now.');
  });
});

test('presenceFeature leaves the hidden participant list untouched', () => {
  withFakeDocument(() => {
    const { context, presencePanelList } = createPresenceContext({
      globalUsers: [
        { clientId: 'local', color: '#111111', currentFile: 'README.md', isLocal: true, name: 'Owner' },
      ],
      presencePanelOpen: false,
    });
    const existingRow = new FakeElement('article');
    presencePanelList.appendChild(existingRow);

    context.renderPresencePanel();

    assert.deepEqual(presencePanelList.children, [existingRow]);
  });
});

test('presenceFeature renders an overflow trigger for the participant popover', () => {
  withFakeDocument(() => {
    const { context, userAvatars } = createPresenceContext({
      globalUsers: [
        { clientId: 'local', color: '#111111', currentFile: 'README.md', isLocal: true, name: 'Owner' },
        { clientId: 'remote-1', color: '#222222', currentFile: 'README.md', isLocal: false, name: 'Amy' },
        { clientId: 'remote-2', color: '#333333', currentFile: 'README.md', isLocal: false, name: 'Ben' },
        { clientId: 'remote-3', color: '#444444', currentFile: 'README.md', isLocal: false, name: 'Cara' },
        { clientId: 'remote-4', color: '#555555', currentFile: 'README.md', isLocal: false, name: 'Drew' },
        { clientId: 'remote-5', color: '#666666', currentFile: 'README.md', isLocal: false, name: 'Eli' },
        { clientId: 'remote-6', color: '#777777', currentFile: 'README.md', isLocal: false, name: 'Fran' },
      ],
    });

    context.renderAvatars();

    assert.equal(userAvatars.children.length, 6);
    const overflowTrigger = userAvatars.children.at(-1);
    assert.equal(overflowTrigger.tagName, 'BUTTON');
    assert.equal(overflowTrigger.getAttribute('popovertarget'), 'presencePanel');
    assert.match(getTreeText(overflowTrigger), /\+2/);
  });
});

test('presenceFeature orders panel users with local first, followed next, then alphabetical', () => {
  withFakeDocument(() => {
    const { context, presencePanelList, presencePanelStatus } = createPresenceContext({
      followedUserClientId: 'remote-bob',
      globalUsers: [
        { clientId: 'remote-zoe', color: '#555555', currentFile: 'docs/zoe.md', isLocal: false, name: 'Zoe' },
        { clientId: 'local', color: '#111111', currentFile: 'README.md', isLocal: true, name: 'Owner' },
        { clientId: 'remote-bob', color: '#333333', currentFile: 'docs/bob.md', isLocal: false, name: 'Bob' },
        { clientId: 'remote-alice', color: '#222222', currentFile: null, isLocal: false, name: 'Alice' },
      ],
      presencePanelOpen: true,
    });

    context.renderPresencePanel();

    assert.equal(presencePanelStatus.textContent, '3 teammates online. Select someone to follow.');

    const names = presencePanelList.children.map((row) => getTreeText(findFirstByClass(row, 'presence-panel-user-name')));
    assert.deepEqual(names, ['Owner', 'Bob', 'Alice', 'Zoe']);

    const fileLabels = presencePanelList.children.map((row) => getTreeText(findFirstByClass(row, 'presence-panel-user-file')));
    assert.deepEqual(fileLabels, ['Here', 'docs/bob', 'No file', 'docs/zoe']);
  });
});

test('presenceFeature renders a non-clickable local row and a stop action for the followed user', () => {
  withFakeDocument(() => {
    const { context, presencePanelList } = createPresenceContext({
      followedUserClientId: 'remote-followed',
      globalUsers: [
        { clientId: 'local', color: '#111111', currentFile: 'README.md', isLocal: true, name: 'Owner' },
        { clientId: 'remote-followed', color: '#222222', currentFile: 'README.md', isLocal: false, name: 'Teammate' },
      ],
      presencePanelOpen: true,
    });

    context.renderPresencePanel();

    const localRow = presencePanelList.children[0];
    const localPrimaryAction = findFirstByClass(localRow, 'presence-panel-user-button');
    assert.equal(localPrimaryAction.tagName, 'DIV');
    assert.equal((localPrimaryAction.listeners.get('click') ?? []).length, 0);

    const followedRow = presencePanelList.children[1];
    const stopButton = findFirstByClass(followedRow, 'presence-panel-user-stop');
    assert.ok(stopButton);
    stopButton.click();

    assert.equal(context.followedUserClientId, null);
    assert.equal(context.presencePanelOpen, false);
  });
});
