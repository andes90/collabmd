import { afterEach, expect, it, vi } from 'vitest';
import mermaid from 'mermaid';
import { DiagramChrome } from '../../src/client/application/diagram-chrome.js';
import { MermaidPreviewHydrator } from '../../src/client/application/mermaid-preview-hydrator.js';
import { CanvasEditorView } from '../../src/client/presentation/canvas-editor-view.js';

afterEach(() => {
  vi.restoreAllMocks();
  document.body.replaceChildren();
  document.body.className = '';
});

it('renders simultaneous card diagrams independently even within the same millisecond', async () => {
  const renderers = ['Alpha --> First', 'Beta --> Second'].map((source) => {
    const previewElement = document.createElement('div');
    const shell = document.createElement('div');
    shell.className = 'mermaid-shell';
    shell.dataset.mermaidKey = 'diagram';
    const sourceNode = document.createElement('pre');
    sourceNode.className = 'mermaid-source';
    sourceNode.hidden = true;
    sourceNode.textContent = `flowchart TD\n${source}`;
    shell.append(sourceNode);
    previewElement.append(shell);
    document.body.append(previewElement);
    const chrome = new DiagramChrome();
    const hydrator = new MermaidPreviewHydrator({ previewElement, diagramChrome: chrome });
    return { chrome, hydrator, shell };
  });
  renderers[0].hydrator.configureMermaid(mermaid);
  vi.spyOn(Date, 'now').mockReturnValue(1790000000000);
  try {
    await Promise.all(renderers.map(({ hydrator, shell }) => hydrator.hydrateShell(shell, mermaid)));
    const first = renderers[0].shell.querySelector('.mermaid-frame svg');
    const second = renderers[1].shell.querySelector('.mermaid-frame svg');
    expect(first.textContent).toContain('Alpha');
    expect(first.textContent).not.toContain('Beta');
    expect(second.textContent).toContain('Beta');
    expect(second.textContent).not.toContain('Alpha');
    expect(first.id).not.toBe(second.id);
  } finally {
    renderers.forEach(({ hydrator, chrome }) => { hydrator.destroy(); chrome.destroy(); });
  }
});

it('ignores a delayed file preview after switching A to B to A', async () => {
  const pendingReads = [];
  const context = {
    readFile: () => new Promise((resolve) => pendingReads.push(resolve)),
    onOpenFile() {},
    createMarkdownPreview: vi.fn(() => ({ destroy: vi.fn() })),
  };
  const entry = { card: document.createElement('article'), content: document.createElement('div'), title: document.createElement('span') };
  entry.card.append(entry.content);
  document.body.append(entry.card);
  const loads = ['A', 'B', 'A'].map((signature) => {
    entry.content.replaceChildren();
    entry.signature = signature;
    return CanvasEditorView.prototype.renderFile.call(context, entry, { file: `${signature}.md` }, signature);
  });
  pendingReads[2]({ content: '# Latest A' });
  await loads[2];
  const visiblePreview = entry.preview;
  expect(context.createMarkdownPreview.mock.calls[0][0].isConnected).toBe(true);
  pendingReads[0]({ content: '# Stale A' });
  pendingReads[1]({ content: '# Stale B' });
  await Promise.all(loads);
  expect(context.createMarkdownPreview).toHaveBeenCalledTimes(1);
  expect(entry.preview).toBe(visiblePreview);
});
