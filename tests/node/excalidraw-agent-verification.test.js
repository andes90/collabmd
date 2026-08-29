import assert from 'node:assert/strict';
import test from 'node:test';

import {
  inspectAgentExcalidrawScene,
  renderAgentExcalidrawSvg,
} from '../../src/domain/excalidraw-agent-verification.js';

function scene(elements) {
  return {
    appState: { gridSize: null, viewBackgroundColor: '#ffffff' },
    elements,
    files: {},
    source: 'collabmd',
    type: 'excalidraw',
    version: 2,
  };
}

test('Excalidraw inspection reports geometry, broken bindings, overlap, and text clipping', () => {
  const result = inspectAgentExcalidrawScene(scene([
    { height: 100, id: 'left', type: 'rectangle', width: 100, x: 0, y: 0 },
    { height: 100, id: 'right', type: 'rectangle', width: 100, x: 80, y: 80 },
    { fontSize: 20, height: 10, id: 'label', text: 'Clipped label', type: 'text', width: 20, x: 10, y: 10 },
    {
      endBinding: { elementId: 'missing' },
      id: 'arrow',
      points: [[0, 0], [50, 0]],
      type: 'arrow',
      x: 0,
      y: 160,
    },
  ]));

  assert.deepEqual(result.bounds, { height: 180, width: 180, x: 0, y: 0 });
  assert.equal(result.elementCount, 4);
  assert.deepEqual(
    new Set(result.warnings.map(({ code }) => code)),
    new Set(['missing-binding-target', 'shape-overlap', 'text-overflow']),
  );
  assert.equal(result.elements.find(({ id }) => id === 'arrow').endElementId, 'missing');
});

test('Excalidraw renderer produces bounded SVG with escaped text', () => {
  const result = renderAgentExcalidrawSvg(scene([
    { backgroundColor: '#a5d8ff', height: 80, id: 'box', type: 'rectangle', width: 160, x: 20, y: 20 },
    { fontSize: 20, height: 30, id: 'label', text: 'API <safe>', type: 'text', width: 120, x: 40, y: 45 },
  ]), { padding: 20, scale: 2 });

  assert.equal(result.width, 400);
  assert.equal(result.height, 240);
  assert.match(result.svg, /^<svg /u);
  assert.match(result.svg, /<rect /u);
  assert.match(result.svg, /API &lt;safe&gt;/u);
  assert.doesNotMatch(result.svg, /API <safe>/u);
});
