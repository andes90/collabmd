import test from 'node:test';
import assert from 'node:assert/strict';

import { DiagramPreviewHydrator } from '../../src/client/application/diagram-preview-hydrator.js';

function attributeNameToDatasetKey(attributeName) {
  return attributeName
    .replace(/^data-/, '')
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
}

class FakeClassList {
  constructor(initial = []) {
    this.values = new Set(initial);
  }

  add(...tokens) {
    tokens.forEach((token) => this.values.add(token));
  }

  remove(...tokens) {
    tokens.forEach((token) => this.values.delete(token));
  }

  contains(token) {
    return this.values.has(token);
  }
}

class FakeSourceNode {
  constructor(textContent = '') {
    this.textContent = textContent;
    this.hidden = true;
  }

  cloneNode() {
    const clone = new FakeSourceNode(this.textContent);
    clone.hidden = this.hidden;
    return clone;
  }
}

class FakeShell {
  constructor({
    dataset = {},
    source = '',
    maximized = false,
  } = {}) {
    this.dataset = { ...dataset };
    this.classList = new FakeClassList(['diagram-shell', ...(maximized ? ['is-maximized'] : [])]);
    this.isConnected = true;
    this.replacedWith = null;
    this.sourceNode = new FakeSourceNode(source);
  }

  querySelector(selector) {
    if (selector === '.diagram-source') {
      return this.sourceNode;
    }

    return null;
  }

  remove() {
    this.isConnected = false;
  }

  removeAttribute(attributeName) {
    delete this.dataset[attributeNameToDatasetKey(attributeName)];
  }

  getAttribute(attributeName) {
    const datasetKey = attributeNameToDatasetKey(attributeName);
    return this.dataset[datasetKey] ?? null;
  }

  setAttribute(attributeName, value) {
    this.dataset[attributeNameToDatasetKey(attributeName)] = String(value);
  }

  prepend(node) {
    this.sourceNode = node;
  }

  replaceWith(node) {
    this.replacedWith = node;
    node.isConnected = true;
  }
}

class FakePreviewElement {
  constructor(shells = []) {
    this.shells = shells;
  }

  setShells(shells) {
    this.shells = shells;
  }

  querySelectorAll(selector) {
    return this.shells.filter((shell) => {
      if (!shell.classList.contains('diagram-shell')) {
        return false;
      }

      if (selector.includes('[data-diagram-hydrated="true"]') && shell.dataset.diagramHydrated !== 'true') {
        return false;
      }

      if (selector.includes('[data-diagram-key]') && !shell.dataset.diagramKey) {
        return false;
      }

      return true;
    });
  }
}

class TestDiagramPreviewHydrator extends DiagramPreviewHydrator {
  constructor(renderer, options = {}) {
    super(renderer, {
      batchSize: options.batchSize ?? 2,
      cancelIdleRenderFn: options.cancelIdleRenderFn ?? (() => {}),
      datasetKeys: {
        hydrated: 'diagramHydrated',
        instanceId: 'diagramInstanceId',
        key: 'diagramKey',
        label: 'diagramLabel',
        queued: 'diagramQueued',
        sourceHash: 'diagramSourceHash',
        sourceLine: 'sourceLine',
        sourceLineEnd: 'sourceLineEnd',
        target: 'diagramTarget',
      },
      fetchFn: options.fetchFn,
      filePathLabel: 'Diagram',
      intersectionObserverFactory: options.intersectionObserverFactory,
      isNearViewportFn: options.isNearViewportFn,
      requestAnimationFrameFn: options.requestAnimationFrameFn,
      requestIdleRenderFn: options.requestIdleRenderFn ?? (() => 1),
      shellClassName: 'diagram-shell',
      sourceClassName: 'diagram-source',
    });
    this.batchContext = options.batchContext ?? null;
    this.hydratedShells = [];
    this.prepareCalls = 0;
    this.reconcileEvents = [];
  }

  async prepareHydrationBatch() {
    this.prepareCalls += 1;
    return this.batchContext;
  }

  handleReconcile(event) {
    this.reconcileEvents.push(event);
  }

