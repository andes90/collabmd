import test from 'node:test';
import assert from 'node:assert/strict';
import * as Y from 'yjs';

import {
  createCommentThreadSharedType,
  normalizeCommentQuote,
  normalizeCommentQuoteForComparison,
  serializeCommentThreads,
} from '../../src/domain/comment-threads.js';

test('comment thread serialization supports new line and text anchors', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  const lineThread = createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 4,
    anchorKind: 'line',
    anchorQuote: 'Line quote',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 4,
    id: 'thread-line',
    messages: [{
      body: 'Line thread',
      id: 'comment-line',
      userName: 'Tester',
    }],
  });
  const textThread = createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 5,
    anchorKind: 'text',
    anchorQuote: 'selected text',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 5,
    id: 'thread-text',
    messages: [{
      body: 'Text thread',
      id: 'comment-text',
      userName: 'Tester',
    }],
  });

  threads.push([lineThread, textThread]);

  const serialized = serializeCommentThreads(threads);
  assert.equal(serialized.length, 2);
  assert.equal(serialized[0].anchorKind, 'line');
  assert.equal(serialized[1].anchorKind, 'text');
  assert.equal(serialized[1].anchorQuote, 'selected text');
});

test('comment thread serialization supports diagram element anchors with a fallback snapshot', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  threads.push([createCommentThreadSharedType({
    anchorKind: 'diagram-element',
    anchorPoint: { x: 140, y: 80 },
    anchorQuote: 'Architecture node',
    anchorSnapshot: {
      height: 40,
      text: 'Architecture node',
      type: 'rectangle',
      width: 80,
      x: 100,
      y: 60,
    },
    createdAt: 123,
    elementId: 'shape-1',
    id: 'thread-diagram',
    messages: [{
      body: 'Add the owner here',
      createdAt: 456,
      id: 'comment-diagram',
      userName: 'Tester',
    }],
  })]);

  const [serialized] = serializeCommentThreads(threads);
  assert.deepEqual(serialized, {
    anchorKind: 'diagram-element',
    anchorPoint: { x: 140, y: 80 },
    anchorQuote: 'Architecture node',
    anchorSnapshot: {
      height: 40,
      text: 'Architecture node',
      type: 'rectangle',
      width: 80,
      x: 100,
      y: 60,
    },
    createdAt: 123,
    createdByColor: '',
    createdByName: 'Tester',
    createdByPeerId: '',
    elementId: 'shape-1',
    id: 'thread-diagram',
    messages: [{
      body: 'Add the owner here',
      createdAt: 456,
      id: 'comment-diagram',
      peerId: '',
      reactions: [],
      userColor: '',
      userName: 'Tester',
    }],
    resolvedAt: null,
    resolvedByColor: '',
    resolvedByName: '',
    resolvedByPeerId: '',
  });
});

test('comment thread serialization ignores old-format thread records', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  const legacyMessages = new Y.Array();
  legacyMessages.push([{
    body: 'Legacy comment',
    id: 'comment-old',
    userName: 'Tester',
  }]);
  const legacyThread = new Y.Map();
  legacyThread.set('anchorEnd', { assoc: 0, type: null });
  legacyThread.set('anchorEndLine', 3);
  legacyThread.set('anchorExcerpt', 'old format');
  legacyThread.set('anchorStart', { assoc: 0, type: null });
  legacyThread.set('anchorStartLine', 3);
  legacyThread.set('id', 'thread-old');
  legacyThread.set('messages', legacyMessages);
  threads.push([legacyThread]);

  assert.deepEqual(serializeCommentThreads(threads), []);
});

test('normalizeCommentQuote preserves source formatting while trimming edges', () => {
  assert.equal(normalizeCommentQuote(' Hello \n   from\tcomment '), 'Hello \n   from\tcomment');
});

test('normalizeCommentQuoteForComparison collapses whitespace for stable preview matching', () => {
  assert.equal(normalizeCommentQuoteForComparison(' Hello \n   from\tcomment '), 'Hello from comment');
});

test('comment thread serialization preserves normalized message reactions', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  const thread = createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 4,
    anchorKind: 'line',
    anchorQuote: 'Line quote',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 4,
    id: 'thread-reactions',
    messages: [{
      body: 'Line thread',
      id: 'comment-reactions',
      reactions: [{
        emoji: '👍',
        users: [{
          reactedAt: 2,
          userColor: '#3b82f6',
          userId: 'user-1',
          userName: 'Tester',
        }, {
          reactedAt: 3,
          userColor: '#3b82f6',
          userId: 'user-1',
          userName: 'Tester updated',
        }],
      }],
      userName: 'Tester',
    }],
  });

  threads.push([thread]);

  const [serialized] = serializeCommentThreads(threads);
  assert.deepEqual(serialized.messages[0].reactions, [{
    emoji: '👍',
    users: [{
      reactedAt: 3,
      userColor: '#3b82f6',
      userId: 'user-1',
      userName: 'Tester updated',
    }],
  }]);
});

test('comment thread serialization ignores malformed reactions', () => {
  const doc = new Y.Doc();
  const threads = doc.getArray('comments');
  const thread = createCommentThreadSharedType({
    anchorEnd: { assoc: 0, type: null },
    anchorEndLine: 4,
    anchorKind: 'line',
    anchorQuote: 'Line quote',
    anchorStart: { assoc: 0, type: null },
    anchorStartLine: 4,
    id: 'thread-malformed-reactions',
    messages: [{
      body: 'Line thread',
      id: 'comment-malformed-reactions',
      reactions: [{
        emoji: '',
        users: [{
          userId: 'user-1',
        }],
      }, {
        emoji: '🎉',
        users: [{
          userId: '',
        }],
      }],
      userName: 'Tester',
    }],
  });

  threads.push([thread]);
  thread.set('reaction:{', {});
  thread.set('reaction:[]', {});
  thread.set('reaction:["comment-malformed-reactions",42,"user-1"]', {});
  thread.set('reaction:["comment-malformed-reactions","🎉","user-1"]', { userId: 'different-user' });
  thread.set('reaction:["missing-comment","🎉","user-1"]', { userId: 'user-1' });

  const [serialized] = serializeCommentThreads(threads);
  assert.deepEqual(serialized.messages[0].reactions, []);
});
