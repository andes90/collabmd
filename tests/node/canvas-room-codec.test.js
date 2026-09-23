import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  addCanvasEdge,
  addCanvasNode,
  buildCanvasRoomDocument,
  CANVAS_EDGES_KEY,
  CANVAS_EDGE_ORDER_KEY,
  CANVAS_META_KEY,
  CANVAS_NODES_KEY,
  CANVAS_NODE_ORDER_KEY,
  deleteCanvasNodes,
  mergeCanvasDocuments,
  parseCanvasJson,
  reorderCanvasNode,
  replaceCanvasRoomDocument,
  serializeCanvasRoomDocument,
  updateCanvasEdge,
  updateCanvasNode,
} from '../../src/domain/canvas-room-codec.js';

function textNode(id, extra = {}) {
  return { id, type: 'text', x: 0, y: 0, width: 300, height: 180, text: 'Hello', ...extra };
}

function createDoc(t, canvas = {}) {
  const doc = new Y.Doc();
  t.after(() => doc.destroy());
  doc.transact(() => replaceCanvasRoomDocument(doc, canvas), 'hydrate');
  return doc;
}

function peerDoc(t, source) {
  const doc = new Y.Doc();
  t.after(() => doc.destroy());
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(source));
  return doc;
}

function exchange(left, right) {
  const leftState = Y.encodeStateAsUpdate(left);
  const rightState = Y.encodeStateAsUpdate(right);
  Y.applyUpdate(left, rightState);
  Y.applyUpdate(right, leftState);
}

test('Canvas preserves all standard node types, optional values, array order and extension data', (t) => {
  const canvas = {
    vendor: { values: [false, null, 0, ''] },
    nodes: [
      { id: 'g', type: 'group', x: -12, y: 0, width: 700, height: 400, label: '', background: 'bg.png', backgroundStyle: 'repeat', color: '#AaBB00', extension: { a: 1 } },
      textNode('text', { text: '# Hello\n\n**world**', color: '1' }),
      { id: 'file', type: 'file', x: 350, y: 0, width: 300, height: 180, file: 'notes/a.md', subpath: '#heading' },
      { id: 'url', type: 'link', x: 0, y: 200, width: 300, height: 180, url: 'https://example.com' },
    ],
    edges: [
      { id: 'z', fromNode: 'text', toNode: 'file', fromSide: 'bottom', toSide: 'top', fromEnd: 'arrow', toEnd: 'none', color: '6', label: '', vendor: ['x'] },
      { id: 'a', fromNode: 'file', toNode: 'url' },
    ],
  };
  const doc = createDoc(t, parseCanvasJson(JSON.stringify(canvas)));
  assert.deepEqual(buildCanvasRoomDocument(doc), canvas);
  assert.deepEqual(JSON.parse(serializeCanvasRoomDocument(doc)), canvas);
  assert.equal(doc.getMap(CANVAS_NODES_KEY).get('text').get('text') instanceof Y.Text, true);
  assert.equal(serializeCanvasRoomDocument(doc).includes('schemaVersion'), false);
});

test('Canvas rejects malformed JSON and nonstandard node and edge fields safely', () => {
  for (const value of [
    '', '{broken', '[]', 'null', '{"nodes":null}', '{"edges":{}}',
    JSON.stringify({ nodes: [textNode('a', { type: 'unknown' })] }),
    JSON.stringify({ nodes: [textNode('a', { width: 1.5 })] }),
    JSON.stringify({ nodes: [textNode('a', { text: null })] }),
    JSON.stringify({ nodes: [textNode('a', { color: 1 })] }),
    JSON.stringify({ nodes: [textNode('a'), textNode('a')] }),
    JSON.stringify({ nodes: [textNode('a')], edges: [{ id: 'edge', fromNode: 'a', toNode: 'missing' }] }),
    JSON.stringify({ nodes: [textNode('a')], edges: [{ id: 'edge', fromNode: 'a', toNode: 'a', fromEnd: null }] }),
  ]) {
    assert.throws(() => parseCanvasJson(value), { code: 'CANVAS_INVALID', message: 'Invalid JSON Canvas 1.0 document' });
  }
});

test('Canvas local undo restores omitted arrays and removes only its own edits', (t) => {
  const doc = createDoc(t);
  const undo = new Y.UndoManager([
    CANVAS_NODES_KEY, CANVAS_EDGES_KEY, CANVAS_NODE_ORDER_KEY, CANVAS_EDGE_ORDER_KEY,
  ].map((key) => doc.getMap(key)), { trackedOrigins: new Set(['local']) });
  t.after(() => undo.destroy());
  doc.transact(() => addCanvasNode(doc, textNode('a')), 'local');
  assert.equal(buildCanvasRoomDocument(doc).nodes.length, 1);
  undo.undo();
  assert.deepEqual(buildCanvasRoomDocument(doc), {});
  undo.redo();
  const remote = peerDoc(t, doc);
  remote.transact(() => updateCanvasNode(remote, 'a', { color: '2' }), 'remote');
  Y.applyUpdate(doc, Y.encodeStateAsUpdate(remote));
  undo.stopCapturing();
  doc.transact(() => updateCanvasNode(doc, 'a', { x: 99 }), 'local');
  undo.undo();
  assert.deepEqual(buildCanvasRoomDocument(doc).nodes[0], textNode('a', { color: '2' }));
});

