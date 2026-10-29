import assert from 'node:assert/strict';
import test from 'node:test';
import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

const render = (markdownText, options = {}) => compilePreviewDocument({ markdownText, ...options }).html;

test('TOC uses the final contextual heading IDs and nests skipped heading levels', () => {
  const html = render('[TOC]\n\n# First\n\n### **Updates**\n\n# Second\n\n### [Updates](https://example.com)\n\n# First');
  const toc = /<nav[^>]*>([\s\S]*?)<\/nav>/u.exec(html)[1];
  const ids = [...html.matchAll(/<h[1-6][^>]* id="([^"]+)"/gu)].map((match) => match[1]);
  const links = [...toc.matchAll(/href="#([^"]+)"/gu)].map((match) => decodeURIComponent(match[1]));
  assert.deepEqual(links, ids);
  assert.equal(new Set(links).size, ids.length);
  assert.match(toc, /<li><a[^>]*>First<\/a><ol><li><a[^>]*>Updates<\/a>/u);
  assert.doesNotMatch(toc, /<strong>|https:\/\/example.com/u);
  assert.match(html, /aria-label="Table of contents" data-source-line="1" data-source-line-end="1"/u);
});

test('TOC handles multiple markers, empty notes, excerpts, and escaped labels', () => {
  const markdownText = '[toc]\n\n# A & B\n\n## <script>alert(1)</script>\n\n[TOC]';
  const html = render(markdownText);
  assert.equal((html.match(/<nav /gu) ?? []).length, 2);
  assert.match(html, /<a[^>]*>A &amp; B<\/a>/u);
  assert.match(html, /<a[^>]*>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/a>/u);
  assert.doesNotMatch(html, /<script>/u);
  assert.equal(render('[TOC]').trim(), '');
  const excerpt = render('# Outside\n\n# Section\n\n[TOC]\n\n## Child', { subpath: '#section' });
  const toc = /<nav[^>]*>([\s\S]*?)<\/nav>/u.exec(excerpt)[1];
  assert.doesNotMatch(toc, /Outside/u);
  assert.match(toc, /href="#section"/u);
  assert.match(toc, /href="#child"/u);
});

test('TOC preserves inline markers, code spans, and fenced/indented code', () => {
  const html = render('An inline [TOC] marker.\n\n`[TOC]`\n\n```markdown\n[TOC]\n```\n\n    [TOC]\n\n# Heading');
  assert.doesNotMatch(html, /<nav /u);
  assert.match(html, /An inline \[TOC\] marker/u);
  assert.match(html, /<code>\[TOC\]<\/code>/u);
  assert.match(html, /<code>\[TOC\]\n<\/code>/u);
});
