import test from 'node:test';
import assert from 'node:assert/strict';

import { MermaidPreviewHydrator } from '../../src/client/application/mermaid-preview-hydrator.js';

test('MermaidPreviewHydrator loads embedded Mermaid file sources through the injected loader', async (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      classList: {
        add() {},
        remove() {},
      },
      querySelector() {
        return null;
      },
    },
    documentElement: {
      dataset: {},
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  const loaderCalls = [];
  const hydrator = new MermaidPreviewHydrator({
    previewElement: null,
  }, {
    loadFileSource: async (filePath) => {
      loaderCalls.push(filePath);
      return 'graph TD\nA-->B';
    },
  });

  const [first, second] = await Promise.all([
    hydrator.fetchSource('docs/flow.mmd'),
    hydrator.fetchSource('docs/flow.mmd'),
  ]);

  assert.equal(first, 'graph TD\nA-->B');
  assert.equal(second, first);
  assert.deepEqual(loaderCalls, ['docs/flow.mmd']);
});

test('MermaidPreviewHydrator configures embedded renders with SVG text labels', (t) => {
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      classList: {
        add() {},
        remove() {},
      },
      querySelector() {
        return null;
      },
    },
    documentElement: {
      dataset: {},
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });

  let initializedConfig = null;
  const hydrator = new MermaidPreviewHydrator({
    previewElement: null,
  });
  hydrator.configureMermaid({
    initialize(config) {
      initializedConfig = config;
    },
  });

  assert.equal(initializedConfig.htmlLabels, false);
  assert.equal(initializedConfig.flowchart.htmlLabels, false);
});

const MERMAID_TEST_SOURCE = 'graph TD\nA-->B';
const MERMAID_TEST_MARKUP = '<svg width="132" height="82" viewBox="-16 -16 132 82"></svg>';

function createSvgStub() {
  return {
    getAttribute() {
      return null;
    },
    getBBox() {
      return { height: 50, width: 100, x: 0, y: 0 };
    },
    nodeName: 'svg',
    outerHTML: MERMAID_TEST_MARKUP,
    setAttribute() {},
  };
}

function createShellStub(sourceText) {
  const sourceNode = { textContent: sourceText };
  return {
    appendChild() {},
    attributes: {},
    dataset: {},
    getAttribute(name) {
      return this.attributes[name] ?? null;
    },
    isConnected: true,
    querySelector(selector) {
      if (selector === '.mermaid-source') {
        return sourceNode;
      }
      return null;
    },
    removeAttribute(name) {
      delete this.attributes[name];
    },
    setAttribute(name, value) {
      this.attributes[name] = String(value);
    },
  };
}

function installMermaidDocumentStub(t, hooks) {
  const originalDocument = globalThis.document;
  globalThis.document = {
    body: {
      appendChild() {
        hooks.bodyAppends += 1;
      },
    },
    createElement(tag) {
      if (tag === 'template') {
        return {
          content: {
            querySelector() {
              return hooks.templateSvg;
            },
          },
          set innerHTML(_value) {},
        };
      }
      const element = {
        children: [],
        isConnected: true,
        parentElement: null,
        querySelector(selector) {
          if (selector === 'svg') {
            return hooks.renderedSvg;
          }
          return null;
        },
        setAttribute() {},
        style: {},
      };
      element.appendChild = (child) => {
        child.parentElement = element;
        element.children.push(child);
      };
      element.remove = () => {
        element.parentElement = null;
      };
      return element;
    },
    documentElement: {
      dataset: {},
    },
  };
  t.after(() => {
    globalThis.document = originalDocument;
  });
}

function createMermaidHooks() {
  return {
    bodyAppends: 0,
    mountCalls: [],
    renderedSvg: createSvgStub(),
    runCalls: [],
    templateSvg: {
      getAttribute(name) {
        return { height: '82', viewBox: '0 0 132 82', width: '132' }[name] ?? null;
      },
      nodeName: 'svg',
    },
  };
}

