import { afterEach, expect, it } from 'vitest';
import mermaid from 'mermaid';

import { MermaidPreviewHydrator } from '../../src/client/application/mermaid-preview-hydrator.js';
import { DiagramChrome } from '../../src/client/application/diagram-chrome.js';
import { renderMermaidExportSvgMarkup } from '../../src/client/application/diagram-preview-export.js';
import { resolveExportAssets } from '../../src/client/export/export-pipeline.js';

const source = [
  'sequenceDiagram',
  'autonumber',
  'actor Mobile as <br/>Mobile',
  'participant LoanApp as <br/>LoanApp',
  'Mobile->>LoanApp: <br/>Prepare<br/>;LoanApp->>Mobile: <br/>Done<br/>;',
  'Note right of LoanApp: TBA<br/><br/>Callback from Loan application<br/>if the process is already done',
].join('\n');

const structuredAliasSource = [
  'sequenceDiagram',
  'participant A@{ "type": "database", "alias": "<br/>Alice<br/><br/>" }',
  'actor B@{',
  'type: boundary',
  'alias: "<br/>Bob<br/>"',
  '}',
  'A->>B: Hi',
].join('\n');

const renderCases = [
  { name: 'sequence blank lines', source, expectedLabel: 'Callback from Loan application', sequence: true },
  { name: 'structured aliases', source: structuredAliasSource, expectedLabel: 'Alice', sequence: true },
  {
    name: 'flowchart labels containing sequenceDiagram',
    source: 'flowchart TD\nA["First\nsequenceDiagram\n<br/><br/>Last"] --> B',
    expectedLabel: 'Last',
    sequence: false,
  },
];

afterEach(() => {
  document.body.innerHTML = '';
});

it.each(renderCases)('renders $name in previews and exports while retaining the original source', async ({ source, expectedLabel, sequence }) => {
  const previewElement = document.createElement('div');
  const shell = document.createElement('div');
  shell.className = 'mermaid-shell';
  shell.dataset.mermaidKey = 'sequence';
  const sourceNode = document.createElement('pre');
  sourceNode.className = 'mermaid-source';
  sourceNode.hidden = true;
  sourceNode.textContent = source;
  shell.append(sourceNode);
  previewElement.append(shell);
  document.body.append(previewElement);
  const diagramChrome = new DiagramChrome();
  const hydrator = new MermaidPreviewHydrator({
    diagramChrome,
    onPreviewLayoutChange() {},
    previewElement,
  });

  try {
    hydrator.configureMermaid(mermaid);
    await hydrator.hydrateShell(shell, mermaid);
    const svg = shell.querySelector('.mermaid-frame svg');
    expect(svg).not.toBeNull();
    expect(svg.textContent).toContain(expectedLabel);
    expect(shell.querySelector('.diagram-preview-error-card')).toBeNull();
    expect(shell.dataset.mermaidHydrated).toBe('true');
    expect(sourceNode.textContent).toBe(source);
    expect(shell._diagramRenderedSource).toBe(source);
    if (sequence) {
      const noteLines = Array.from(svg.querySelectorAll('text')).map((node) => node.textContent);
      expect(noteLines).toContain('\u00a0');
    } else {
      expect(svg.textContent).not.toContain('&nbsp;');
    }

    const markup = await renderMermaidExportSvgMarkup(mermaid, source);
    expect(markup).toContain(expectedLabel);
    expect(markup).toContain('<svg');
    expect(markup).not.toContain('foreignObject');

    const snapshot = { assets: {}, warnings: [] };
    await resolveExportAssets(snapshot, { container: previewElement });
    expect(snapshot.warnings).toEqual([]);
    expect(previewElement.querySelector('.export-diagram svg').textContent).toContain(expectedLabel);
  } finally {
    hydrator.destroy();
    diagramChrome.destroy();
  }
});
