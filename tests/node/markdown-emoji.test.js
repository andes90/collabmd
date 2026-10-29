import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

test('compilePreviewDocument renders emoji shortcodes without changing code, URLs, or emoticons', () => {
  const markdownText = [
    '# Meeting :computer:',
    '',
    '- [x] :clock8: :hand: :rocket: :tada: :sparkles: :heavy_check_mark: :thumbsdown:',
    '',
    '`:computer:` :unknown_shortcode: :)',
    '',
    '[Link](https://example.com/:computer:)',
    '',
    '```text',
    ':computer:',
    '```',
  ].join('\n');
  const { html } = compilePreviewDocument({ markdownText });
  assert.match(html, /Meeting 💻<\/h1>/u);
  assert.match(html, /type="checkbox" checked/u);
  for (const emoji of ['🕗', '✋', '🚀', '🎉', '✨', '✔', '👎']) {
    assert.ok(html.includes(emoji), emoji);
  }
  assert.match(html, /<code>:computer:<\/code>/u);
  assert.match(html, /:unknown_shortcode: :\)/u);
  assert.match(html, /href="https:\/\/example.com\/:computer:"/u);
  assert.match(html, /<pre[^>]*><code[^>]*>:computer:\n<\/code><\/pre>/u);
  assert.equal(markdownText.includes('💻'), false);
});