  async hydrateShell(shell, batchContext) {
    this.hydratedShells.push({
      batchContext,
      key: shell.dataset.diagramKey,
    });
    this.markShellHydrated(shell);
  }
}

function createRenderer(previewElement) {
  return {
    activeRenderVersion: 1,
    hydrationPaused: false,
    isLargeDocument: false,
    phaseChanges: [],
    previewContainer: {},
    previewElement,
    setPhase(phase) {
      this.phaseChanges.push(phase);
    },
    updateCount: 0,
    updateHydrationPhase() {
      this.updateCount += 1;
    },
  };
}

function createWindowStub() {
  return {
    __COLLABMD_CONFIG__: { basePath: '/app' },
    location: {
      origin: 'http://localhost:3000',
    },
  };
}

test('DiagramPreviewHydrator deduplicates in-flight source fetches by target path', async (t) => {
  const originalWindow = globalThis.window;
  globalThis.window = createWindowStub();
  t.after(() => {
    globalThis.window = originalWindow;
  });

  const requests = [];
  const hydrator = new TestDiagramPreviewHydrator(createRenderer(new FakePreviewElement()), {
    fetchFn: async (url) => {
      requests.push(url);
      return new Response(JSON.stringify({ content: 'sequenceDiagram\nA->>B: hi' }), {
        headers: { 'Content-Type': 'application/json' },
        status: 200,
      });
    },
  });

  const [first, second] = await Promise.all([
    hydrator.fetchSource('docs/flow.mmd'),
    hydrator.fetchSource('docs/flow.mmd'),
  ]);

  assert.equal(first, 'sequenceDiagram\nA->>B: hi');
  assert.equal(second, first);
  assert.deepEqual(requests, ['/app/api/file?path=docs%2Fflow.mmd']);
});

test('DiagramPreviewHydrator preserves matching hydrated shells across render commits', () => {
  const preservedShell = new FakeShell({
    dataset: {
      diagramHydrated: 'true',
      diagramKey: 'diagram-1',
      diagramTarget: 'docs/flow.mmd',
    },
    maximized: true,
    source: 'graph TD;',
  });
  const previewElement = new FakePreviewElement([preservedShell]);
  const hydrator = new TestDiagramPreviewHydrator(createRenderer(previewElement));

  hydrator.preserveHydratedShellsForCommit();

  const nextShell = new FakeShell({
    dataset: {
      diagramKey: 'diagram-1',
      diagramTarget: 'docs/flow.mmd',
    },
    source: 'graph TD;',
  });
  previewElement.setShells([nextShell]);

  hydrator.reconcileHydratedShells();

  assert.equal(nextShell.replacedWith, preservedShell);
  assert.deepEqual(hydrator.reconcileEvents, [{ restoredMaximizedShell: true }]);
});

test('DiagramPreviewHydrator batches queued shells and preserves priority order', async () => {
  const previewElement = new FakePreviewElement();
  const idleCallbacks = [];
  const renderer = createRenderer(previewElement);
  const hydrator = new TestDiagramPreviewHydrator(renderer, {
    batchContext: 'shared-runtime',
    batchSize: 2,
    requestIdleRenderFn: (callback) => {
      idleCallbacks.push(callback);
      return idleCallbacks.length;
    },
  });

  const shellA = new FakeShell({ dataset: { diagramKey: 'A' } });
  const shellB = new FakeShell({ dataset: { diagramKey: 'B' } });
  const shellC = new FakeShell({ dataset: { diagramKey: 'C' } });

  hydrator.enqueueShell(shellA);
  hydrator.enqueueShell(shellB);
  hydrator.enqueueShell(shellC, { prioritize: true });

  assert.equal(idleCallbacks.length, 1);

  hydrator.idleId = null;
  await hydrator.flushHydrationQueue();

  assert.deepEqual(hydrator.hydratedShells, [
    { batchContext: 'shared-runtime', key: 'C' },
    { batchContext: 'shared-runtime', key: 'A' },
  ]);
  assert.equal(hydrator.pendingShells.length, 1);
  assert.equal(hydrator.pendingShells[0], shellB);
  assert.equal(idleCallbacks.length, 2);
  assert.deepEqual(renderer.phaseChanges, ['hydrating']);
});
