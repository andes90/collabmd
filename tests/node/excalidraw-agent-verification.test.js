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

test('Excalidraw inspection reports paint order, broken bindings, and text clipping', () => {
  const result = inspectAgentExcalidrawScene(scene([
    { height: 100, id: 'left', type: 'rectangle', width: 100, x: 0, y: 0 },
    { height: 100, id: 'right', type: 'rectangle', width: 100, x: 80, y: 80 },
    {
      containerId: 'left',
      fontSize: 20,
      height: 10,
      id: 'label',
      lineHeight: 1.5,
      text: 'Clipped label',
      textAlign: 'right',
      type: 'text',
      verticalAlign: 'top',
      width: 20,
      x: 10,
      y: 10,
    },
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
    new Set([
      'bound-text-height-stale',
      'bound-text-not-centered',
      'missing-binding-target',
      'text-overflow',
      'unintended-overlap',
    ]),
  );
  assert.equal(result.valid, false);
  assert.deepEqual(result.layout.boundText, {
    misaligned: 1,
    outsideContainer: 0,
    staleHeight: 1,
    total: 1,
  });
  assert.equal(result.elements[0].paintOrder, 0);
  assert.equal(result.elements[0].behind, 'right');
  assert.equal(result.elements[1].inFrontOf, 'left');
  assert.equal(result.elements.find(({ id }) => id === 'arrow').endElementId, 'missing');
  assert.deepEqual(
    result.elements.find(({ id }) => id === 'label'),
    {
      behind: 'arrow',
      containerId: 'left',
      fontFamily: 5,
      fontName: 'Excalifont',
      fontSize: 20,
      height: 10,
      id: 'label',
      inFrontOf: 'right',
      lineHeight: 1.5,
      paintOrder: 2,
      text: 'Clipped label',
      textAlign: 'right',
      type: 'text',
      verticalAlign: 'top',
      width: 20,
      x: 10,
      y: 10,
    },
  );
});

test('Excalidraw inspection trusts auto-resized text bounds', () => {
  const result = inspectAgentExcalidrawScene(scene([{
    autoResize: true,
    fontSize: 30,
    height: 37.5,
    id: 'title',
    lineHeight: 1.25,
    text: 'Temporal + Kotlin Spring Boot',
    type: 'text',
    width: 437.63995361328125,
    x: 0,
    y: 0,
  }]));

  assert.deepEqual(result.warnings, []);
});

test('Excalidraw inspection warns when bound endpoints are far from their targets', () => {
  const result = inspectAgentExcalidrawScene(scene([
    { height: 80, id: 'target', type: 'rectangle', width: 120, x: 300, y: 20 },
    {
      endBinding: { elementId: 'target' },
      id: 'arrow',
      points: [[0, 0], [100, 0]],
      type: 'arrow',
      x: 0,
      y: 60,
    },
  ]));

  assert.deepEqual(result.warnings, [{
    code: 'bound-endpoint-far',
    elementIds: ['arrow', 'target'],
    message: 'Element arrow end endpoint is 200 diagram units from bound target target.',
  }]);
});

test('Excalidraw inspection warns for connector crossings and ungrouped overlaps', () => {
  const result = inspectAgentExcalidrawScene(scene([
    { height: 60, id: 'zone', type: 'rectangle', width: 220, x: -10, y: -10 },
    { height: 40, id: 'source', type: 'rectangle', width: 40, x: 0, y: 0 },
    { height: 40, id: 'blocked', type: 'rectangle', width: 40, x: 80, y: 0 },
    { height: 40, id: 'target', type: 'rectangle', width: 40, x: 160, y: 0 },
    {
      endBinding: { elementId: 'target' },
      id: 'connector',
      points: [[0, 0], [120, 0]],
      startBinding: { elementId: 'source' },
      type: 'arrow',
      x: 40,
      y: 20,
    },
    { height: 100, id: 'overlap-a', type: 'rectangle', width: 100, x: 0, y: 100 },
    { height: 100, id: 'overlap-b', type: 'rectangle', width: 100, x: 80, y: 180 },
    { groupIds: ['cluster'], height: 100, id: 'group-a', type: 'rectangle', width: 100, x: 240, y: 100 },
    { groupIds: ['cluster'], height: 100, id: 'group-b', type: 'rectangle', width: 100, x: 320, y: 180 },
  ]));

  assert.deepEqual(result.warnings, [
    {
      code: 'connector-through-component',
      elementIds: ['connector', 'blocked'],
      message: 'Connector connector passes through component blocked.',
    },
    {
      code: 'unintended-overlap',
      elementIds: ['overlap-a', 'overlap-b'],
      message: 'Components overlap-a and overlap-b overlap without a shared group.',
    },
  ]);
});

test('Excalidraw inspection only warns for demonstrable full occlusion', () => {
  const result = inspectAgentExcalidrawScene(scene([
    { backgroundColor: '#ffffff', fillStyle: 'solid', height: 20, id: 'detail', type: 'rectangle', width: 20, x: 10, y: 10 },
    { backgroundColor: '#000000', fillStyle: 'solid', height: 100, id: 'cover', opacity: 100, type: 'rectangle', width: 100, x: 0, y: 0 },
  ]));

  assert.deepEqual(result.warnings, [{
    code: 'fully-occluded',
    elementIds: ['detail', 'cover'],
    message: 'Element detail is fully occluded by cover.',
  }]);
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
  assert.equal(result.renderer, 'collabmd-basic-svg');
  assert.equal(result.rendererVersion, '1');
  assert.deepEqual(result.warnings, ['preview-not-pixel-identical']);
});
