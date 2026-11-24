import test from 'node:test';
import assert from 'node:assert/strict';

import { parseStatusOutput, parseUnifiedDiff } from '../../src/server/infrastructure/git/parsers.js';
import { normalizeRelativeGitPath } from '../../src/server/infrastructure/git/path-utils.js';

test('normalizeRelativeGitPath preserves exact filenames and rejects traversal', () => {
  assert.equal(normalizeRelativeGitPath(' docs/guide.md '), ' docs/guide.md ');
  assert.equal(normalizeRelativeGitPath('"plan.md"'), '"plan.md"');
  assert.throws(
    () => normalizeRelativeGitPath('../secrets.txt'),
    /Invalid path parameter/,
  );
});

test('parseStatusOutput groups staged, working tree, and untracked files', () => {
  const output = [
    '## main...origin/main [ahead 1]',
    'A  staged.md',
    ' M tracked.md',
    'R  new -> name.md',
    'old name.md',
    '?? scratch\nnotes.md',
    '',
  ].join('\0');

  const parsed = parseStatusOutput(output);

  assert.equal(parsed.branch.name, 'main');
  assert.equal(parsed.branch.upstream, 'origin/main');
  assert.equal(parsed.branch.ahead, 1);
  assert.deepEqual(
    parsed.sections.staged.map((file) => ({ oldPath: file.oldPath, path: file.path, status: file.status })),
    [
      { oldPath: null, path: 'staged.md', status: 'added' },
      { oldPath: 'old name.md', path: 'new -> name.md', status: 'renamed' },
    ],
  );
  assert.deepEqual(
    parsed.sections['working-tree'].map((file) => ({ path: file.path, status: file.status })),
    [
      { path: 'tracked.md', status: 'modified' },
    ],
  );
  assert.deepEqual(
    parsed.sections.untracked.map((file) => ({ path: file.path, status: file.status })),
    [
      { path: 'scratch\nnotes.md', status: 'untracked' },
    ],
  );
});

test('parseUnifiedDiff preserves rename metadata and hunk line numbers', () => {
  const diffText = [
    'diff --git a/old.md b/new.md',
    'similarity index 90%',
    'rename from old.md',
    'rename to new.md',
    '--- a/old.md',
    '+++ b/new.md',
    '@@ -1,2 +1,2 @@ Heading',
    ' line 1',
    '-line 2',
    '+line 2 updated',
  ].join('\n');

  const [file] = parseUnifiedDiff(diffText);

  assert.equal(file.status, 'renamed');
  assert.equal(file.oldPath, 'old.md');
  assert.equal(file.path, 'new.md');
  assert.equal(file.stats.deletions, 1);
  assert.equal(file.stats.additions, 1);
  assert.deepEqual(
    file.hunks[0].lines.map((line) => ({
      newLine: line.newLine,
      oldLine: line.oldLine,
      type: line.type,
    })),
    [
      { newLine: 1, oldLine: 1, type: 'context' },
      { newLine: null, oldLine: 2, type: 'deletion' },
      { newLine: 2, oldLine: null, type: 'addition' },
    ],
  );
});

test('parseUnifiedDiff preserves paths in binary, empty, and metadata-only patches', () => {
  const files = parseUnifiedDiff([
    'diff --git a/archive b/Meeting Notes.png b/archive b/Meeting Notes.png',
    'Binary files a/archive b/Meeting Notes.png and b/archive b/Meeting Notes.png differ',
    'diff --git a/Empty Note.md b/Empty Note.md',
    'new file mode 100644',
    'diff --git "a/Old \\303\\251.md" b/New Note.md',
    'similarity index 100%',
    'rename from "Old \\303\\251.md"',
    'rename to New Note.md',
    'diff --git a/Original Note.md "b/New \\303\\251.md"',
    'similarity index 100%',
    'copy from Original Note.md',
    'copy to "New \\303\\251.md"',
    'diff --git "a/Tab\\tName.md" "b/Tab\\tName.md"',
    'old mode 100644',
    'new mode 100755',
  ].join('\n'));

  assert.deepEqual(files.map(({ isBinary, oldPath, path, status }) => [path, oldPath, status, isBinary]), [
    ['archive b/Meeting Notes.png', null, 'modified', true],
    ['Empty Note.md', null, 'added', false],
    ['New Note.md', 'Old é.md', 'renamed', false],
    ['New é.md', 'Original Note.md', 'copied', false],
    ['Tab\tName.md', null, 'modified', false],
  ]);
});

test('parseUnifiedDiff consumes header-like content and keeps both no-newline notes', () => {
  const [file] = parseUnifiedDiff([
    'diff --git a/Meeting Notes.md b/Meeting Notes.md',
    '--- a/Meeting Notes.md\t',
    '+++ b/Meeting Notes.md\t',
    '@@ -3,2 +3,2 @@',
    ' rename from an older section',
    '--- comment',
    '\\ No newline at end of file',
    '+++ counter',
    '\\ No newline at end of file',
    '@@ -8,0 +9 @@',
    '+rename from the new section',
  ].join('\n'));

  assert.equal(file.path, 'Meeting Notes.md');
  assert.equal(file.oldPath, null);
  assert.equal(file.status, 'modified');
  assert.deepEqual(file.stats, { additions: 2, deletions: 1 });
  assert.deepEqual(file.hunks.flatMap((hunk) => hunk.lines), [
    { content: 'rename from an older section', newLine: 3, oldLine: 3, type: 'context' },
    { content: '-- comment', newLine: null, oldLine: 4, type: 'deletion' },
    { content: '\\ No newline at end of file', newLine: null, oldLine: null, type: 'note' },
    { content: '++ counter', newLine: 4, oldLine: null, type: 'addition' },
    { content: '\\ No newline at end of file', newLine: null, oldLine: null, type: 'note' },
    { content: 'rename from the new section', newLine: 9, oldLine: null, type: 'addition' },
  ]);
});
