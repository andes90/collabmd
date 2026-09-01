import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import {
  EXCALIDRAW_META_KEY,
  EXCALIDRAW_SCHEMA_VERSION_KEY,
  applySceneDiffToExcalidrawRoom,
  buildExcalidrawRoomScene,
  isExcalidrawRoomDocStructured,
  migrateLegacyExcalidrawRoomData,
  readExcalidrawReplaceGeneration,
  readLegacyExcalidrawRoomScene,
  replaceExcalidrawRoomScene,
  serializeExcalidrawRoomScene,
} from '../../src/domain/excalidraw-room-codec.js';

function createElement(id, {
  index = 'a0',
  isDeleted = false,
  version = 1,
  versionNonce = 1,
  x = 0,
  y = 0,
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
    y,
  };
}

function createScene(elements) {
  return {
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements,
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  };
}

function syncDocs(from, to) {
  Y.applyUpdate(to, Y.encodeStateAsUpdate(from));
}

test('migrates legacy codemirror scene content into structured Excalidraw room state', () => {
  const doc = new Y.Doc();
  const legacyScene = JSON.stringify(createScene([createElement('shape-legacy')]));
  doc.getText('codemirror').insert(0, legacyScene);

  assert.equal(isExcalidrawRoomDocStructured(doc), false);

  const parsedLegacyScene = readLegacyExcalidrawRoomScene(doc);
  assert.ok(parsedLegacyScene);
  migrateLegacyExcalidrawRoomData(doc, parsedLegacyScene);

  assert.equal(isExcalidrawRoomDocStructured(doc), true);
  assert.deepEqual(buildExcalidrawRoomScene(doc).elements.map((element) => element.id), ['shape-legacy']);
});

test('rejects non-empty structured maps when the schema version is incompatible', () => {
  const doc = new Y.Doc();
  replaceExcalidrawRoomScene(doc, createScene([createElement('stale-shape')]));
  doc.getMap(EXCALIDRAW_META_KEY).set(EXCALIDRAW_SCHEMA_VERSION_KEY, 999);

  assert.equal(isExcalidrawRoomDocStructured(doc), false);
});

test('merges concurrent structured updates for different elements into one valid scene', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();

  replaceExcalidrawRoomScene(docA, createScene([]));
  syncDocs(docA, docB);
  syncDocs(docB, docA);

  docA.transact(() => {
    applySceneDiffToExcalidrawRoom(docA, createScene([createElement('shape-a', { index: 'a1', x: 10 })]));
  }, 'client-a');
  docB.transact(() => {
    applySceneDiffToExcalidrawRoom(docB, createScene([createElement('shape-b', { index: 'a2', x: 30 })]));
  }, 'client-b');

  syncDocs(docA, docB);
  syncDocs(docB, docA);

  const sceneA = buildExcalidrawRoomScene(docA);
  const sceneB = buildExcalidrawRoomScene(docB);
  assert.deepEqual(sceneA.elements.map((element) => element.id), ['shape-a', 'shape-b']);
  assert.deepEqual(sceneB.elements.map((element) => element.id), ['shape-a', 'shape-b']);
});

test('keeps the higher element version and lower versionNonce when concurrent edits target the same element', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const baseScene = createScene([createElement('shared-shape', { version: 1, versionNonce: 1, x: 0 })]);

  replaceExcalidrawRoomScene(docA, baseScene);
  syncDocs(docA, docB);
  syncDocs(docB, docA);

  docA.transact(() => {
    applySceneDiffToExcalidrawRoom(docA, createScene([
      createElement('shared-shape', { version: 2, versionNonce: 4, x: 20 }),
    ]));
  }, 'client-a');
  docB.transact(() => {
    applySceneDiffToExcalidrawRoom(docB, createScene([
      createElement('shared-shape', { version: 2, versionNonce: 9, x: 45 }),
    ]));
  }, 'client-b');

  syncDocs(docA, docB);
  syncDocs(docB, docA);

  const [winningElement] = buildExcalidrawRoomScene(docA).elements;
  assert.equal(winningElement.id, 'shared-shape');
  assert.equal(winningElement.version, 2);
  assert.equal(winningElement.versionNonce, 4);
  assert.equal(winningElement.x, 20);
});

test('live scene diffs preserve room elements omitted from stale local payloads', () => {
  const doc = new Y.Doc();
  replaceExcalidrawRoomScene(doc, createScene([
    createElement('shape-a', { index: 'a1', x: 10 }),
    createElement('shape-b', { index: 'a2', x: 30 }),
  ]));

  applySceneDiffToExcalidrawRoom(doc, createScene([
    createElement('shape-a', { index: 'a1', version: 2, x: 40 }),
  ]));

  const scene = buildExcalidrawRoomScene(doc);
  assert.deepEqual(scene.elements.map((element) => element.id), ['shape-a', 'shape-b']);
  assert.equal(scene.elements.find((element) => element.id === 'shape-a').x, 40);
  assert.equal(scene.elements.find((element) => element.id === 'shape-b').x, 30);
});

