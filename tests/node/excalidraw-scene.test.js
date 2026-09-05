import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildLiveCollaborationScene,
  createEmptyScene,
  createExcalidrawExportOptions,
  normalizeScene,
  parseSceneJson,
  sceneToInitialData,
} from '../../src/client/domain/excalidraw-scene.js';
import { normalizeUserName } from '../../src/client/domain/room.js';

test('normalizeUserName trims whitespace and caps the visible length', () => {
  assert.equal(normalizeUserName('  Andes   Setiawan  '), 'Andes Setiawan');
  assert.equal(normalizeUserName('x'.repeat(40)).length, 24);
  assert.equal(normalizeUserName('   '), null);
});

test('parseSceneJson and normalizeScene fall back to an empty scene shape', () => {
  assert.deepEqual(parseSceneJson('not-json'), createEmptyScene());
  assert.deepEqual(normalizeScene({ elements: 'bad', files: null }), createEmptyScene());
});

test('Excalidraw scene helpers preserve supported fields', () => {
  const scene = normalizeScene({
    appState: { gridSize: 16, viewBackgroundColor: '#123456' },
    elements: [
      { id: 'a', isDeleted: false },
      { id: 'b', isDeleted: true },
    ],
    files: { fileA: { mimeType: 'image/png' } },
  });

  assert.deepEqual(sceneToInitialData(scene, { theme: 'light' }), {
    appState: {
      gridSize: 16,
      theme: 'light',
      viewBackgroundColor: '#123456',
    },
    elements: scene.elements,
    files: scene.files,
  });
  assert.deepEqual(createExcalidrawExportOptions(scene, { padding: 12, scale: 2 }), {
    appState: {
      exportBackground: true,
      exportScale: 2,
      exportWithDarkMode: false,
      gridSize: 16,
      theme: 'light',
      viewBackgroundColor: '#123456',
    },
    elements: [scene.elements[0]],
    exportPadding: 12,
    files: scene.files,
  });

  assert.deepEqual(buildLiveCollaborationScene(scene.elements, scene.appState, scene.files), scene);
});
