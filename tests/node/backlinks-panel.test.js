import test from 'node:test';
import assert from 'node:assert/strict';

import { BacklinksPanel } from '../../src/client/presentation/backlinks-panel.js';

class FakeClassList {
  constructor() {
    this.tokens = new Set();
  }

  add(...tokens) {
    tokens.forEach((token) => this.tokens.add(token));
  }

  contains(token) {
    return this.tokens.has(token);
  }

  remove(...tokens) {
    tokens.forEach((token) => this.tokens.delete(token));
  }

  set(value) {
    this.tokens = new Set(String(value || '').split(/\s+/).filter(Boolean));
  }

  toggle(token, force) {
    if (force === undefined) {
      if (this.tokens.has(token)) {
        this.tokens.delete(token);
        return false;
      }

      this.tokens.add(token);
      return true;
    }

    if (force) {
      this.tokens.add(token);
      return true;
    }

    this.tokens.delete(token);
    return false;
  }
}

class FakeFragment {
  constructor() {
    this.children = [];
    this.isFragment = true;
  }

  appendChild(child) {
    this.children.push(child);
    return child;
  }
}

class FakeElement {
  constructor(tagName = 'div') {
    this.tagName = tagName.toUpperCase();
    this.children = [];
    this.parentElement = null;
    this.listeners = new Map();
    this.attributes = new Map();
    this.classList = new FakeClassList();
    this._textContent = '';
    this._innerHTML = '';
    this.type = '';
  }

  set className(value) {
    this.classList.set(value);
  }

  get className() {
    return [...this.classList.tokens].join(' ');
  }

  set innerHTML(value) {
    this._innerHTML = String(value);
    this.children = [];
  }

  get innerHTML() {
    return this._innerHTML;
  }

  set textContent(value) {
    this._textContent = String(value);
    this.children = [];
  }

  get textContent() {
    if (this.children.length > 0) {
      return this.children.map((child) => child.textContent).join('');
    }

    return this._textContent;
  }

  appendChild(child) {
    if (child?.isFragment) {
      child.children.forEach((fragmentChild) => this.appendChild(fragmentChild));
      return child;
    }

    child.parentElement = this;
    this.children.push(child);
    return child;
  }

  addEventListener(type, handler) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.push(handler);
    this.listeners.set(type, handlers);
  }

  trigger(type, event = {}) {
    const handlers = this.listeners.get(type) ?? [];
    handlers.forEach((handler) => handler({
      currentTarget: this,
      preventDefault() {},
      stopPropagation() {},
      target: this,
      ...event,
    }));
  }

  click() {
    this.trigger('click');
  }

  contains(node) {
    let current = node;
    while (current) {
      if (current === this) {
        return true;
      }
      current = current.parentElement;
    }
    return false;
  }

  querySelector(selector) {
    const match = (element) => {
      if (selector.startsWith('.')) {
        return element.classList.contains(selector.slice(1));
      }

      const attrMatch = selector.match(/^\[([^=]+)="([^"]+)"\]$/);
      if (attrMatch) {
        return element.getAttribute(attrMatch[1]) === attrMatch[2];
      }

      return false;
    };

    const stack = [...this.children];
    while (stack.length > 0) {
      const current = stack.shift();
      if (match(current)) {
        return current;
      }
      stack.unshift(...current.children);
    }

    return null;
  }

  querySelectorAll(selector) {
    const matches = [];
    const stack = [...this.children];
    while (stack.length > 0) {
      const current = stack.shift();
      if (selector.startsWith('.') && current.classList.contains(selector.slice(1))) {
        matches.push(current);
      }
      stack.unshift(...current.children);
    }
    return matches;
  }

  setAttribute(name, value) {
    this.attributes.set(name, String(value));
  }

  getAttribute(name) {
    return this.attributes.get(name) ?? null;
  }

  toggleAttribute(name, force) {
    if (force) {
      this.attributes.set(name, '');
      return true;
    }

    this.attributes.delete(name);
    return false;
  }
}

function createPanelStructure({ includeDockWrapper = false } = {}) {
  const root = includeDockWrapper ? new FakeElement('div') : new FakeElement('div');
  const panel = new FakeElement('div');
  panel.className = 'backlinks-panel';

  if (includeDockWrapper) {
    panel.setAttribute('data-backlinks-variant', 'dock');
    root.appendChild(panel);
  }

  const target = includeDockWrapper ? panel : root;
  const header = new FakeElement('div');
  header.className = 'backlinks-header';
  const toggle = new FakeElement('span');
  toggle.className = 'backlinks-toggle';
  const count = new FakeElement('span');
  count.className = 'backlinks-count';
  const body = new FakeElement('div');
  body.className = 'backlinks-body';
  const list = new FakeElement('div');
  list.className = 'backlinks-list';

  header.appendChild(toggle);
  header.appendChild(count);
  body.appendChild(list);
  target.appendChild(header);
  target.appendChild(body);

  return {
    body,
    count,
    header,
    list,
    panel: target,
    root,
    toggle,
  };
}

