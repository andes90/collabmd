import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspacePreviewController } from '../../src/client/application/workspace-preview-controller.js';

function createController(overrides = {}) {
  const getSession = overrides.getSession
    ?? (() => (Object.hasOwn(overrides, 'session') ? overrides.session : { getText: () => 'graph TD\nA-->B' }));

  const controller = new WorkspacePreviewController({
    backlinksPanel: { clear() {}, setDisplayMode() {}, ...(overrides.backlinksPanel || {}) },
    basesPreview: overrides.basesPreview,
    drawioEmbed: {
      detachForCommit() {},
      hydrateVisibleEmbeds() {},
      reconcileEmbeds() {},
      setHydrationPaused() {},
      syncLayout() {},
      updateLocalUser() {},
      updateTheme() {},
      ...(overrides.drawioEmbed || {}),
    },
    elements: overrides.elements ?? {
      markdownToolbar: { classList: { toggle() {} } },
      outlineToggle: { classList: { toggle() {} } },
      previewContent: { classList: { add() {}, remove() {}, toggle() {} } },
    },
    excalidrawEmbed: {
      detachForCommit() {},
      hydrateVisibleEmbeds() {},
      reconcileEmbeds() {},
      setHydrationPaused() {},
      syncLayout() {},
      updateLocalUser() {},
      updateTheme() {},
      ...(overrides.excalidrawEmbed || {}),
    },
    getDisplayName: (filePath) => filePath,
    getSession,
    layoutController: { setView() {}, ...(overrides.layoutController || {}) },
    outlineController: { close() {}, scheduleActiveHeadingUpdate() {}, ...(overrides.outlineController || {}) },
    previewRenderer: {
      scheduleActiveMermaidRefit() {},
      scheduleActivePlantUmlRefit() {},
      setHydrationPaused() {},
      ...(overrides.previewRenderer || {}),
    },
    scrollSyncController: { invalidatePreviewBlocks() {}, warmPreviewBlocks() {}, ...(overrides.scrollSyncController || {}) },
    structurizrPreview: overrides.structurizrPreview,
  });
  if (overrides.schedulePreviewLayoutSync) {
    controller.schedulePreviewLayoutSync = overrides.schedulePreviewLayoutSync;
  }
  return controller;
}

test('WorkspacePreviewController wraps Mermaid and PlantUML file content for preview rendering', () => {
  const controller = createController({
    session: { getText: () => 'graph TD\nA-->B' },
  });

  assert.equal(
    controller.getPreviewSource('diagram.mmd'),
    '```mermaid\ngraph TD\nA-->B\n```',
  );
  assert.equal(
    controller.getPreviewSource('diagram.puml'),
    '```plantuml\ngraph TD\nA-->B\n```',
  );
  assert.equal(
    controller.getPreviewSource('README.md'),
    'graph TD\nA-->B',
  );
  assert.equal(
    controller.getPreviewSource('diagram.drawio', { drawioMode: 'text' }),
    '```xml\ngraph TD\nA-->B\n```',
  );
});

test('WorkspacePreviewController labels PlantUML formatting as indentation', () => {
  const attributes = {};
  const label = { textContent: '' };
  let hidden = true;
  const controller = createController({
    elements: {
      editorFormatButton: {
        classList: { toggle: (_name, value) => { hidden = value; } },
        querySelector: () => label,
        setAttribute: (name, value) => { attributes[name] = value; },
      },
    },
  });

  controller.syncFileChrome('diagram.puml');

  assert.equal(hidden, false);
  assert.equal(attributes['aria-label'], 'Indent PlantUML document');
  assert.equal(attributes.title, 'Indent PlantUML document');
  assert.equal(label.textContent, 'Indent');
});

