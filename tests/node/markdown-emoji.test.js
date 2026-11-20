import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

test('compilePreviewDocument renders emoji shortcodes without changing code, URLs, or emoticons', () => {
  const url = 'https://example.com/:computer:';
  const markdownText = [
    '# Meeting :computer:',
    '',
    '- [x] :clock8: :hand: :rocket: :tada: :sparkles: :heavy_check_mark: :thumbsdown:',
    '',
    '`:computer:` :unknown_shortcode: :)',
    '',
    String.raw`\:computer: &colon;computer:`,
    '',
    `${url} <${url}> [Link :rocket:](${url})`,
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
  assert.match(html, />:computer: :computer:<\/p>/u);
  assert.equal(html.split(`>${url}</a>`).length - 1, 2);
  assert.match(html, /href="https:\/\/example\.com\/:computer:"[^>]*>Link 🚀<\/a>/u);
  assert.match(html, /<pre[^>]*><code[^>]*>:computer:\n<\/code><\/pre>/u);
});

test('renders shortcodes in wiki aliases without changing targets or escaped text', () => {
  const { html } = compilePreviewDocument({
    fileList: ['Roadmap.md', 'Roadmap :rocket:.md'],
    markdownText: [
      '[[Roadmap|:rocket: Roadmap]] and ![[diagram.mmd|:rocket: Roadmap]]',
      String.raw`[[Roadmap :rocket:|Literal \:rocket: and :computer:]]`,
      '![[assets/:computer:.png|:rocket: Screenshot]]',
    ].join('\n\n'),
  });

  assert.match(html, /class="wiki-link"[^>]*data-wiki-target="Roadmap"[^>]*>🚀 Roadmap<\/a>/u);
  assert.match(html, /data-mermaid-target="diagram\.mmd" data-mermaid-label="🚀 Roadmap"/u);
  assert.match(html, /class="wiki-link"[^>]*data-wiki-target="Roadmap :rocket:"[^>]*>Literal :rocket: and 💻<\/a>/u);
  assert.match(html, /src="\/api\/attachment\?path=assets%2F%3Acomputer%3A\.png" alt="🚀 Screenshot"/u);
});