function installDocumentStub(t) {
  const listeners = new Map();
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  globalThis.document = {
    addEventListener(type, handler) {
      const handlers = listeners.get(type) ?? [];
      handlers.push(handler);
      listeners.set(type, handlers);
    },
    createDocumentFragment() {
      return new FakeFragment();
    },
    createElement(tagName) {
      return new FakeElement(tagName);
    },
  };
  globalThis.window = {
    __COLLABMD_CONFIG__: {},
    location: {
      origin: 'http://localhost',
    },
  };

  t.after(() => {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  });

  return {
    documentRef: globalThis.document,
    dispatch(type, event = {}) {
      (listeners.get(type) ?? []).forEach((handler) => handler(event));
    },
  };
}

function installFetchStub(t, responses) {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => ({
    async json() {
      const requestUrl = new URL(url, 'http://localhost');
      const filePath = requestUrl.searchParams.get('file') ?? '';
      return {
        backlinks: responses[filePath] ?? [],
      };
    },
  });

  t.after(() => {
    globalThis.fetch = originalFetch;
  });
}

function createBacklinksPanel(t, responses, { onFileSelect } = {}) {
  const documentHarness = installDocumentStub(t);
  installFetchStub(t, responses);

  const dock = createPanelStructure({ includeDockWrapper: true });
  const inline = createPanelStructure();
  const panel = new BacklinksPanel({
    documentRef: documentHarness.documentRef,
    inlinePanelElement: inline.root,
    onFileSelect,
    panelElement: dock.root,
  });

  return {
    dock,
    documentHarness,
    inline,
    panel,
  };
}

test('BacklinksPanel hides linked mentions when there is no current file or no backlinks', async (t) => {
  const { dock, inline, panel } = createBacklinksPanel(t, {
    'empty.md': [],
  });

  panel.clear();
  assert.equal(dock.root.classList.contains('hidden'), true);
  assert.equal(inline.root.classList.contains('hidden'), true);

  await panel.load('empty.md');

  assert.equal(dock.root.classList.contains('hidden'), true);
  assert.equal(inline.root.classList.contains('hidden'), true);
  assert.equal(dock.toggle.textContent, 'Linked Mentions');
  assert.equal(inline.toggle.textContent, 'Linked Mentions');
});

test('BacklinksPanel renders the mention count and collapses again when the file changes', async (t) => {
  const { dock, inline, panel } = createBacklinksPanel(t, {
    'projects/collabmd.md': [
      { file: 'README.md', contexts: ['- [[projects/collabmd]]'] },
      { file: 'daily/2026-03-05.md', contexts: ['- [ ] Review the [[projects/collabmd]] vault feature'] },
    ],
    'showcase.md': [
      { file: 'README.md', contexts: ['- [[showcase]]'] },
    ],
  });

  await panel.load('projects/collabmd.md');

  assert.equal(dock.root.classList.contains('hidden'), false);
  assert.equal(inline.root.classList.contains('hidden'), false);
  assert.equal(dock.toggle.textContent, 'Linked Mentions');
  assert.equal(inline.toggle.textContent, 'Linked Mentions');
  assert.equal(dock.count.textContent, '2');
  assert.equal(inline.count.textContent, '2');
  assert.equal(dock.list.querySelectorAll('.backlink-item').length, 2);
  assert.equal(inline.list.querySelectorAll('.backlink-item').length, 2);

  dock.header.click();
  assert.equal(dock.panel.classList.contains('expanded'), true);
  assert.equal(inline.panel.classList.contains('expanded'), true);

  await panel.load('showcase.md');

  assert.equal(dock.panel.classList.contains('expanded'), false);
  assert.equal(inline.panel.classList.contains('expanded'), false);
  assert.equal(dock.toggle.textContent, 'Linked Mention');
  assert.equal(inline.toggle.textContent, 'Linked Mention');
});

test('BacklinksPanel closes on escape, outside tap, and item selection', async (t) => {
  const selectedFiles = [];
  const { dock, documentHarness, panel } = createBacklinksPanel(t, {
    'projects/collabmd.md': [
      { file: 'README.md', contexts: ['- [[projects/collabmd]]'] },
    ],
  }, {
    onFileSelect(filePath) {
      selectedFiles.push(filePath);
    },
  });

  await panel.load('projects/collabmd.md');

  dock.header.click();
  assert.equal(dock.panel.classList.contains('expanded'), true);

  documentHarness.dispatch('keydown', { key: 'Escape', preventDefault() {} });
  assert.equal(dock.panel.classList.contains('expanded'), false);

  dock.header.click();
  const outsideTarget = new FakeElement('div');
  documentHarness.dispatch('pointerdown', {
    button: 0,
    clientX: 40,
    clientY: 24,
    pointerId: 1,
    pointerType: 'touch',
    target: outsideTarget,
  });
  documentHarness.dispatch('pointerup', {
    button: 0,
    clientX: 40,
    clientY: 24,
    pointerId: 1,
    pointerType: 'touch',
    target: outsideTarget,
  });
  assert.equal(dock.panel.classList.contains('expanded'), false);

  dock.header.click();
  const item = dock.list.querySelector('.backlink-item');
  item.click();

  assert.deepEqual(selectedFiles, ['README.md']);
  assert.equal(dock.panel.classList.contains('expanded'), false);
});