test('WorkspacePreviewController pauses, resumes, and resets pending preview layout work', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const events = [];
  const controller = createController({
    elements: {
      previewContent: { classList: { contains: () => false }, dataset: { renderPhase: 'ready' } },
    },
    excalidrawEmbed: {
      setHydrationPaused(value) {
        events.push(['embed', value]);
      },
      syncLayout() {
        events.push(['sync-layout']);
      },
    },
    previewRenderer: {
      setHydrationPaused(value) {
        events.push(['preview', value]);
      },
    },
  });

  controller.schedulePreviewLayoutSync({ delayMs: 20 });
  controller.handleEditorScrollActivityChange(true);
  controller.schedulePreviewLayoutSync({ delayMs: 0 });
  t.mock.timers.tick(20);
  assert.deepEqual(events, [
    ['preview', true],
    ['embed', true],
  ]);

  controller.handleEditorScrollActivityChange(false);
  t.mock.timers.tick(1);
  assert.deepEqual(events, [
    ['preview', true],
    ['embed', true],
    ['preview', false],
    ['embed', false],
    ['sync-layout'],
  ]);

  controller.schedulePreviewLayoutSync({ delayMs: 20 });
  controller.resetPreviewLayoutSync();
  t.mock.timers.tick(20);
  assert.equal(events.filter(([type]) => type === 'sync-layout').length, 1);
  controller.handleEditorScrollActivityChange(true);
  controller.resetPreviewLayoutSync();
  assert.equal(controller.previewHydrationPaused, false);
  assert.equal(controller.pendingPreviewLayoutSync, false);
  assert.equal(controller.previewLayoutSyncTimer, null);
});

test('WorkspacePreviewController forces Excalidraw files into preview without overwriting layout preference', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
      setDisplayMode(mode) {
        events.push(['backlinks-mode', mode]);
      },
    },
  });

  controller.syncFileChrome('diagram.excalidraw');

  assert.deepEqual(events, [
    ['backlinks-mode', 'header'],
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
});

test('WorkspacePreviewController forces draw.io files into preview without overwriting layout preference', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
      setDisplayMode(mode) {
        events.push(['backlinks-mode', mode]);
      },
    },
  });

  controller.syncFileChrome('diagram.drawio');

  assert.deepEqual(events, [
    ['backlinks-mode', 'header'],
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
});

test('WorkspacePreviewController keeps draw.io text mode in the editor layout', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
      setDisplayMode(mode) {
        events.push(['backlinks-mode', mode]);
      },
    },
  });

  controller.syncFileChrome('diagram.drawio', { drawioMode: 'text' });

  assert.deepEqual(events, [['backlinks-mode', 'dock']]);
});

test('WorkspacePreviewController forces image attachments into preview without overwriting layout preference', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
    },
  });

  controller.syncFileChrome('README.assets/diagram.png');

  assert.deepEqual(events, [
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
});

test('WorkspacePreviewController defaults HTML files to preview without overwriting layout preference', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
    },
  });

  controller.syncFileChrome('reports/status.html');

  assert.deepEqual(events, [
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
});

test('WorkspacePreviewController forces PDF files into a readonly preview', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
    },
  });

  controller.syncFileChrome('docs/brief.pdf');

  assert.deepEqual(events, [
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
});

test('WorkspacePreviewController defaults base files into preview when requested', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
    },
  });

  controller.syncFileChrome('views/tasks.base', { preferPreviewForBase: true });

  assert.deepEqual(events, [
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
});

test('WorkspacePreviewController keeps base files in the current layout after opening so split mode can show raw YAML', () => {
  const events = [];
  const controller = createController({
    layoutController: {
      setView(view, options) {
        events.push(['set-view', view, options]);
      },
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
    },
  });

  controller.syncFileChrome('views/tasks.base');

  assert.deepEqual(events, []);
});

