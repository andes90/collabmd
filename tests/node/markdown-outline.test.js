import assert from 'node:assert/strict';
import test from 'node:test';

import { collectMarkdownOutline } from '../../src/domain/markdown-outline.js';

test('outline preserves heading lines and duplicates while skipping frontmatter and code', () => {
  const content = [
    '---', '# hidden', 'title: Note', '---', '# Title #', '```md', '# hidden',
    '````', '## Same', '~~~', '# hidden', '~~~', '## Same', 'Setext', '===',
    '    # code', '> # quoted', '- # list', '#nospace', '#',
  ].join('\r\n');
  assert.deepEqual(collectMarkdownOutline(content), [
    { level: 1, line: 5, text: 'Title', truncated: false },
    { level: 2, line: 9, text: 'Same', truncated: false },
    { level: 2, line: 13, text: 'Same', truncated: false },
    { level: 1, line: 14, text: 'Setext', truncated: false },
    { level: 1, line: 20, text: '', truncated: false },
  ]);
  const [long] = collectMarkdownOutline(`# ${'x'.repeat(201)}`);
  assert.equal(long.text.length, 200);
  assert.equal(long.truncated, true);
  assert.deepEqual(collectMarkdownOutline('```\n# unclosed'), []);
});
