import test from 'node:test';
import assert from 'node:assert/strict';

import {
  createWikiTargetIndex,
  resolveWikiTargetPath,
  resolveWikiTargetWithIndex,
} from '../../src/domain/wiki-link-resolver.js';

test('resolveWikiTargetPath matches exact paths and bare note names', () => {
  const files = [
    'README.md',
    'notes/daily.md',
    'projects/collabmd.md',
  ];

  assert.equal(resolveWikiTargetPath('README', files), 'README.md');
  assert.equal(resolveWikiTargetPath('notes/daily', files), 'notes/daily.md');
  assert.equal(resolveWikiTargetPath('collabmd', files), 'projects/collabmd.md');
});

test('resolveWikiTargetPath returns null for empty or missing targets', () => {
  const files = ['README.md'];

  assert.equal(resolveWikiTargetPath('', files), null);
  assert.equal(resolveWikiTargetPath('missing', files), null);
});

test('resolveWikiTargetWithIndex resolves without scanning file arrays', () => {
  const files = [
    'README.md',
    'notes/daily.md',
    'projects/collabmd.md',
  ];
  const index = createWikiTargetIndex(files);

  assert.equal(resolveWikiTargetWithIndex('README', index), 'README.md');
  assert.equal(resolveWikiTargetWithIndex('notes/daily', index), 'notes/daily.md');
  assert.equal(resolveWikiTargetWithIndex('collabmd', index), 'projects/collabmd.md');
});
