import test from 'node:test';
import assert from 'node:assert/strict';

import { createMarkdownToolbarEdit } from '../../src/client/domain/markdown-formatting.js';

function applyEdit(text, range, action) {
  const edit = createMarkdownToolbarEdit(text, range, action);
  assert.ok(edit, `expected an edit for action "${action}"`);
  return {
    nextText: `${text.slice(0, edit.from)}${edit.insert}${text.slice(edit.to)}`,
    selection: { anchor: edit.anchor, head: edit.head },
  };
}

test('wraps a selection in bold markers', () => {
  const result = applyEdit('hello world', { from: 0, to: 5 }, 'bold');
  assert.equal(result.nextText, '**hello** world');
  assert.deepEqual(result.selection, { anchor: 2, head: 7 });
});

test('creates a markdown link from selected text and selects the URL placeholder', () => {
  const result = applyEdit('docs', { from: 0, to: 4 }, 'link');
  assert.equal(result.nextText, '[docs](https://)');
  assert.deepEqual(result.selection, { anchor: 7, head: 15 });
});

test('wraps a selection in strikethrough markers', () => {
  const result = applyEdit('legacy', { from: 0, to: 6 }, 'strikethrough');
  assert.equal(result.nextText, '~~legacy~~');
  assert.deepEqual(result.selection, { anchor: 2, head: 8 });
});

test('creates an image markdown node from selected alt text and selects the URL placeholder', () => {
  const result = applyEdit('diagram', { from: 0, to: 7 }, 'image');
  assert.equal(result.nextText, '![diagram](https://)');
  assert.deepEqual(result.selection, { anchor: 11, head: 19 });
});

test('toggles bullet list prefixes for a multiline selection', () => {
  const added = applyEdit('first\nsecond', { from: 0, to: 12 }, 'bullet-list');
  assert.equal(added.nextText, '- first\n- second');

  const removed = applyEdit(added.nextText, { from: 0, to: added.nextText.length }, 'bullet-list');
  assert.equal(removed.nextText, 'first\nsecond');
});

test('numbers each non-empty line in a selection', () => {
  const result = applyEdit('alpha\n\nbeta', { from: 0, to: 11 }, 'numbered-list');
  assert.equal(result.nextText, '1. alpha\n\n2. beta');
});

test('wraps and unwraps fenced code blocks', () => {
  const wrapped = applyEdit('console.log(1);', { from: 0, to: 15 }, 'code-block');
  assert.equal(wrapped.nextText, '```\nconsole.log(1);\n```');

  const unwrapped = applyEdit(wrapped.nextText, { from: 0, to: wrapped.nextText.length }, 'code-block');
  assert.equal(unwrapped.nextText, 'console.log(1);');
});

test('inserts a table template and selects the first header cell', () => {
  const result = applyEdit('', { from: 0, to: 0 }, 'table');
  assert.equal(
    result.nextText,
    '| Column 1 | Column 2 |\n| --- | --- |\n| Value | Value |',
  );
  assert.deepEqual(result.selection, { anchor: 2, head: 10 });
});

test('inserts a table around selected text as the first body cell', () => {
  const result = applyEdit('hello', { from: 0, to: 5 }, 'table');
  assert.equal(
    result.nextText,
    '| Column 1 | Column 2 |\n| --- | --- |\n| hello | Value |',
  );
});

test('inserts a horizontal rule with block spacing', () => {
  const result = applyEdit('alpha\nbeta', { from: 5, to: 5 }, 'horizontal-rule');
  assert.equal(result.nextText, 'alpha\n---\nbeta');
  assert.deepEqual(result.selection, { anchor: 10, head: 10 });
});
