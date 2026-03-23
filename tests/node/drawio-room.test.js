import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createDrawioLeaseRoomName,
  isDrawioLeaseRoom,
  parseDrawioLeaseRoomName,
} from '../../src/domain/drawio-room.js';

test('drawio room helpers encode and decode lease room names', () => {
  const roomName = createDrawioLeaseRoomName('diagrams/architecture.drawio');

  assert.equal(roomName, '__drawio__:diagrams%2Farchitecture.drawio');
  assert.equal(isDrawioLeaseRoom(roomName), true);
  assert.deepEqual(parseDrawioLeaseRoomName(roomName), {
    filePath: 'diagrams/architecture.drawio',
    roomName,
  });
});

test('drawio room helpers reject unrelated room names', () => {
  assert.equal(createDrawioLeaseRoomName(''), '');
  assert.equal(isDrawioLeaseRoom('__workspace__'), false);
  assert.equal(parseDrawioLeaseRoomName('__workspace__'), null);
});
