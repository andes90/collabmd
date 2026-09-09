import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTO_HIGHLIGHT_LANGUAGES, getHighlightCacheSize, highlightFence, hljs } from '../../src/client/domain/highlight-runtime.js';

test('highlight runtime registers only the preview language set', () => {
  for (const language of AUTO_HIGHLIGHT_LANGUAGES) {
    assert.ok(hljs.getLanguage(language), language);
  }

  assert.equal(hljs.getLanguage('rust'), undefined);
  assert.match(highlightFence('const x = 1;', 'javascript'), /hljs-/);
  assert.match(highlightFence('SELECT 1;', 'mysql'), /hljs-/);
});

test('highlightFence memoizes repeated fences instead of re-highlighting', () => {
  const sizeBefore = getHighlightCacheSize();
  const first = highlightFence('print("hello")\n'.repeat(20), 'unknown-language');
  const second = highlightFence('print("hello")\n'.repeat(20), 'unknown-language');

  assert.equal(second, first);
  assert.equal(getHighlightCacheSize(), sizeBefore + 1);
});
