import test from 'node:test';
import assert from 'node:assert/strict';

import { renderCommentMarkdownToHtml } from '../../src/client/presentation/comment-markdown-renderer.js';

test('renders multiline comment paragraphs with hard line breaks', () => {
  const html = renderCommentMarkdownToHtml('Line one\nLine two');

  assert.match(html, /<p>Line one<br>\s*Line two<\/p>/);
});

test('renders fenced code blocks with pre and code tags', () => {
  const html = renderCommentMarkdownToHtml('```js\nconst value = 1;\n```');

  assert.match(html, /<pre><code class="language-js">/);
  assert.match(html, /const value = 1;/);
  assert.match(html, /<\/code><\/pre>/);
});

test('renders links with safe external link attributes', () => {
  const html = renderCommentMarkdownToHtml('[OpenAI](https://openai.com)');

  assert.match(html, /href="https:\/\/openai\.com"/);
  assert.match(html, /target="_blank"/);
  assert.match(html, /rel="noopener noreferrer"/);
});

test('escapes raw html instead of rendering it', () => {
  const html = renderCommentMarkdownToHtml('<script>alert(1)</script>');

  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
  assert.doesNotMatch(html, /<script>/);
});
