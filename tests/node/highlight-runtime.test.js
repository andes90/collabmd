import test from 'node:test';
import assert from 'node:assert/strict';

import { AUTO_HIGHLIGHT_LANGUAGES, highlightFence, hljs } from '../../src/client/domain/highlight-runtime.js';

test('highlight runtime registers only the preview language set', () => {
  for (const language of AUTO_HIGHLIGHT_LANGUAGES) {
    assert.ok(hljs.getLanguage(language), language);
  }

  assert.equal(hljs.getLanguage('rust'), undefined);
  assert.match(highlightFence('const x = 1;', 'javascript'), /hljs-/);
  assert.match(highlightFence('SELECT 1;', 'mysql'), /hljs-/);
});
