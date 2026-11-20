import test from 'node:test';
import assert from 'node:assert/strict';

import { ensureSyntaxTree } from '@codemirror/language';
import { EditorState } from '@codemirror/state';

import {
  createLanguageExtension,
  EditorViewAdapter,
} from '../../src/client/infrastructure/editor-view-adapter.js';

function collectSyntaxNodeNames(state) {
  const names = [];
  ensureSyntaxTree(state, state.doc.length, 1000).iterate({
    enter(node) {
      names.push(node.name);
    },
  });
  return names;
}

function getInnerSyntaxNodeNameAt(state, searchText) {
  const tree = ensureSyntaxTree(state, state.doc.length, 1000);
  const position = state.doc.toString().indexOf(searchText);
  assert.notEqual(position, -1, `expected to find "${searchText}" in document`);
  return tree.resolveInner(position, 1).name;
}

test('createLanguageExtension uses YAML syntax for base files', () => {
  const state = EditorState.create({
    doc: 'views:\n  - type: table\n',
    extensions: [createLanguageExtension('views/tasks.base')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('BlockMapping'));
  assert.ok(nodeNames.includes('BlockSequence'));
  assert.ok(!nodeNames.includes('Paragraph'));
});

test('createLanguageExtension keeps Markdown syntax for markdown files', () => {
  const state = EditorState.create({
    doc: 'views:\n  - type: table\n',
    extensions: [createLanguageExtension('README.md')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('Paragraph'));
  assert.ok(!nodeNames.includes('BlockMapping'));
});

test('createLanguageExtension uses HTML and embedded CSS syntax for HTML files', () => {
  const state = EditorState.create({
    doc: '<!doctype html><style>body { color: red; }</style><h1>Hello</h1>',
    extensions: [createLanguageExtension('reports/status.html')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('DoctypeDecl'));
  assert.ok(nodeNames.includes('Element'));
  assert.ok(nodeNames.includes('StyleSheet'));
  assert.ok(!nodeNames.includes('Paragraph'));
});

test('wiki-link completions preserve language completion sources', () => {
  const adapter = new EditorViewAdapter({
    editorContainer: null,
    getFileList: () => ['README.md'],
    initialTheme: 'light',
    lineInfoElement: null,
  });
  const state = EditorState.create({
    doc: '<div>[[',
    extensions: adapter.getBaseExtensions('index.html', { readOnly: true }),
  });

  assert.ok(state.languageDataAt('autocomplete', state.doc.length).length >= 2);
});

test('createLanguageExtension uses Mermaid syntax for .mmd files', () => {
  const state = EditorState.create({
    doc: 'flowchart TD\n  A[Start] --> B{Done?}\n  %% comment\n',
    extensions: [createLanguageExtension('diagrams/flow.mmd')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('meta'));
  assert.ok(nodeNames.includes('atom'));
  assert.ok(nodeNames.includes('operator'));
  assert.ok(nodeNames.includes('comment'));
  assert.ok(!nodeNames.includes('Paragraph'));
});

test('createLanguageExtension uses Mermaid syntax for .mermaid files', () => {
  const state = EditorState.create({
    doc: 'sequenceDiagram\n  participant Alice\n  Alice->>Bob: Hello\n',
    extensions: [createLanguageExtension('diagrams/sequence.mermaid')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('meta'));
  assert.ok(nodeNames.includes('keyword'));
  assert.ok(nodeNames.includes('operator'));
  assert.ok(!nodeNames.includes('Paragraph'));
});

test('createLanguageExtension highlights Mermaid fenced blocks inside Markdown', () => {
  const state = EditorState.create({
    doc: [
      '# Diagram',
      '',
      '```mermaid',
      'flowchart LR',
      '  A --> B',
      '```',
    ].join('\n'),
    extensions: [createLanguageExtension('README.md')],
  });

  const nodeNames = collectSyntaxNodeNames(state);

  assert.ok(nodeNames.includes('ATXHeading1'));
  assert.ok(nodeNames.includes('FencedCode'));
  assert.equal(getInnerSyntaxNodeNameAt(state, 'flowchart'), 'meta');
  assert.equal(getInnerSyntaxNodeNameAt(state, '-->'), 'operator');
});

test('EditorViewAdapter cancels queued view work before destroying its editor', (t) => {
  const adapter = new EditorViewAdapter({ editorContainer: null });
  const previousRequest = globalThis.requestAnimationFrame;
  const previousCancel = globalThis.cancelAnimationFrame;
  t.after(() => {
    globalThis.requestAnimationFrame = previousRequest;
    globalThis.cancelAnimationFrame = previousCancel;
  });
  const cancelled = [];
  let nextFrame = 0;
  globalThis.requestAnimationFrame = () => ++nextFrame;
  globalThis.cancelAnimationFrame = (id) => cancelled.push(id);
  adapter.scheduleFrame('search-reveal', () => {});
  adapter.scheduleFrame('mount-scroll', () => {});
  adapter.editorView = { destroy: () => assert.deepEqual(cancelled, [1, 2]) };

  adapter.teardownEditorView();
  assert.equal(adapter.pendingFrames.size, 0);
  assert.equal(adapter.editorView, null);
});
