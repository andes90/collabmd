import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import { createCommentThreadSharedType, serializeCommentThreads } from '../../src/domain/comment-threads.js';
import { CommentThreadStore } from '../../src/client/infrastructure/comment-thread-store.js';

function createStoreHarness({ doc = new Y.Doc(), canWrite = () => true, userId = 'user-1' } = {}) {
  const commentThreads = doc.getArray('comments');
  const ytext = doc.getText('codemirror');
  if (ytext.length === 0) ytext.insert(0, '# Notes\n\nHello\n');
  const localUserRef = {
    current: {
      color: '#3b82f6',
      name: 'Tester',
      peerId: 'peer-1',
      userId,
    },
  };

  const store = new CommentThreadStore({
    canWrite,
    getDoc: () => doc,
    getEditorState: () => null,
    getLocalUser: () => localUserRef.current,
  });
  store.bind({ commentThreads, ydoc: doc, ytext });

  return {
    commentThreads,
    doc,
    localUserRef,
    store,
  };
}

function seedThread(commentThreads, reactions = []) {
  commentThreads.push([createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 3,
    anchorKind: 'line',
    anchorQuote: 'Hello',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 3,
    id: 'thread-1',
    messages: [{
      body: 'Hello comment',
      id: 'comment-1',
      reactions,
      userName: 'Tester',
    }],
  })]);
}

test('toggleCommentReaction adds and removes the local reaction', () => {
  const { commentThreads, store } = createStoreHarness();
  seedThread(commentThreads);

  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '👍'), true);
  let [thread] = serializeCommentThreads(commentThreads);
  assert.equal(thread.messages[0].reactions.length, 1);
  assert.equal(thread.messages[0].reactions[0].emoji, '👍');
  assert.equal(thread.messages[0].reactions[0].users.length, 1);
  assert.equal(thread.messages[0].reactions[0].users[0].userId, 'user-1');

  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '👍'), true);
  [thread] = serializeCommentThreads(commentThreads);
  assert.deepEqual(thread.messages[0].reactions, []);
});

test('toggleCommentReaction aggregates multiple users and removes empty groups', () => {
  const { commentThreads, localUserRef, store } = createStoreHarness();
  seedThread(commentThreads);

  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);
  localUserRef.current = {
    color: '#22c55e',
    name: 'Reviewer',
    peerId: 'peer-2',
    userId: 'user-2',
  };
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);

  let [thread] = serializeCommentThreads(commentThreads);
  assert.equal(thread.messages[0].reactions.length, 1);
  assert.equal(thread.messages[0].reactions[0].users.length, 2);
  assert.deepEqual(thread.messages[0].reactions[0].users.map((user) => user.userId), ['user-1', 'user-2']);

  localUserRef.current = {
    color: '#3b82f6',
    name: 'Tester',
    peerId: 'peer-1',
    userId: 'user-1',
  };
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);
  [thread] = serializeCommentThreads(commentThreads);
  assert.equal(thread.messages[0].reactions[0].users.length, 1);
  assert.equal(thread.messages[0].reactions[0].users[0].userId, 'user-2');

  localUserRef.current = {
    color: '#22c55e',
    name: 'Reviewer',
    peerId: 'peer-2',
    userId: 'user-2',
  };
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '🎉'), true);
  [thread] = serializeCommentThreads(commentThreads);
  assert.deepEqual(thread.messages[0].reactions, []);
});

test('concurrent reactions merge without replacing the shared message in either update order', () => {
  for (const reverse of [false, true]) {
    const first = createStoreHarness();
    seedThread(first.commentThreads);
    const secondDoc = new Y.Doc();
    Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(first.doc));
    const second = createStoreHarness({ doc: secondDoc, userId: 'user-2' });
    const originalMessage = first.commentThreads.get(0).get('messages').get(0);

    first.store.toggleCommentReaction('thread-1', 'comment-1', '👍');
    second.store.toggleCommentReaction('thread-1', 'comment-1', '👍');
    const updates = [Y.encodeStateAsUpdate(first.doc), Y.encodeStateAsUpdate(second.doc)];
    for (const index of reverse ? [1, 0] : [0, 1]) {
      Y.applyUpdate(first.doc, updates[index]);
      Y.applyUpdate(second.doc, updates[index]);
    }

    const [thread] = serializeCommentThreads(first.commentThreads);
    assert.equal(thread.messages.length, 1);
    assert.deepEqual(thread.messages[0].reactions[0].users.map((user) => user.userId), ['user-1', 'user-2']);
    assert.deepEqual(serializeCommentThreads(second.commentThreads), [thread]);
    assert.equal(first.commentThreads.get(0).get('messages').get(0), originalMessage);
    first.store.unbind();
    second.store.unbind();
    first.doc.destroy();
    second.doc.destroy();
  }
});

test('concurrent removal of a legacy reaction and another user addition survive snapshots and sidecars', () => {
  const first = createStoreHarness();
  seedThread(first.commentThreads, [{ emoji: '👍', users: [{ userId: 'user-1', reactedAt: 1 }] }]);
  const secondDoc = new Y.Doc();
  Y.applyUpdate(secondDoc, Y.encodeStateAsUpdate(first.doc));
  const second = createStoreHarness({ doc: secondDoc, userId: 'user-2' });
  first.store.toggleCommentReaction('thread-1', 'comment-1', '👍');
  second.store.toggleCommentReaction('thread-1', 'comment-1', '👍');
  Y.applyUpdate(first.doc, Y.encodeStateAsUpdate(second.doc));
  Y.applyUpdate(second.doc, Y.encodeStateAsUpdate(first.doc));

  const records = serializeCommentThreads(first.commentThreads);
  assert.equal(records[0].messages.length, 1);
  assert.deepEqual(records[0].messages[0].reactions[0].users.map((user) => user.userId), ['user-2']);
  assert.deepEqual(serializeCommentThreads(second.commentThreads), records);
  const restoredDoc = new Y.Doc();
  Y.applyUpdate(restoredDoc, Y.encodeStateAsUpdate(first.doc));
  assert.deepEqual(serializeCommentThreads(restoredDoc.getArray('comments')), records);
  const sidecarDoc = new Y.Doc();
  sidecarDoc.getArray('comments').push(records.map(createCommentThreadSharedType));
  assert.deepEqual(serializeCommentThreads(sidecarDoc.getArray('comments')), records);

  const restored = createStoreHarness({ doc: restoredDoc });
  restored.store.toggleCommentReaction('thread-1', 'comment-1', '👍');
  assert.deepEqual(
    serializeCommentThreads(restored.commentThreads)[0].messages[0].reactions[0].users.map((user) => user.userId),
    ['user-1', 'user-2'],
  );
  [first, second, restored].forEach(({ store, doc }) => { store.unbind(); doc.destroy(); });
  sidecarDoc.destroy();
});

test('reactions respect read-only sessions', () => {
  const { commentThreads, doc, store } = createStoreHarness({ canWrite: () => false });
  seedThread(commentThreads);
  assert.equal(store.toggleCommentReaction('thread-1', 'comment-1', '👍'), false);
  assert.deepEqual(serializeCommentThreads(commentThreads)[0].messages[0].reactions, []);
  store.unbind();
  doc.destroy();
});
