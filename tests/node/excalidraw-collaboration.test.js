import test from 'node:test';
import assert from 'node:assert/strict';

import {
  buildCollaboratorsMap,
  findCollaboratorByPeerId,
  normalizeCollaboratorViewport,
} from '../../src/client/domain/excalidraw-collaboration.js';

test('normalizeCollaboratorViewport accepts finite viewport values', () => {
  assert.deepEqual(
    normalizeCollaboratorViewport({ scrollX: 10, scrollY: -4, zoom: 1.25 }),
    { scrollX: 10, scrollY: -4, zoom: 1.25 },
  );
  assert.equal(normalizeCollaboratorViewport({ scrollX: 10, scrollY: 2, zoom: 0 }), undefined);
  assert.equal(normalizeCollaboratorViewport({ scrollX: 'x', scrollY: 2, zoom: 1 }), undefined);
});

test('buildCollaboratorsMap preserves viewport awareness and peer lookup', () => {
  const awareness = {
    clientID: 9,
    getStates() {
      return new Map([
        [3, {
          pointer: { tool: 'pointer', x: 100, y: 200 },
          pointerButton: 'down',
          selectedElementIds: { shapeA: true },
          user: {
            color: '#123456',
            colorLight: '#12345633',
            name: 'Remote User',
            peerId: 'peer-remote',
          },
          viewport: { scrollX: 40, scrollY: 90, zoom: 1.4 },
        }],
      ]);
    },
  };

  const collaborators = buildCollaboratorsMap(awareness);
  const collaborator = collaborators.get('3');

  assert.deepEqual(collaborator.viewport, { scrollX: 40, scrollY: 90, zoom: 1.4 });
  assert.equal(findCollaboratorByPeerId(collaborators, 'peer-remote'), collaborator);
  assert.equal(findCollaboratorByPeerId(collaborators, 'missing-peer'), null);
});
