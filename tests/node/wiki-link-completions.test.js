import test from 'node:test';
import assert from 'node:assert/strict';

import { CompletionContext } from '@codemirror/autocomplete';
import { EditorState } from '@codemirror/state';

import { wikiLinkCompletions } from '../../src/client/domain/wiki-link-completions.js';
import { createFileSearchEntry, findFileSearchMatch } from '../../src/client/domain/file-search.js';
import { resolveWikiTargetPath } from '../../src/domain/wiki-link-resolver.js';

function completionContext(doc) {
  const state = EditorState.create({ doc });
  return new CompletionContext(state, state.doc.length, true);
}

function complete(doc, files) {
  return wikiLinkCompletions(() => files)(completionContext(doc));
}

test('wiki-link completions show the file name and parent path separately', () => {
  const result = complete('[[', ['Bookmarks/Obsidian Observer.md', 'README.md']);

  assert.deepEqual(
    result.options.map(({ label, displayLabel, detail }) => ({ label, displayLabel, detail })),
    [
      {
        label: 'Bookmarks/Obsidian Observer.md',
        displayLabel: 'Obsidian Observer.md',
        detail: 'Bookmarks',
      },
      { label: 'README.md', displayLabel: 'README.md', detail: undefined },
    ],
  );
});

test('wiki-link completions use quick switcher fuzzy matching and ranking', () => {
  const result = complete('[[ab', [
    'a/a/unrelated/deep/folder/b.md',
    `b/a/${'x'.repeat(100)}/b.md`,
    'z/a/b.md',
  ]);

  assert.deepEqual(result.options.map(({ label }) => label), [
    'z/a/b.md',
    'a/a/unrelated/deep/folder/b.md',
  ]);
});

test('wiki-link completions preserve non-Markdown file extensions', () => {
  const files = ['diagram.drawio', 'diagram.excalidraw'];
  const result = complete('[[diagram', files);

  assert.deepEqual(
    result.options.map(({ label, displayLabel }) => ({ label, displayLabel })),
    files.map((file) => ({ label: file, displayLabel: file })),
  );
  assert.deepEqual(
    result.options.map(({ label }) => resolveWikiTargetPath(label, files)),
    files,
  );
});

test('wiki-link completions retain the first 30 results in full relevance and stable tie order', () => {
  const files = [
    'a/Note.md', 'a/note.md', 'note.md', 'long/folder/Notebook.md', 'n/o/t/e.md',
    ...Array.from({ length: 80 }, (_, index) => `folder-${index % 7}/Note-${80 - index}.md`),
  ];

  for (const query of ['note', 'n t', '.md', 'folder', 'unmatched']) {
    const expected = files.map((filePath) => {
      const entry = createFileSearchEntry(filePath);
      return { entry, match: findFileSearchMatch(entry, query) };
    }).filter(({ match }) => match)
      .sort((left, right) => right.match.score - left.match.score
        || left.entry.lowerPath.localeCompare(right.entry.lowerPath))
      .slice(0, 30)
      .map(({ entry }) => entry.filePath);
    assert.deepEqual(complete(`[[${query}`, files)?.options.map(({ label }) => label) ?? [], expected);
  }

  assert.deepEqual(complete('[[', files).options.map(({ label }) => label), files.slice(0, 30));
});

test('wiki-link completions cache the corpus until the file list changes and skip it for empty queries', () => {
  let fileReads = 0;
  let files = new Proxy(Array.from({ length: 50 }, (_, index) => `Note-${index}.md`), {
    get(target, key, receiver) {
      if (typeof key === 'string' && /^\d+$/u.test(key)) {
        fileReads += 1;
      }
      return Reflect.get(target, key, receiver);
    },
  });
  const source = wikiLinkCompletions(() => files);
  source(completionContext('[['));
  assert.equal(fileReads, 30);
  source(completionContext('[[note'));
  assert.equal(fileReads, 80);
  source(completionContext('[[note-1'));
  assert.equal(fileReads, 80);

  files = ['Renamed.md', 'Added.md'];
  assert.deepEqual(source(completionContext('[[renamed')).options.map(({ label }) => label), ['Renamed.md']);
  assert.equal(source(completionContext('[[note')), null);
  files = ['Added.md'];
  assert.equal(source(completionContext('[[renamed')), null);
});

test('wiki-link completion insertion consumes an existing closing delimiter', () => {
  for (const doc of ['[[gui', '[[gui]]']) {
    let state = EditorState.create({ doc });
    const context = new CompletionContext(state, 5, true);
    const result = wikiLinkCompletions(() => ['docs/guide.md'])(context);
    const completion = result.options[0];
    completion.apply({
      state,
      dispatch(transaction) {
        state = state.update(transaction).state;
      },
    }, completion, result.from, context.pos);

    assert.equal(state.doc.toString(), '[[docs/guide.md]]');
    assert.equal(state.selection.main.head, state.doc.length);
  }
});