test('WorkspacePreviewController delegates standalone base preview rendering', async () => {
  const events = [];
  const renderHost = {
    replaceChildren(...children) {
      events.push(['replace-children', children.length]);
    },
    style: { minHeight: '24px' },
  };
  const previewContent = {
    classList: {
      add(token) {
        events.push(['class-add', token]);
      },
      remove(token) {
        events.push(['class-remove', token]);
      },
      toggle() {},
    },
    dataset: {},
  };
  const controller = createController({
    session: { getText: () => 'filters:\n  and: []\n' },
    basesPreview: {
      async renderStandalone({ filePath, renderHost: nextRenderHost, source }) {
        events.push(['render-standalone', filePath, nextRenderHost === renderHost, source]);
      },
    },
    elements: {
      markdownToolbar: { classList: { toggle() {} } },
      outlineToggle: { classList: { toggle() {} } },
      previewContent,
    },
    previewRenderer: {
      ensureRenderHost() {
        return renderHost;
      },
      normalizePreviewChildren(nextRenderHost) {
        events.push(['normalize-preview', nextRenderHost === renderHost]);
      },
      scheduleActiveMermaidRefit() {},
      scheduleActivePlantUmlRefit() {},
      setHydrationPaused() {},
    },
    schedulePreviewLayoutSync() {
      events.push(['schedule-layout-sync']);
    },
    scrollSyncController: {
      invalidatePreviewBlocks() {
        events.push(['invalidate-preview']);
      },
      setLargeDocumentMode(value) {
        events.push(['set-large-document-mode', value]);
      },
      warmPreviewBlocks() {},
    },
    outlineController: {
      close() {
        events.push(['outline-close']);
      },
      scheduleActiveHeadingUpdate() {},
    },
    backlinksPanel: {
      clear() {
        events.push(['backlinks-clear']);
      },
    },
  });

  await controller.renderBaseFilePreview('views/tasks.base');

  assert.equal(previewContent.dataset.renderPhase, 'ready');
  assert.deepEqual(events, [
    ['class-remove', 'is-drawio-file-preview'],
    ['class-remove', 'is-excalidraw-file-preview'],
    ['class-remove', 'is-canvas-file-preview'],
    ['class-remove', 'is-base-file-preview'],
    ['class-remove', 'is-image-file-preview'],
    ['class-remove', 'is-pdf-file-preview'],
    ['class-remove', 'is-html-file-preview'],
    ['class-remove', 'is-mermaid-file-preview'],
    ['class-remove', 'is-plantuml-file-preview'],
    ['class-remove', 'is-structurizr-file-preview'],
    ['class-add', 'is-base-file-preview'],
    ['normalize-preview', true],
    ['render-standalone', 'views/tasks.base', true, 'filters:\n  and: []\n'],
    ['outline-close'],
    ['set-large-document-mode', false],
    ['invalidate-preview'],
    ['schedule-layout-sync'],
  ]);
});

test('WorkspacePreviewController clears the reserved height before rendering Structurizr', async () => {
  const renderHost = { style: { minHeight: '320px' } };
  const previewContent = {
    classList: { add() {}, remove() {}, toggle() {} },
    dataset: {},
  };
  let renderArgs = null;
  const controller = createController({
    elements: {
      markdownToolbar: { classList: { toggle() {} } },
      outlineToggle: { classList: { toggle() {} } },
      previewContent,
    },
    previewRenderer: {
      ensureRenderHost: () => renderHost,
      normalizePreviewChildren() {},
    },
    scrollSyncController: {
      invalidatePreviewBlocks() {},
      setLargeDocumentMode() {},
    },
    structurizrPreview: {
      reset() {},
      async render(args) {
        renderArgs = args;
      },
    },
  });

  await controller.renderStructurizrFilePreview('workspace.dsl', { source: 'workspace "Example" {}' });

  assert.equal(renderHost.style.minHeight, '');
  assert.equal(renderArgs.filePath, 'workspace.dsl');
  assert.equal(renderArgs.source, 'workspace "Example" {}');
  assert.equal(previewContent.dataset.renderPhase, 'ready');
});

