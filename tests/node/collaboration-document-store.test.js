import test from 'node:test';
import assert from 'node:assert/strict';

import { CollaborationRoom } from '../../src/server/domain/collaboration/collaboration-room.js';

function createRoom({ persistResult = { ok: true }, snapshotResult = { ok: true } } = {}) {
  const calls = { atomic: [], backlinks: [], snapshots: [] };
  const room = new CollaborationRoom({
    backlinkIndex: {
      updateFile(path, content) {
        calls.backlinks.push({ content, path });
      },
    },
    maxBufferedAmountBytes: 1024,
    name: 'notes.md',
    vaultFileStore: {
      async persistCollaborationState(path, state) {
        calls.atomic.push({ path, state });
        return persistResult;
      },
      async writeCollaborationSnapshot(path, snapshot) {
        calls.snapshots.push({ path, snapshot });
        return snapshotResult;
      },
    },
  });
  return { calls, room };
}

test('CollaborationRoom rejects failed atomic persistence', async (t) => {
  const { calls, room } = createRoom({
    persistResult: { ok: false, error: 'disk full' },
  });
  t.after(() => room.destroy());

  await assert.rejects(
    () => room.persistState({ content: '# Draft\n' }),
    /Failed to persist collaboration state for "notes\.md": disk full/,
  );
  assert.equal(calls.atomic.length, 1);
  assert.equal(calls.backlinks.length, 0);
});

test('CollaborationRoom persists state atomically and refreshes markdown backlinks', async (t) => {
  const { calls, room } = createRoom();
  t.after(() => room.destroy());
  const snapshot = Uint8Array.from([4, 5, 6]);
  const commentThreads = [{ id: 'thread-1' }];

  await room.persistState({ commentThreads, content: '# Atomic\n', snapshot });

  assert.deepEqual(calls.atomic, [{
    path: 'notes.md',
    state: { commentThreads, content: '# Atomic\n', includeContent: true, snapshot },
  }]);
  assert.deepEqual(calls.backlinks, [{ content: '# Atomic\n', path: 'notes.md' }]);
});

test('CollaborationRoom reports replacement snapshot failures', async (t) => {
  const { room } = createRoom({
    snapshotResult: { ok: false, error: 'snapshot path unavailable' },
  });
  t.after(() => room.destroy());

  await assert.rejects(
    () => room.writeSnapshot(Uint8Array.from([1])),
    /Failed to write collaboration snapshot for "notes\.md": snapshot path unavailable/,
  );
});