function createMermaidHarness(hooks) {
  const diagramChrome = {
    mount(shell, options) {
      hooks.mountCalls.push({ options, shell });
    },
  };
  const renderer = {
    activeRenderVersion: 7,
    diagramChrome,
    getSourceFilePath: () => 'notes/doc.md',
    onPreviewLayoutChange() {},
    previewElement: {
      querySelectorAll() {
        return [];
      },
    },
  };
  const mermaid = {
    async render(id, source) {
      hooks.runCalls.push({ id, source });
      return { svg: MERMAID_TEST_MARKUP };
    },
  };
  const hydrator = new MermaidPreviewHydrator(renderer, {});
  return { hydrator, mermaid };
}

test('MermaidPreviewHydrator serves repeated diagrams from the render cache', async (t) => {
  const hooks = createMermaidHooks();
  installMermaidDocumentStub(t, hooks);
  const { hydrator, mermaid } = createMermaidHarness(hooks);

  await hydrator.hydrateShell(createShellStub(MERMAID_TEST_SOURCE), mermaid, {});
  assert.equal(hooks.runCalls.length, 1);
  assert.equal(hooks.mountCalls.length, 1);
  assert.equal(hydrator.renderCache.size, 1);

  const shell = createShellStub(MERMAID_TEST_SOURCE);
  await hydrator.hydrateShell(shell, mermaid, {});

  assert.equal(hooks.runCalls.length, 1);
  assert.equal(hooks.mountCalls.length, 2);
  assert.equal(hooks.bodyAppends, 1);
  assert.equal(shell._diagramRenderedSource, MERMAID_TEST_SOURCE);
  assert.deepEqual(
    [hooks.mountCalls[1].options.baseWidth, hooks.mountCalls[1].options.baseHeight],
    [132, 82],
  );
});

test('MermaidPreviewHydrator re-renders when the theme changes the cache key', async (t) => {
  const hooks = createMermaidHooks();
  installMermaidDocumentStub(t, hooks);
  const { hydrator, mermaid } = createMermaidHarness(hooks);

  await hydrator.hydrateShell(createShellStub(MERMAID_TEST_SOURCE), mermaid, {});
  hydrator.currentTheme = 'light';
  await hydrator.hydrateShell(createShellStub(MERMAID_TEST_SOURCE), mermaid, {});

  assert.equal(hooks.runCalls.length, 2);
  assert.equal(hydrator.renderCache.size, 2);
});

test('MermaidPreviewHydrator falls back to rendering when a cache entry is corrupt', async (t) => {
  const hooks = createMermaidHooks();
  installMermaidDocumentStub(t, hooks);
  const { hydrator, mermaid } = createMermaidHarness(hooks);

  const cacheKey = hydrator.getRenderCacheKey(hydrator.prepareSource(MERMAID_TEST_SOURCE));
  hydrator.renderCache.set(cacheKey, 'not-an-svg');
  hooks.templateSvg = null;

  await hydrator.hydrateShell(createShellStub(MERMAID_TEST_SOURCE), mermaid, {});

  assert.equal(hooks.runCalls.length, 1);
  assert.equal(hooks.mountCalls.length, 1);
  assert.equal(hydrator.renderCache.get(cacheKey), MERMAID_TEST_MARKUP);
});

test('MermaidPreviewHydrator skips re-rendering all shells when the theme is unchanged', (t) => {
  installMermaidDocumentStub(t, createMermaidHooks());
  const { hydrator } = createMermaidHarness(createMermaidHooks());

  let initializeCalls = 0;
  hydrator.runtime = {
    initialize() {
      initializeCalls += 1;
    },
  };
  hydrator.currentTheme = 'dark';

  hydrator.applyTheme('dark');
  assert.equal(initializeCalls, 0);

  hydrator.applyTheme('light');
  assert.equal(initializeCalls, 1);
  assert.equal(hydrator.currentTheme, 'light');
});

test('MermaidPreviewHydrator bounds the render cache', (t) => {
  installMermaidDocumentStub(t, createMermaidHooks());
  const { hydrator } = createMermaidHarness(createMermaidHooks());

  for (let index = 0; index < 35; index += 1) {
    hydrator.storeRenderCache(`key-${index}`, '<svg></svg>');
  }

  assert.equal(hydrator.renderCache.size, 30);
  assert.equal(hydrator.renderCache.has('key-0'), false);
  assert.equal(hydrator.renderCache.has('key-34'), true);
});
