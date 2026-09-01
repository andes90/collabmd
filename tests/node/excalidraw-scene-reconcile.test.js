import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildReconciledExcalidrawSceneUpdate,
} from '../../src/client/domain/excalidraw-scene-reconcile.js';

function shouldKeepLocal(local, remote, appState = {}) {
  return Boolean(
    local
    && (
      local.id === appState.editingTextElement?.id
      || local.id === appState.resizingElement?.id
      || local.id === appState.newElement?.id
      || local.version > remote.version
      || (local.version === remote.version && local.versionNonce <= remote.versionNonce)
    ),
  );
}

function reconcileElementsFn(localElements, remoteElements, appState) {
  const localById = new Map(localElements.map((element) => [element.id, element]));
  const seen = new Set();
  const reconciled = [];

  remoteElements.forEach((remoteElement) => {
    const localElement = localById.get(remoteElement.id);
    const nextElement = shouldKeepLocal(localElement, remoteElement, appState)
      ? localElement
      : remoteElement;
    reconciled.push(nextElement);
    seen.add(nextElement.id);
  });

  localElements.forEach((localElement) => {
    if (!seen.has(localElement.id)) {
      reconciled.push(localElement);
    }
  });

  return reconciled;
}

const restoreAppStateFn = (appState) => ({
  gridSize: appState?.gridSize ?? null,
  viewBackgroundColor: appState?.viewBackgroundColor ?? '#ffffff',
});
const restoreElementsFn = (elements) => elements;

function createElement(id, {
  index = 'a0',
  isDeleted = false,
  version = 1,
  versionNonce = 1,
  x = 0,
} = {}) {
  return {
    angle: 0,
    backgroundColor: 'transparent',
    boundElements: null,
    fillStyle: 'hachure',
    frameId: null,
    groupIds: [],
    height: 80,
    id,
    index,
    isDeleted,
    link: null,
    locked: false,
    opacity: 100,
    roughness: 1,
    roundness: null,
    seed: 1,
    strokeColor: '#1e1e1e',
    strokeStyle: 'solid',
    strokeWidth: 1,
    type: 'rectangle',
    updated: version * 1000,
    version,
    versionNonce,
    width: 120,
    x,
    y: 0,
  };
}

test('buildReconciledExcalidrawSceneUpdate preserves local same-version lower-nonce edits', () => {
  const currentAppState = {
    gridSize: null,
    viewBackgroundColor: '#ffffff',
  };

  const result = buildReconciledExcalidrawSceneUpdate({
    currentAppState,
    currentElements: [
      createElement('shared-shape', { version: 2, versionNonce: 4, x: 20 }),
    ],
    documentViewState: {
      viewModeEnabled: false,
      zenModeEnabled: false,
    },
    scene: {
      appState: { gridSize: null, viewBackgroundColor: '#dbeafe' },
      elements: [
        createElement('shared-shape', { version: 2, versionNonce: 9, x: 45 }),
      ],
    },
    reconcileElementsFn,
    restoreAppStateFn,
    restoreElementsFn,
    theme: 'dark',
  });

  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].id, 'shared-shape');
  assert.equal(result.elements[0].versionNonce, 4);
  assert.equal(result.elements[0].x, 20);
  assert.equal(result.appState.viewBackgroundColor, '#dbeafe');
  assert.equal(result.appState.theme, 'dark');
});

test('buildReconciledExcalidrawSceneUpdate applies higher-version remote tombstones', () => {
  const result = buildReconciledExcalidrawSceneUpdate({
    currentAppState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    currentElements: [
      createElement('shape-a', { version: 1, versionNonce: 1 }),
    ],
    scene: {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [
        createElement('shape-a', { isDeleted: true, version: 2, versionNonce: 1 }),
      ],
    },
    reconcileElementsFn,
    restoreAppStateFn,
    restoreElementsFn,
  });

  assert.equal(result.elements.length, 1);
  assert.equal(result.elements[0].id, 'shape-a');
  assert.equal(result.elements[0].isDeleted, true);
});

test('buildReconciledExcalidrawSceneUpdate omits unchanged app state during remote scene updates', () => {
  const currentAppState = {
    gridSize: null,
    theme: 'dark',
    viewBackgroundColor: '#ffffff',
    viewModeEnabled: false,
    zenModeEnabled: false,
  };

  const result = buildReconciledExcalidrawSceneUpdate({
    currentAppState,
    currentElements: [createElement('shape-a')],
    documentViewState: {
      viewModeEnabled: false,
      zenModeEnabled: false,
    },
    scene: {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [createElement('shape-a')],
    },
    reconcileElementsFn,
    restoreAppStateFn,
    restoreElementsFn,
    theme: 'dark',
  });

  assert.equal('appState' in result, false);
  assert.equal(result.elements.length, 1);
});

test('buildReconciledExcalidrawSceneUpdate can include full app state when requested', () => {
  const result = buildReconciledExcalidrawSceneUpdate({
    currentAppState: {
      gridSize: null,
      theme: 'dark',
      viewBackgroundColor: '#ffffff',
      viewModeEnabled: false,
      zenModeEnabled: false,
    },
    currentElements: [createElement('shape-a')],
    documentViewState: {
      viewModeEnabled: false,
      zenModeEnabled: false,
    },
    includeUnchangedAppState: true,
    scene: {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [createElement('shape-a')],
    },
    reconcileElementsFn,
    restoreAppStateFn,
    restoreElementsFn,
    theme: 'dark',
  });

  assert.deepEqual(result.appState, {
    gridSize: null,
    theme: 'dark',
    viewBackgroundColor: '#ffffff',
    viewModeEnabled: false,
    zenModeEnabled: false,
  });
});

test('authoritative remote scene replaces higher-version local elements', () => {
  const result = buildReconciledExcalidrawSceneUpdate({
    authoritative: true,
    currentAppState: {
      gridSize: null,
      viewBackgroundColor: '#ffffff',
    },
    currentElements: [
      createElement('shared-shape', { version: 9, versionNonce: 1, x: 20 }),
    ],
    reconcileElementsFn,
    restoreAppStateFn,
    restoreElementsFn,
    scene: {
      appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
      elements: [
        createElement('shared-shape', { version: 1, versionNonce: 9, x: 45 }),
        createElement('label', { version: 1, x: 10 }),
      ],
    },
  });

  assert.deepEqual(result.elements.map((element) => [element.id, element.x]), [
    ['shared-shape', 45],
    ['label', 10],
  ]);
});
