import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';

test('compilePreviewDocument renders disclosures with Markdown, nesting, and source lines', () => {
  const markdownText = [
    '<details open>',
    '    <summary>',
    '        **Meeting template**',
    '    </summary>',
    '',
    '## Agenda',
    '',
    '- [x] Discuss [[Guide]]',
    '',
    '<details>',
    '<summary>Nested</summary>',
    '',
    'Body',
    '',
    '</details>',
    '</details>',
  ].join('\n');
  const { html } = compilePreviewDocument({ markdownText, fileList: ['Guide.md'] });
  assert.match(html, /<details open="" data-source-line="1" data-source-line-end="16">/u);
  assert.match(html, /<summary data-source-line="2" data-source-line-end="4"><strong>Meeting template<\/strong><\/summary>/u);
  assert.match(html, /<h2[^>]*data-source-line="6"[^>]*id="agenda"[^>]*>Agenda<\/h2>/u);
  assert.match(html, /type="checkbox" checked/u);
  assert.match(html, /class="wiki-link"/u);
  assert.equal((html.match(/<details[ >]/gu) ?? []).length, 2);
  assert.equal((html.match(/<\/details>/gu) ?? []).length, 2);
  const section = compilePreviewDocument({ markdownText, subpath: '#agenda' }).html;
  assert.match(section, /^<details /u);
  assert.match(section, /<h2[^>]*>Agenda<\/h2>/u);
  assert.match(section, /<\/details>\n$/u);
});

test('compilePreviewDocument keeps disclosure markup in code and rejects unsafe HTML', () => {
  const markdownText = [
    '<details>',
    '<summary><img src=x onerror=alert(1)> Label</summary>',
    '',
    '<script>alert(1)</script>',
    '',
    '```html',
    '</details>',
    '```',
    '',
    '`<summary>literal</summary>`',
    '',
    '</details>',
    '',
    '<details onclick="alert(1)">',
    '<summary onclick="alert(1)">Unsafe</summary>',
    '</details>',
    '',
    '    <details>',
    '    <summary>Indented code</summary>',
    '    </details>',
  ].join('\n');
  const { html } = compilePreviewDocument({ markdownText });
  assert.equal((html.match(/<details[ >]/gu) ?? []).length, 1);
  assert.doesNotMatch(html, /<img|<script|<details onclick|<summary onclick/u);
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/u);
  assert.match(html, /<code>&lt;summary&gt;literal&lt;\/summary&gt;<\/code>/u);
  assert.match(html, /&lt;summary&gt;Indented code&lt;\/summary&gt;/u);
  assert.match(compilePreviewDocument({ markdownText: '<details>\n<summary>Unclosed</summary>' }).html, /&lt;details&gt;/u);
  assert.match(compilePreviewDocument({ markdownText: '<summary>Outside</summary>' }).html, /&lt;summary&gt;/u);
});
