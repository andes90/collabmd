import test from 'node:test';
import assert from 'node:assert/strict';

import { presenceFeature } from '../../src/client/application/app-shell/presence-feature.js';

test('presenceFeature follows remote editor viewport before cursor fallback', () => {
  let scrollToViewportCalls = 0;
  let scrollToCursorCalls = 0;

  const context = {
    ...presenceFeature,
    currentFilePath: 'README.md',
    followedCursorSignature: '',
    isExcalidrawFile: () => false,
    resolveFileClientId: () => 7,
    session: {
      getUserCursor: () => ({ cursorAnchor: 90, cursorHead: 120, cursorLine: 8 }),
      getUserViewport: () => ({ topLine: 42, viewportRatio: 0.35 }),
      scrollToLine() {
        throw new Error('unexpected scrollToLine fallback');
      },
      scrollToPosition() {
        throw new Error('unexpected scrollToPosition fallback');
      },
      scrollToUserCursor() {
        scrollToCursorCalls += 1;
        return false;
      },
      scrollToUserViewport() {
        scrollToViewportCalls += 1;
        return true;
      },
    },
  };

  context.followUserCursor({ clientId: 'global-1', peerId: 'peer-1' }, { force: true });

  assert.equal(scrollToViewportCalls, 1);
  assert.equal(scrollToCursorCalls, 0);
  assert.match(context.followedCursorSignature, /^global-1:42:/);
});

test('presenceFeature routes excalidraw follow through the embed controller', async () => {
  const calls = [];
  const context = {
    ...presenceFeature,
    currentFilePath: 'diagram.excalidraw',
    followedCursorSignature: '',
    excalidrawEmbed: {
      async setFollowedUser(filePath, peerId) {
        calls.push({ filePath, peerId });
        return true;
      },
    },
    isExcalidrawFile: (filePath) => filePath.endsWith('.excalidraw'),
  };

  context.followUserCursor({ clientId: 'global-2', peerId: 'peer-2' }, { force: true });
  await Promise.resolve();

  assert.deepEqual(calls, [{
    filePath: 'diagram.excalidraw',
    peerId: 'peer-2',
  }]);
  assert.equal(context.followedCursorSignature, 'excalidraw:diagram.excalidraw:peer-2');
});
