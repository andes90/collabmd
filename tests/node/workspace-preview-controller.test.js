import test from 'node:test';
import assert from 'node:assert/strict';

import { WorkspacePreviewController } from '../../src/client/application/workspace-preview-controller.js';

function createController(overrides = {}) {
  const getSession = overrides.getSession
    ?? (() => (Object.hasOwn(overrides, 'session') ? overrides.session : { getText: () => 'graph TD\nA-->B' }));

  return new WorkspacePreviewController({
    backlinksPanel: { clear() {}, ...(overrides.backlinksPanel || {}) },
    drawioEmbed: { setHydrationPaused() {}, syncLayout() {}, ...(overrides.drawioEmbed || {}) },
    elements: overrides.elements ?? {
      markdownToolbar: { classList: { toggle() {} } },
      outlineToggle: { classList: { toggle() {} } },
      previewContent: { classList: { add() {}, remove() {}, toggle() {} } },
    },
    excalidrawEmbed: { setHydrationPaused() {}, ...(overrides.excalidrawEmbed || {}) },
    getDisplayName: (filePath) => filePath,
    getSession,
    isDrawioFile: (filePath) => filePath?.endsWith('.drawio'),
    isExcalidrawFile: (filePath) => filePath?.endsWith('.excalidraw'),
    isImageFile: (filePath) => filePath?.endsWith('.png'),
    isMermaidFile: (filePath) => filePath?.endsWith('.mmd'),
    isPlantUmlFile: (filePath) => filePath?.endsWith('.puml'),
    layoutController: { setView() {}, ...(overrides.layoutController || {}) },
    outlineController: { close() {}, scheduleActiveHeadingUpdate() {}, ...(overrides.outlineController || {}) },
    previewRenderer: {
      scheduleActiveMermaidRefit() {},
      scheduleActivePlantUmlRefit() {},
      setHydrationPaused() {},
      ...(overrides.previewRenderer || {}),
    },
    schedulePreviewLayoutSync: () => {},
    scrollSyncController: { invalidatePreviewBlocks() {}, warmPreviewBlocks() {}, ...(overrides.scrollSyncController || {}) },
  });
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
});

test('WorkspacePreviewController pauses preview hydration during editor scroll activity', () => {
  const events = [];
  const controller = createController({
    excalidrawEmbed: {
      setHydrationPaused(value) {
        events.push(['embed', value]);
      },
    },
    previewRenderer: {
      setHydrationPaused(value) {
        events.push(['preview', value]);
      },
    },
  });

  let hydrationPaused = false;
  let pendingPreviewLayoutSync = false;
  let previewLayoutSyncTimer = 123;

  controller.handleEditorScrollActivityChange({
    isActive: true,
    pendingPreviewLayoutSync,
    previewLayoutSyncTimer,
    setHydrationPaused: (value) => {
      hydrationPaused = value;
    },
    setPendingPreviewLayoutSync: (value) => {
      pendingPreviewLayoutSync = value;
    },
    setPreviewLayoutSyncTimer: (value) => {
      previewLayoutSyncTimer = value;
    },
  });

  assert.equal(hydrationPaused, true);
  assert.equal(pendingPreviewLayoutSync, true);
  assert.equal(previewLayoutSyncTimer, null);
  assert.deepEqual(events, [
    ['preview', true],
    ['embed', true],
  ]);
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
    },
  });

  controller.syncFileChrome('diagram.excalidraw');

  assert.deepEqual(events, [
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
    },
  });

  controller.syncFileChrome('diagram.drawio');

  assert.deepEqual(events, [
    ['set-view', 'preview', { persist: false }],
    ['outline-close'],
    ['backlinks-clear'],
  ]);
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
    controller.schedulePreviewLayoutSync({
      delayMs: 0,
      hydrationPaused: false,
      previewLayoutSyncTimer: null,
      setPendingPreviewLayoutSync() {},
      setPreviewLayoutSyncTimer() {},
    });
    setTimeout(resolve, 0);
  });

  assert.deepEqual(events, ['sync-layout']);
});
