import test from 'node:test';
import assert from 'node:assert/strict';

import { LayoutController } from '../../src/client/presentation/layout-controller.js';

function createClassList() {
  const tokens = new Set();
  return {
    add(token) {
      tokens.add(token);
    },
    contains(token) {
      return tokens.has(token);
    },
    remove(token) {
      tokens.delete(token);
    },
    toggle(token, force) {
      if (force === undefined) {
        if (tokens.has(token)) {
          tokens.delete(token);
          return false;
        }
        tokens.add(token);
        return true;
      }
      if (force) {
        tokens.add(token);
        return true;
      }
      tokens.delete(token);
      return false;
    },
  };
}

function createButton(view) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    classList: createClassList(),
    dataset: { view },
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    click() {
      listeners.get('click')?.();
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
  };
}

function createElement({ width = 0 } = {}) {
  const listeners = new Map();
  const attributes = new Map();
  return {
    classList: createClassList(),
    innerHTML: '',
    offsetWidth: width,
    style: {},
    addEventListener(type, handler) {
      listeners.set(type, handler);
    },
    getAttribute(name) {
      return attributes.get(name) ?? null;
    },
    setAttribute(name, value) {
      attributes.set(name, String(value));
    },
    trigger(type, event = {}) {
      listeners.get(type)?.(event);
    },
  };
}

function withDom({ isMobile = false } = {}, run) {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;

  const editorLayout = createElement({ width: 1000 });
  const editorPane = createElement({ width: 500 });
  const previewPane = createElement({ width: 500 });
  const mobileToggleButton = createElement();
  const viewButtons = ['split', 'editor', 'preview'].map(createButton);
  const unrelatedDiffButton = createButton(undefined);
  unrelatedDiffButton.classList.add('active');
  unrelatedDiffButton.setAttribute('aria-pressed', 'true');

  globalThis.document = {
    body: { style: {} },
    addEventListener() {},
    getElementById(id) {
      if (id === 'editorLayout') return editorLayout;
      if (id === 'editorPane') return editorPane;
      if (id === 'previewPane') return previewPane;
      if (id === 'mobileViewToggle') return mobileToggleButton;
      if (id === 'resizer') return null;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '#toolbarViewToggle [data-view]') {
        return viewButtons;
      }
      return [];
    },
  };
  globalThis.window = {
    matchMedia: () => ({ matches: isMobile }),
  };

  try {
    return run({
      editorLayout,
      mobileToggleButton,
      unrelatedDiffButton,
      viewButtons,
    });
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
  }
}

test('LayoutController reset restores the last desktop view after a temporary preview override', () => {
  withDom({ isMobile: false }, ({ editorLayout, viewButtons }) => {
    const controller = new LayoutController({
      mobileBreakpointQuery: { matches: false },
      onMeasureEditor: () => {},
    });

    controller.initialize();
    viewButtons.find((button) => button.dataset.view === 'editor')?.click();
    controller.setView('preview', { persist: false });
    controller.reset();

    assert.equal(editorLayout.getAttribute('data-view'), 'editor');
    assert.equal(viewButtons.find((button) => button.dataset.view === 'editor')?.getAttribute('aria-pressed'), 'true');
    assert.equal(viewButtons.find((button) => button.dataset.view === 'preview')?.getAttribute('aria-pressed'), 'false');
  });
});

test('LayoutController leaves unrelated diff controls unchanged', () => {
  withDom({ isMobile: false }, ({ unrelatedDiffButton, viewButtons }) => {
    const controller = new LayoutController({
      mobileBreakpointQuery: { matches: false },
      onMeasureEditor: () => {},
    });

    controller.initialize();
    viewButtons.find((button) => button.dataset.view === 'preview')?.click();

    assert.equal(unrelatedDiffButton.classList.contains('active'), true);
    assert.equal(unrelatedDiffButton.getAttribute('aria-pressed'), 'true');
  });
});

test('LayoutController reset preserves the mobile editor toggle after a temporary preview override', () => {
  withDom({ isMobile: true }, ({ editorLayout, mobileToggleButton }) => {
    const controller = new LayoutController({
      mobileBreakpointQuery: { matches: true },
      onMeasureEditor: () => {},
    });

    controller.initialize();
    controller.toggleMobileView();
    controller.setView('preview', { persist: false });
    controller.reset();

    assert.equal(editorLayout.getAttribute('data-view'), 'split');
    assert.match(mobileToggleButton.innerHTML, /Preview/);
  });
});

test('LayoutController lets view requests intercept segmented button changes', () => {
  withDom({ isMobile: false }, ({ editorLayout, viewButtons }) => {
    const requestedViews = [];
    const controller = new LayoutController({
      mobileBreakpointQuery: { matches: false },
      onMeasureEditor: () => {},
      onViewRequest(view) {
        requestedViews.push(view);
        return false;
      },
    });

    controller.initialize();
    viewButtons.find((button) => button.dataset.view === 'editor')?.click();

    assert.deepEqual(requestedViews, ['editor']);
    assert.equal(editorLayout.getAttribute('data-view'), 'split');
  });
});

test('LayoutController primes preferred view without applying it immediately', () => {
  withDom({ isMobile: false }, ({ editorLayout }) => {
    const controller = new LayoutController({
      mobileBreakpointQuery: { matches: false },
      onMeasureEditor: () => {},
    });

    controller.initialize();
    controller.primeView('editor');

    assert.equal(editorLayout.getAttribute('data-view'), 'split');
    controller.reset();
    assert.equal(editorLayout.getAttribute('data-view'), 'editor');
  });
});

test('LayoutController restores a stored desktop view and persists later changes', () => {
  withDom({ isMobile: false }, ({ editorLayout, viewButtons }) => {
    const persisted = [];
    const controller = new LayoutController({
      mobileBreakpointQuery: { matches: false },
      onMeasureEditor: () => {},
      onPreferredViewChange: (view) => persisted.push(view),
      preferredView: 'editor',
    });

    controller.initialize();
    assert.equal(editorLayout.getAttribute('data-view'), 'editor');

    viewButtons.find((button) => button.dataset.view === 'preview')?.click();
    assert.equal(editorLayout.getAttribute('data-view'), 'preview');
    assert.deepEqual(persisted, ['preview']);
  });
});
