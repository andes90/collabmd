import { afterEach, describe, expect, it } from 'vitest';
import * as Y from 'yjs';

import { EditorViewAdapter } from '../../src/client/infrastructure/editor-view-adapter.js';

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe('EditorViewAdapter Vim mode', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('defaults to insert editing and enables Vim mode only when opted in', async () => {
    document.body.innerHTML = '<div id="editor"></div><span id="line-info"></span>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      lineInfoElement: document.getElementById('line-info'),
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({
      awareness: null,
      filePath: 'note.md',
      undoManager,
      ytext,
    });

    expect(adapter.isVimModeEnabled()).toBe(false);
    expect(document.querySelector('.cm-vimMode')).toBeNull();

    expect(adapter.setVimMode(true)).toBe(true);
    expect(adapter.isVimModeEnabled()).toBe(true);
    await expect.poll(
      () => document.querySelector('.cm-vimMode'),
      { timeout: 5000 },
    ).not.toBeNull();

    expect(adapter.setVimMode(false)).toBe(false);
    expect(adapter.isVimModeEnabled()).toBe(false);
    expect(document.querySelector('.cm-vimMode')).toBeNull();

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });
});

describe('EditorViewAdapter collaboration history', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('undoes only local edits through toolbar and keyboard commands', () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'light',
      lineInfoElement: null,
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });
    adapter.insertText('local');
    ydoc.transact(() => ytext.insert(ytext.length, '-remote'), { remote: true });

    expect(adapter.runEditorCommand('undo')).toBe(true);
    expect(adapter.getText()).toBe('-remote');
    expect(adapter.runEditorCommand('redo')).toBe(true);
    expect(adapter.getText()).toBe('local-remote');

    const modifier = /Mac|iPhone|iPad|iPod/.test(navigator.userAgent)
      ? { metaKey: true }
      : { ctrlKey: true };
    adapter.editorView.contentDOM.dispatchEvent(new KeyboardEvent('keydown', {
      ...modifier,
      bubbles: true,
      key: 'z',
    }));
    expect(adapter.getText()).toBe('-remote');

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });

  it('applies exact text replacements as one undoable collaborative edit', () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'light',
      lineInfoElement: null,
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, '# Title\n\nHello world\n');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });

    expect(adapter.applyTextReplacements([
      { newText: '# Updated', oldText: '# Title' },
      { newText: 'Hello agent', oldText: 'Hello world' },
    ])).toBe(2);
    expect(adapter.getText()).toBe('# Updated\n\nHello agent\n');
    expect(adapter.runEditorCommand('undo')).toBe(true);
    expect(adapter.getText()).toBe('# Title\n\nHello world\n');
    expect(() => adapter.applyTextReplacements([
      { newText: 'Greeting', oldText: 'Hello' },
      { newText: 'Message', oldText: 'Hello world' },
    ])).toThrow(/overlap/);
    adapter.replaceText('aaa');
    expect(() => adapter.applyTextReplacements([
      { newText: 'b', oldText: 'aa' },
    ])).toThrow(/not unique/);

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });
});

describe('EditorViewAdapter document formatting', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('formats the shared document as one undoable edit', async () => {
    document.body.innerHTML = '<div id="editor"></div>';
    const adapter = new EditorViewAdapter({
      editorContainer: document.getElementById('editor'),
      initialTheme: 'light',
      lineInfoElement: null,
    });
    const ydoc = new Y.Doc();
    const ytext = ydoc.getText('codemirror');
    ytext.insert(0, '# Title\n\ntext   here');
    const undoManager = new Y.UndoManager(ytext);

    adapter.initialize({ awareness: null, filePath: 'README.md', undoManager, ytext });

    expect(await adapter.formatDocument('README.md')).toBe('formatted');
    expect(adapter.getText()).toBe('# Title\n\ntext here\n');
    expect(adapter.runEditorCommand('undo')).toBe(true);
    expect(adapter.getText()).toBe('# Title\n\ntext   here');

    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
  });
});

describe('EditorViewAdapter search', () => {
  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('reveals the first match while typing in find', async () => {
    document.body.innerHTML = `
      <style>
        #editor { height: 600px; overflow: hidden; }
        #editor .cm-editor { height: 100%; }
        #editor .cm-editor .cm-scroller { overflow: auto; }
      </style>
      <div id="editor"></div><span id="line-info"></span>
    `;
    const editorContainer = document.getElementById('editor');
    const adapter = new EditorViewAdapter({
      editorContainer,
      initialTheme: 'dark',
      lineInfoElement: document.getElementById('line-info'),
      lineWrappingEnabled: false,
    });

    const targetLineIndex = 299;
    const lines = Array.from({ length: 400 }, (_, index) => (
      index === targetLineIndex ? 'needle in a long PlantUML document' : `note over Foo: Filler line ${index + 1}`
    ));
    adapter.initializeProvisional({
      content: ['@startuml', ...lines, '@enduml'].join('\n'),
      filePath: 'diagram.puml',
    });
    await nextFrame();

    const scroller = adapter.getScrollContainer();
    adapter.runEditorCommand('openSearch');
    await nextFrame();

    const input = document.querySelector('.cm-search .cm-textfield');
    input.value = 'needle';
    input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'e' }));
    await new Promise((resolve) => setTimeout(resolve, 100));

    const selection = adapter.getState().selection.main;
    expect(adapter.getState().sliceDoc(selection.from, selection.to)).toBe('needle');
    expect(scroller.scrollTop).toBeGreaterThan(4000);
    adapter.destroy();
  });
});