test('sorts Excalidraw fractional indices using code-point ordering', () => {
  const doc = new Y.Doc();
  const baseElement = createElement('shape-a', { index: 'b0a' });
  const movedElement = createElement('shape-b', { index: 'b0b' });

  replaceExcalidrawRoomScene(doc, createScene([baseElement, movedElement]));
  applySceneDiffToExcalidrawRoom(doc, createScene([{
    ...movedElement,
    index: 'b0Z',
    version: 2,
    versionNonce: 2,
  }]));

  assert.deepEqual(
    buildExcalidrawRoomScene(doc).elements.map((element) => element.id),
    ['shape-b', 'shape-a'],
  );
});

test('live scene diffs preserve files omitted from stale local payloads', () => {
  const doc = new Y.Doc();
  replaceExcalidrawRoomScene(doc, {
    ...createScene([createElement('shape-a')]),
    files: {
      imageA: { id: 'imageA', dataURL: 'data:image/png;base64,a', mimeType: 'image/png', version: 1 },
      imageB: { id: 'imageB', dataURL: 'data:image/png;base64,b', mimeType: 'image/png', version: 1 },
    },
  });

  applySceneDiffToExcalidrawRoom(doc, {
    ...createScene([createElement('shape-a', { version: 2 })]),
    files: {
      imageA: { id: 'imageA', dataURL: 'data:image/png;base64,a2', mimeType: 'image/png', version: 2 },
    },
  });

  const scene = buildExcalidrawRoomScene(doc);
  assert.deepEqual(Object.keys(scene.files).sort(), ['imageA', 'imageB']);
  assert.equal(scene.files.imageA.version, 2);
  assert.equal(scene.files.imageB.version, 1);
});

test('structured reconciliation preserves bindings, groups, frames, and tombstones', () => {
  const docA = new Y.Doc();
  const docB = new Y.Doc();
  const frame = {
    ...createElement('frame', { index: 'a0' }),
    type: 'frame',
  };
  const groupedShape = {
    ...createElement('grouped-shape', { index: 'a1' }),
    boundElements: [{ id: 'bound-text', type: 'text' }, { id: 'arrow', type: 'arrow' }],
    frameId: 'frame',
    groupIds: ['group-1'],
  };
  const boundText = {
    ...createElement('bound-text', { index: 'a2' }),
    containerId: 'grouped-shape',
    frameId: 'frame',
    groupIds: ['group-1'],
    originalText: 'preserved',
    text: 'preserved',
    type: 'text',
  };
  const arrow = {
    ...createElement('arrow', { index: 'a3' }),
    endBinding: { elementId: 'grouped-shape', focus: 0, gap: 1 },
    frameId: 'frame',
    points: [[0, 0], [100, 100]],
    startBinding: null,
    type: 'arrow',
  };

  replaceExcalidrawRoomScene(docA, createScene([frame, groupedShape, boundText, arrow]));
  syncDocs(docA, docB);
  syncDocs(docB, docA);

  applySceneDiffToExcalidrawRoom(docA, createScene([{
    ...groupedShape,
    version: 2,
    versionNonce: 20,
    x: 40,
  }]));
  applySceneDiffToExcalidrawRoom(docB, createScene([{
    ...arrow,
    isDeleted: true,
    version: 2,
    versionNonce: 21,
  }]));

  syncDocs(docA, docB);
  syncDocs(docB, docA);

  const scene = buildExcalidrawRoomScene(docA);
  assert.deepEqual(scene.elements.find((element) => element.id === 'grouped-shape'), {
    ...groupedShape,
    version: 2,
    versionNonce: 20,
    x: 40,
  });
  assert.deepEqual(scene.elements.find((element) => element.id === 'bound-text'), boundText);
  assert.deepEqual(scene.elements.find((element) => element.id === 'arrow'), {
    ...arrow,
    isDeleted: true,
    version: 2,
    versionNonce: 21,
  });
});

test('explicit deleted-element tombstones win live diffs and stay out of persisted content', () => {
  const doc = new Y.Doc();
  replaceExcalidrawRoomScene(doc, createScene([
    createElement('shape-a', { index: 'a1', version: 1 }),
    createElement('shape-b', { index: 'a2', version: 1 }),
  ]));

  applySceneDiffToExcalidrawRoom(doc, createScene([
    createElement('shape-b', { index: 'a2', isDeleted: true, version: 2 }),
  ]));

  const liveScene = buildExcalidrawRoomScene(doc);
  assert.deepEqual(liveScene.elements.map((element) => element.id), ['shape-a', 'shape-b']);
  assert.equal(liveScene.elements.find((element) => element.id === 'shape-b').isDeleted, true);

  const persistedScene = JSON.parse(serializeExcalidrawRoomScene(doc));
  assert.deepEqual(persistedScene.elements.map((element) => element.id), ['shape-a']);
});

test('full scene replace stamps a generation that live diffs do not', () => {
  const doc = new Y.Doc();
  assert.equal(readExcalidrawReplaceGeneration(doc), 0);

  replaceExcalidrawRoomScene(doc, createScene([createElement('shape-a')]));
  assert.equal(readExcalidrawReplaceGeneration(doc), 1);

  applySceneDiffToExcalidrawRoom(doc, createScene([
    createElement('shape-a', { version: 2, x: 40 }),
  ]));
  assert.equal(readExcalidrawReplaceGeneration(doc), 1);

  replaceExcalidrawRoomScene(doc, createScene([createElement('shape-b')]));
  assert.equal(readExcalidrawReplaceGeneration(doc), 2);
  assert.deepEqual(buildExcalidrawRoomScene(doc).elements.map((element) => element.id), ['shape-b']);
});
