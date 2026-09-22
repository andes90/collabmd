import test from 'node:test';
import assert from 'node:assert/strict';

import { FileTreeState } from '../../src/client/presentation/file-tree-state.js';

test('FileTreeState flattens tree nodes and filters search matches for files and folders', () => {
  const state = new FileTreeState();

  state.setTree([
    {
      children: [
        { name: 'README.md', path: 'docs/README.md', type: 'file' },
        { name: 'report.html', path: 'docs/report.html', type: 'html' },
        { name: 'architecture.drawio', path: 'docs/architecture.drawio', type: 'drawio' },
        { name: 'diagram.puml', path: 'docs/diagram.puml', type: 'plantuml' },
        { name: 'diagram.png', path: 'docs/diagram.png', type: 'image' },
        { name: 'guide.pdf', path: 'docs/guide.pdf', type: 'pdf' },
      ],
      name: 'docs',
      path: 'docs',
      type: 'directory',
    },
    { name: 'sketch.excalidraw', path: 'sketch.excalidraw', type: 'excalidraw' },
  ]);

  state.setSearchQuery('diag');

  assert.deepEqual(state.flatFiles, [
    'docs/README.md',
    'docs/report.html',
    'docs/architecture.drawio',
    'docs/diagram.puml',
    'docs/diagram.png',
    'docs/guide.pdf',
    'sketch.excalidraw',
  ]);
  assert.deepEqual(state.flatDocumentFiles, state.flatFiles.filter((path) => path !== 'docs/diagram.png'));
  assert.deepEqual(state.getSearchMatches(), [
    { name: 'diagram.puml', path: 'docs/diagram.puml', type: 'plantuml' },
    { name: 'diagram.png', path: 'docs/diagram.png', type: 'image' },
  ]);
});

test('FileTreeState preserves the typed query while matching case-insensitively', () => {
  const state = new FileTreeState();
  state.setTree([{ name: 'Guide.md', path: 'docs/Guide.md', type: 'file' }]);

  state.setSearchQuery('  GUIDE  ');

  assert.equal(state.searchQuery, '  GUIDE  ');
  assert.deepEqual(state.getSearchMatches(), [
    { name: 'Guide.md', path: 'docs/Guide.md', type: 'file' },
  ]);
});

test('FileTreeState search excludes directories and preserves descendant summaries', () => {
  const state = new FileTreeState();

  state.setTree([
    {
      children: [
        {
          children: [
            { name: 'guide.md', path: 'docs/guides/guide.md', type: 'file' },
          ],
          name: 'guides',
          path: 'docs/guides',
          type: 'directory',
        },
      ],
      name: 'docs',
      path: 'docs',
      type: 'directory',
    },
  ]);

  state.setSearchQuery('guide');

  assert.deepEqual(state.getSearchMatches(), [
    { name: 'guide.md', path: 'docs/guides/guide.md', type: 'file' },
  ]);
  assert.deepEqual(state.getDirectoryDescendantSummary('docs/guides'), {
    directoryCount: 0,
    fileCount: 1,
  });
});

test('FileTreeState preserves file modification times in flattened file entries', () => {
  const state = new FileTreeState();

  state.setTree([
    { mtimeMs: 42, name: 'notes.md', path: 'notes.md', type: 'file' },
  ]);

  assert.deepEqual(state.flatFileEntries, [
    { mtimeMs: 42, path: 'notes.md' },
  ]);
});

test('FileTreeState expands parent directories for active files', () => {
  const state = new FileTreeState();

  state.setActiveFile('notes/daily/today.md');

  assert.equal(state.activeFilePath, 'notes/daily/today.md');
  assert.deepEqual([...state.expandedDirs], ['notes', 'notes/daily']);
});

test('FileTreeState toggles directories and ignores invalid expansion paths', () => {
  const state = new FileTreeState();

  assert.equal(state.toggleDirectory('notes'), true);
  assert.equal(state.expandedDirs.has('notes'), true);
  assert.equal(state.toggleDirectory('notes'), false);
  assert.equal(state.expandedDirs.has('notes'), false);

  state.expandDirectoryPath('../escape');
  assert.deepEqual([...state.expandedDirs], []);
});

test('FileTreeState updates expanded directories for folder rename and delete', () => {
  const state = new FileTreeState();
  state.expandDirectoryPath('docs/guides/archive');

  state.replaceExpandedDirectoryPrefix('docs/guides', 'docs/reference');
  assert.deepEqual([...state.expandedDirs], ['docs', 'docs/reference', 'docs/reference/archive']);

  state.removeExpandedDirectoryPrefix('docs/reference');
  assert.deepEqual([...state.expandedDirs], ['docs']);
});

test('FileTreeState refreshes cached search fields when the tree changes', () => {
  const state = new FileTreeState();

  state.setTree([
    { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
  ]);
  state.setSearchQuery('guide');
  const documentFiles = state.flatDocumentFiles;
  assert.equal(state.flatDocumentFiles, documentFiles);
  assert.deepEqual(state.getSearchMatches(), [
    { name: 'guide.md', path: 'docs/guide.md', type: 'file' },
  ]);

  state.setTree([
    { name: 'reference.md', path: 'docs/reference.md', type: 'file' },
  ]);
  state.setSearchQuery('reference');
  assert.notEqual(state.flatDocumentFiles, documentFiles);
  assert.deepEqual(state.flatDocumentFiles, ['docs/reference.md']);
  assert.deepEqual(state.getSearchMatches(), [
    { name: 'reference.md', path: 'docs/reference.md', type: 'file' },
  ]);
});