test('Canvas text replacements preserve Unicode and the shared text object across peers', (t) => {
  const doc = createDoc(t, { nodes: [textNode('a', { text: 'A😀Z' })] });
  const peer = peerDoc(t, doc);
  const text = doc.getMap(CANVAS_NODES_KEY).get('a').get('text');
  for (const value of ['A😁Z', 'prefix A😁Z suffix', 'prefix A😀Z suffix', '', 'Restored']) {
    doc.transact(() => updateCanvasNode(doc, 'a', { text: value }));
    Y.applyUpdate(peer, Y.encodeStateAsUpdate(doc));
    assert.equal(doc.getMap(CANVAS_NODES_KEY).get('a').get('text'), text);
    assert.equal(buildCanvasRoomDocument(doc).nodes[0].text, value);
    assert.equal(buildCanvasRoomDocument(peer).nodes[0].text, value);
  }
});

test('Canvas merges offline text typing and separate node and edge properties', (t) => {
  const first = createDoc(t, { nodes: [textNode('a'), textNode('b')], edges: [{ id: 'e', fromNode: 'a', toNode: 'b' }] });
  const second = peerDoc(t, first);
  first.transact(() => {
    updateCanvasNode(first, 'a', { text: 'Hello Alice', x: 25 });
    updateCanvasEdge(first, 'e', { color: '3' });
  }, 'first');
  second.transact(() => {
    updateCanvasNode(second, 'a', { text: 'Hi Hello', y: 40 });
    updateCanvasEdge(second, 'e', { label: 'depends on' });
  }, 'second');
  exchange(first, second);
  assert.deepEqual(buildCanvasRoomDocument(first), buildCanvasRoomDocument(second));
  assert.deepEqual(buildCanvasRoomDocument(first).nodes[0], textNode('a', { text: 'Hi Hello Alice', x: 25, y: 40 }));
  assert.deepEqual(buildCanvasRoomDocument(first).edges[0], { id: 'e', fromNode: 'a', toNode: 'b', color: '3', label: 'depends on' });
});

test('Canvas deletion wins concurrent updates and connections without resurrecting deleted nodes', (t) => {
  const first = createDoc(t, { nodes: [textNode('a'), textNode('b')] });
  const second = peerDoc(t, first);
  first.transact(() => deleteCanvasNodes(first, ['a']));
  second.transact(() => {
    updateCanvasNode(second, 'a', { x: 10 });
    addCanvasEdge(second, { id: 'edge', fromNode: 'a', toNode: 'b' });
  });
  exchange(first, second);
  assert.deepEqual(buildCanvasRoomDocument(first), { nodes: [textNode('b')] });
  assert.deepEqual(buildCanvasRoomDocument(first), buildCanvasRoomDocument(second));
});

test('Canvas reorders nodes without serializing order metadata or losing extension fields', (t) => {
  const doc = createDoc(t, { nodes: [textNode('z'), textNode('a', { extra: false }), textNode('m')] });
  doc.transact(() => reorderCanvasNode(doc, 'z', 'front'));
  assert.deepEqual(buildCanvasRoomDocument(doc).nodes.map((node) => node.id), ['a', 'm', 'z']);
  doc.transact(() => reorderCanvasNode(doc, 'm', 'back'));
  doc.transact(() => updateCanvasNode(doc, 'a', { color: '2' }));
  doc.transact(() => updateCanvasNode(doc, 'a', { color: undefined }));
  assert.deepEqual(buildCanvasRoomDocument(doc).nodes.map((node) => node.id), ['m', 'a', 'z']);
  assert.equal(buildCanvasRoomDocument(doc).nodes[1].extra, false);
  assert.equal(Object.hasOwn(buildCanvasRoomDocument(doc).nodes[1], 'color'), false);
  assert.equal(doc.getMap(CANVAS_META_KEY).get('edgesPresent'), false);
  assert.throws(() => updateCanvasNode(doc, 'a', { id: 'other' }), { code: 'CANVAS_INVALID' });
});

test('Canvas three-way reconciliation merges independent fields and preserves conflicting versions', () => {
  const baseline = { nodes: [textNode('a'), textNode('b')], vendor: { mode: 'normal' } };
  const local = structuredClone(baseline);
  local.nodes[0].x = 40;
  const external = structuredClone(baseline);
  external.nodes[0].color = '6';
  external.nodes[1].text = 'External';
  external.vendor.mode = 'custom';
  assert.deepEqual(mergeCanvasDocuments(baseline, local, external), {
    conflict: false,
    document: { ...external, nodes: [{ ...external.nodes[0], x: 40 }, external.nodes[1]] },
  });
  external.nodes[0].x = 100;
  assert.deepEqual(mergeCanvasDocuments(baseline, local, external), { conflict: true, document: local });
  external.nodes.shift();
  assert.equal(mergeCanvasDocuments(baseline, local, external).conflict, true);
});