test('WorkspacePreviewController still syncs Excalidraw preview layout without an editor session', async () => {
  const events = [];
  const previewContent = {
    classList: {
      add() {},
      contains(token) {
        return token === 'is-excalidraw-file-preview';
      },
      remove() {},
      toggle() {},
    },
    dataset: { renderPhase: 'ready' },
  };
  const controller = createController({
    elements: {
      markdownToolbar: { classList: { toggle() {} } },
      outlineToggle: { classList: { toggle() {} } },
      previewContent,
    },
    excalidrawEmbed: {
      syncLayout() {
        events.push('sync-layout');
      },
    },
    scrollSyncController: {
      invalidatePreviewBlocks() {
        events.push('invalidate-preview');
      },
      warmPreviewBlocks() {
        events.push('warm-preview');
      },
    },
    session: null,
  });

  await new Promise((resolve) => {
    controller.schedulePreviewLayoutSync({ delayMs: 0 });
    setTimeout(resolve, 0);
  });

  assert.deepEqual(events, ['sync-layout']);
});

test('WorkspacePreviewController hides text layout actions for canvas and restores them for notes', () => {
  const visibility = {};
  const views = [];
  const action = (name) => ({ classList: { toggle: (_token, hidden) => { visibility[name] = hidden; } } });
  const controller = createController({
    elements: {
      toolbarViewToggle: action('views'),
      mobileViewToggle: action('mobile'),
      toggleWrapButton: action('wrap'),
    },
    layoutController: { setView: (view, options) => views.push({ view, ...options }) },
  });
  controller.syncFileChrome('ideas.canvas');
  assert.deepEqual(views, [{ view: 'preview', persist: false }]);
  assert.deepEqual(visibility, { views: true, mobile: true, wrap: true });
  controller.syncFileChrome('README.md');
  assert.deepEqual(visibility, { views: false, mobile: false, wrap: false });
});

test('WorkspacePreviewController coalesces HTML input and cancels it on a preview switch', (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = createController();
  const committed = [];
  controller.commitHtmlFilePreview = (source) => {
    committed.push(source);
    controller.htmlPreviewSource = source;
    controller.htmlPreviewShell = { isConnected: true, classList: { toggle() {} } };
  };

  controller.renderHtmlFilePreview({ content: 'first' });
  assert.deepEqual(committed, ['first']);
  controller.renderHtmlFilePreview({ content: 'skipped' });
  controller.renderHtmlFilePreview({ content: 'latest' });
  assert.deepEqual(committed, ['first']);
  t.mock.timers.tick(120);
  assert.deepEqual(committed, ['first', 'latest']);

  controller.renderHtmlFilePreview({ content: 'removed' });
  controller.resetPreviewMode();
  t.mock.timers.tick(120);
  assert.deepEqual(committed, ['first', 'latest']);
});

test('WorkspacePreviewController reanchors a pinned outline heading after preview layout hydration', async () => {
  const events = [];
  const controller = createController({
    elements: {
      previewContent: {
        classList: { contains: () => false },
        dataset: { renderPhase: 'ready' },
      },
    },
    outlineController: {
      reanchorPinnedHeading() {
        events.push('reanchor-pinned-heading');
        return true;
      },
      scheduleActiveHeadingUpdate() {
        events.push('schedule-active-heading');
      },
    },
    scrollSyncController: {
      invalidatePreviewBlocks() {
        events.push('invalidate-blocks');
      },
      lastInteractionSource: 'preview',
      realignAfterLayoutChange() {
        events.push('realign-layout');
      },
      syncEditorToPreview() {
        events.push('sync-editor-to-preview');
      },
      warmPreviewBlocks({ onReady }) {
        events.push('warm-blocks');
        onReady();
      },
    },
    session: { id: 'markdown-session' },
  });

  await new Promise((resolve) => {
    controller.schedulePreviewLayoutSync({ delayMs: 0 });
    setTimeout(resolve, 0);
  });

  assert.deepEqual(events, [
    'invalidate-blocks',
    'warm-blocks',
    'reanchor-pinned-heading',
    'sync-editor-to-preview',
  ]);
});
