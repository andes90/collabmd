import test from 'node:test';
import assert from 'node:assert/strict';
import { canvasColor, canvasEdgeGeometry, canvasFilePath, canvasLinkUrl, canvasSideAtPoint } from '../../src/client/domain/canvas-view.js';

test('canvas references allow supported URLs and Vault paths without escaping the Vault', () => {
  assert.equal(canvasFilePath('notes/example.md'), 'notes/example.md');
  for (const value of ['/etc/passwd', '../secret.md', 'notes/../secret.md', '.collabmd/yjs/file.bin', 'file:///tmp/a', 'https://example.com', 'a\0b']) {
    assert.equal(canvasFilePath(value), null);
  }
  assert.equal(canvasLinkUrl('https://example.com/a'), 'https://example.com/a');
  for (const value of ['javascript:alert(1)', 'data:text/html,hello', 'file:///tmp/a', '/api/file']) assert.equal(canvasLinkUrl(value), null);
  assert.equal(canvasColor('6'), 'var(--canvas-color-6)');
  assert.equal(canvasColor('#Ab12cF'), '#Ab12cF');
  assert.equal(canvasColor('url(https://example.com)'), 'var(--color-border)');
});

test('canvas connections respect explicit sides and omit deleted endpoints', () => {
  const nodes = new Map([
    ['a', { x: 0, y: 0, width: 100, height: 100 }],
    ['b', { x: 300, y: 0, width: 100, height: 100 }],
  ]);
  const edge = { fromNode: 'a', toNode: 'b', fromSide: 'top', toSide: 'bottom' };
  const geometry = canvasEdgeGeometry(edge, nodes);
  assert.match(geometry.path, /^M 50 0 C /);
  assert.match(geometry.path, /350 100$/);
  nodes.delete('b');
  assert.equal(canvasEdgeGeometry(edge, nodes), null);
});

test('dropped connections choose the nearest card edge', () => {
  const node = { x: -100, y: 50, width: 200, height: 100 };
  assert.equal(canvasSideAtPoint(node, { x: -95, y: 100 }), 'left');
  assert.equal(canvasSideAtPoint(node, { x: 100, y: 80 }), 'right');
  assert.equal(canvasSideAtPoint(node, { x: 0, y: 55 }), 'top');
  assert.equal(canvasSideAtPoint(node, { x: 50, y: 150 }), 'bottom');
});
