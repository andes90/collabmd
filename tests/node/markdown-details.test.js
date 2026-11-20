import test from 'node:test';
import assert from 'node:assert/strict';

import { compilePreviewDocument } from '../../src/client/application/preview-render-compiler.js';
import { getMarkdownHeadings } from '../../src/client/domain/markdown-headings.js';

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

test('disclosure boundaries ignore literal tags in list-nested fences and indented code', () => {
  const markdownText = [
    '<details>',
    '<summary>Examples</summary>',
    '',
    '- ```',
    '  </details>',
    '  ```',
    '',
    '      <summary>Indented example</summary>',
    '',
    'Still inside.',
    '</details>',
    '',
    'Outside.',
  ].join('\n');
  const { html } = compilePreviewDocument({ markdownText });
  assert.match(html, /<pre[^>]*><code[^>]*>&lt;\/details&gt;\n<\/code><\/pre>/u);
  assert.match(html, /<pre[^>]*><code[^>]*>&lt;summary&gt;Indented example&lt;\/summary&gt;\n<\/code><\/pre>/u);
  assert.match(html, /Still inside\.<\/p>\n<\/details>\n<p[^>]*>Outside\.<\/p>/u);
});

test('a standalone close cannot pair with an opening tag in a different list item', () => {
  const markdownText = '- <details>\n  <summary>Unclosed</summary>\n- </details>\n\nAfter.';
  const { html } = compilePreviewDocument({ markdownText });
  assert.doesNotMatch(html, /<details[ >]/u);
  assert.match(html, /&lt;details&gt;/u);
  assert.match(html, /&lt;\/details&gt;/u);
});

test('an invalid backtick fence opener does not hide the disclosure close', () => {
  const markdownText = '<details>\n<summary>Template</summary>\n\n```not`a-fence\n</details>\n\nOutside.';
  const { html } = compilePreviewDocument({ markdownText });
  assert.match(html, /```not`a-fence<\/p>\n<\/details>\n<p[^>]*>Outside\.<\/p>/u);
});

test('the Canvas heading picker and excerpt agree on an underlined heading after a summary', () => {
  const markdownText = '<details>\n<summary>Template</summary>\nAgenda\n------\n\nMeeting body.\n\n</details>';
  const headings = getMarkdownHeadings(markdownText);
  assert.deepEqual(headings, [{ id: 'agenda', text: 'Agenda' }]);
  const { html } = compilePreviewDocument({ markdownText, subpath: `#${headings[0].id}` });
  assert.match(html, /^<details[^>]* open="">/u);
  assert.match(html, /<h2[^>]* id="agenda">Agenda<\/h2>/u);
  assert.match(html, /Meeting body\.<\/p>\n<\/details>\n$/u);
});
