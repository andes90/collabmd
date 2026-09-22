import test from 'node:test';
import assert from 'node:assert/strict';

import * as Y from 'yjs';

import {
  EXCALIDRAW_ELEMENTS_KEY,
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

test('equal revisions converge across arrival order, pruning, and snapshot restore', () => {
  const seed = new Y.Doc();
  seed.clientID = 1;
  replaceExcalidrawRoomScene(seed, createScene([createElement('shared')]));
  const docs = [10, 20, 30].map((clientID) => {
    const doc = new Y.Doc();
    doc.clientID = clientID;
    syncDocs(seed, doc);
    applySceneDiffToExcalidrawRoom(doc, createScene([createElement('shared', { version: 2, x: clientID })]));
    return doc;
  });
  const updates = docs.map((doc) => Y.encodeStateAsUpdate(doc));
  docs.forEach((doc, index) => {
    const order = index % 2 ? [...updates].reverse() : updates;
    order.forEach((update) => Y.applyUpdate(doc, update));
  });
  docs.forEach((doc) => assert.equal(buildExcalidrawRoomScene(doc).elements[0].x, 30));

  docs.forEach((doc) => {
    applySceneDiffToExcalidrawRoom(doc, createScene([createElement('shared', { version: 2, x: doc.clientID + 100 })]));
    assert.equal(doc.getMap(EXCALIDRAW_ELEMENTS_KEY).get('shared').size, 2);
  });
  docs.forEach((from) => docs.forEach((to) => syncDocs(from, to)));
  docs.forEach((doc) => {
    assert.equal(buildExcalidrawRoomScene(doc).elements[0].x, 130);
    const restored = new Y.Doc();
    syncDocs(doc, restored);
    assert.deepEqual(buildExcalidrawRoomScene(restored), buildExcalidrawRoomScene(doc));
    restored.destroy();
  });
  docs.forEach((doc) => doc.destroy());
  seed.destroy();
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

test('one writer keeps 50000 element revisions compact across snapshot reloads', () => {
  const doc = new Y.Doc({ gc: true });
  replaceExcalidrawRoomScene(doc, createScene([createElement('shape')]));
  const initialSize = Y.encodeStateAsUpdate(doc).byteLength;
  for (let version = 2; version <= 50000; version += 1) {
    doc.transact(() => {
      applySceneDiffToExcalidrawRoom(doc, createScene([createElement('shape', { version, x: version })]));
    });
  }
  const snapshot = Y.encodeStateAsUpdate(doc);
  assert.ok(snapshot.byteLength < initialSize + 1024, `${snapshot.byteLength} bytes after 50000 revisions`);
  assert.equal(doc.getMap(EXCALIDRAW_ELEMENTS_KEY).get('shape').size, 1);
  const restored = new Y.Doc({ gc: true });
  Y.applyUpdate(restored, snapshot);
  assert.equal(buildExcalidrawRoomScene(restored).elements[0].version, 50000);
  for (let version = 50001; version <= 51000; version += 1) {
    restored.transact(() => {
      applySceneDiffToExcalidrawRoom(restored, createScene([createElement('shape', { version })]));
    });
  }
  assert.ok(Y.encodeStateAsUpdate(restored).byteLength < initialSize + 2048);
  doc.destroy();
  restored.destroy();
});

test('a writer cannot overwrite its winner with a lower version or higher nonce', () => {
  const doc = new Y.Doc();
  const winner = createElement('shape', { version: 5, versionNonce: 3 });
  replaceExcalidrawRoomScene(doc, createScene([winner]));
  for (const element of [
    createElement('shape', { version: 4, versionNonce: 1 }),
    createElement('shape', { version: 5, versionNonce: 4 }),
  ]) {
    assert.equal(applySceneDiffToExcalidrawRoom(doc, createScene([element])), false);
    assert.deepEqual(buildExcalidrawRoomScene(doc).elements, [winner]);
  }
  const sameRevision = { ...winner, x: 123 };
  assert.equal(applySceneDiffToExcalidrawRoom(doc, createScene([sameRevision])), true);
  assert.deepEqual(buildExcalidrawRoomScene(doc).elements, [sameRevision]);
  const deleted = createElement('shape', { version: 6, isDeleted: true });
  applySceneDiffToExcalidrawRoom(doc, createScene([deleted]));
  assert.equal(applySceneDiffToExcalidrawRoom(doc, createScene([winner])), false);
  assert.deepEqual(JSON.parse(serializeExcalidrawRoomScene(doc)).elements, []);
  doc.destroy();
});

test('independent writer candidates converge after offline edits, snapshot restore, and deletion', () => {
  const seed = new Y.Doc();
  replaceExcalidrawRoomScene(seed, createScene([createElement('shape')]));
  const docs = Array.from({ length: 3 }, () => {
    const doc = new Y.Doc();
    syncDocs(seed, doc);
    return doc;
  });
  const candidates = [
    createElement('shape', { version: 5, versionNonce: 7, x: 10 }),
    createElement('shape', { version: 5, versionNonce: 3, x: 20 }),
    createElement('shape', { version: 4, versionNonce: 1, x: 30 }),
  ];
  docs.forEach((doc, index) => applySceneDiffToExcalidrawRoom(doc, createScene([candidates[index]])));
  const offlineUpdates = docs.map((doc) => Y.encodeStateAsUpdate(doc));
  docs.forEach((doc, index) => {
    const updates = index % 2 ? [...offlineUpdates].reverse() : offlineUpdates;
    updates.forEach((update) => Y.applyUpdate(doc, update));
    assert.deepEqual(buildExcalidrawRoomScene(doc).elements, [candidates[1]]);
  });

  const restored = new Y.Doc();
  syncDocs(docs[1], restored);
  applySceneDiffToExcalidrawRoom(restored, createScene([createElement('shape', { version: 7 })]));
  applySceneDiffToExcalidrawRoom(docs[0], createScene([createElement('shape', { version: 6 })]));
  syncDocs(docs[0], restored);
  syncDocs(restored, docs[0]);
  assert.equal(buildExcalidrawRoomScene(restored).elements[0].version, 7);
  assert.deepEqual(buildExcalidrawRoomScene(docs[0]), buildExcalidrawRoomScene(restored));

  applySceneDiffToExcalidrawRoom(docs[0], createScene([createElement('shape', { version: 8, isDeleted: true })]));
  syncDocs(docs[0], restored);
  assert.deepEqual(JSON.parse(serializeExcalidrawRoomScene(restored)).elements, []);
  [seed, restored, ...docs].forEach((doc) => doc.destroy());
});

test('legacy revision maps stay live for stale writers without accumulating new revision keys', () => {
  const legacy = new Y.Doc();
  legacy.getMap(EXCALIDRAW_META_KEY).set(EXCALIDRAW_SCHEMA_VERSION_KEY, 1);
  const slot = new Y.Map();
  legacy.getMap(EXCALIDRAW_ELEMENTS_KEY).set('shape', slot);
  for (let version = 1; version <= 1000; version += 1) {
    legacy.transact(() => {
      slot.set(String(version), createElement('shape', { version }));
      if (version > 2) slot.delete(String(version - 2));
    });
  }
  const restored = new Y.Doc();
  syncDocs(legacy, restored);
  const restoredSlot = restored.getMap(EXCALIDRAW_ELEMENTS_KEY).get('shape');
  const baselineBytes = Y.encodeStateAsUpdate(restored).byteLength;
  assert.equal(buildExcalidrawRoomScene(restored).elements[0].version, 1000);
  for (let version = 1001; version <= 2000; version += 1) {
    restored.transact(() => applySceneDiffToExcalidrawRoom(restored, createScene([createElement('shape', { version })])));
  }
  assert.equal(restored.getMap(EXCALIDRAW_ELEMENTS_KEY).get('shape'), restoredSlot);
  assert.ok(Y.encodeStateAsUpdate(restored).byteLength < baselineBytes + 2048);

  // An older client can still append its old-format candidate to the same parent.
  slot.set('2001', JSON.stringify(createElement('shape', { version: 2001, x: 42 })));
  syncDocs(legacy, restored);
  syncDocs(restored, legacy);
  assert.equal(buildExcalidrawRoomScene(restored).elements[0].version, 2001);
  assert.deepEqual(buildExcalidrawRoomScene(legacy), buildExcalidrawRoomScene(restored));

  restored.transact(() => replaceExcalidrawRoomScene(restored, createScene([createElement('replacement')])));
  assert.ok(Y.encodeStateAsUpdate(restored).byteLength < baselineBytes / 2);
  // The existing explicit replacement policy also applies to late old-parent edits.
  slot.set('3000', createElement('shape', { version: 3000 }));
  syncDocs(legacy, restored);
  syncDocs(restored, legacy);
  assert.deepEqual(buildExcalidrawRoomScene(restored).elements.map(({ id }) => id), ['replacement']);
  assert.deepEqual(buildExcalidrawRoomScene(legacy), buildExcalidrawRoomScene(restored));
  legacy.destroy();
  restored.destroy();
});
