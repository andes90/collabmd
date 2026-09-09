import { expect, it } from 'vitest';
import * as Y from 'yjs';

import '../../src/client/styles/style.css';
import { EditorViewAdapter } from '../../src/client/infrastructure/editor-view-adapter.js';
import sample from '../../test-vault/sample-full.md?raw';

it.each(['provisional', 'collaborative'])('keeps diagram syntax colored while scrolling a %s editor', async (mode) => {
  const host = document.createElement('div');
  host.className = 'editor-container';
  host.style.cssText = 'width:540px;height:700px';
  document.body.append(host);
  const adapter = new EditorViewAdapter({ editorContainer: host, initialTheme: 'dark' });
  const ydoc = new Y.Doc();
  const ytext = ydoc.getText('codemirror');
  ytext.insert(0, sample);
  const undoManager = new Y.UndoManager(ytext);

  try {
    if (mode === 'provisional') {
      adapter.initializeProvisional({ content: sample, filePath: 'sample-full.md' });
    } else {
      adapter.initialize({ awareness: null, filePath: 'sample-full.md', undoManager, ytext });
    }
    await document.fonts.ready;
    const scroller = adapter.getScrollContainer();
    const uncoloredLines = new Set();
    let diagramLinesSeen = 0;

    for (let frame = 0; frame < 300; frame += 1) {
      scroller.scrollTop += 16;
      await new Promise(requestAnimationFrame);
      const bounds = scroller.getBoundingClientRect();
      for (const line of host.querySelectorAll('.cm-line')) {
        const rect = line.getBoundingClientRect();
        if (rect.bottom < bounds.top || rect.top > bounds.bottom) continue;
        if (!line.textContent.includes('-->') && !line.textContent.includes('->>')) continue;
        diagramLinesSeen += 1;
        if (!line.querySelector('span')) uncoloredLines.add(line.textContent);
      }
    }

    expect(diagramLinesSeen).toBeGreaterThan(0);
    expect([...uncoloredLines]).toEqual([]);
    expect(adapter.editorView.state.doc.toString()).toBe(sample);
    expect(ytext.toString()).toBe(sample);
  } finally {
    adapter.destroy();
    undoManager.destroy();
    ydoc.destroy();
    host.remove();
  }
});
