import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  exportSvgMarkupFromElement,
  exportTrimmedSvgMarkupFromElement,
  rasterizeSvgMarkupToPngBlob,
  renderMermaidExportSvgMarkup,
} from '../../src/client/application/diagram-preview-export.js';
import { renderWebMcpDiagram } from '../../src/client/application/webmcp-diagram-renderer.js';
import { downloadBlob } from '../../src/client/browser-utils.js';

describe('diagram preview export helpers', () => {
  afterEach(() => {
    document.body.innerHTML = '';
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('sanitizes exported SVG markup', () => {
    const shell = document.createElement('div');
    shell.innerHTML = [
      '<svg xmlns="http://www.w3.org/2000/svg" onload="window.__xss = true" viewBox="0 0 120 80" width="120" height="80" style="display:block;width:240px;height:160px">',
      '  <script>alert(1)</script>',
      '  <foreignObject><div>bad</div></foreignObject>',
      '  <!--plantuml-src bad--metadata-->',
      '  <text x="4" y="16">A&nbsp;B</text>',
      '  <rect width="120" height="80" fill="#fff" />',
      '</svg>',
    ].join('');

    const svg = shell.querySelector('svg');
    expect(svg).not.toBeNull();

    const markup = exportSvgMarkupFromElement(svg);
    expect(markup).not.toContain('onload=');
    expect(markup).not.toContain('<script');
    expect(markup).not.toContain('<foreignObject');
    expect(markup).not.toContain('plantuml-src');
    expect(markup).not.toContain('&nbsp;');
    expect(markup).not.toContain('width:240px');
    expect(markup).toContain('<text');
    expect(markup).toContain('<rect');
  });

  it('rasterizes exported SVG markup into a PNG blob', async () => {
    const svgMarkup = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="120" height="80"><rect width="120" height="80" fill="#ffffff"/><circle cx="40" cy="40" r="16" fill="#111827"/></svg>';
    const blob = await rasterizeSvgMarkupToPngBlob(svgMarkup);

    expect(blob).toBeInstanceOf(Blob);
    expect(blob.type).toBe('image/png');
    expect(blob.size).toBeGreaterThan(0);
  });

  it('trims exported SVG markup to rendered content bounds', () => {
    const shell = document.createElement('div');
    shell.innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 600" width="800" height="600"><text x="100" y="80">Label</text></svg>';
    const svg = shell.querySelector('svg');
    svg.getBBox = () => ({
      height: 40,
      width: 120,
      x: 96,
      y: 52,
    });

    const markup = exportTrimmedSvgMarkupFromElement(svg, { padding: 24 });

    expect(markup).toContain('viewBox="72 28 168 88"');
    expect(markup).toContain('width="168"');
    expect(markup).toContain('height="88"');
  });

  it('renders Mermaid exports with light SVG text labels', async () => {
    const initialize = vi.fn();
    const run = vi.fn(async ({ nodes }) => {
      const node = nodes[0];
      expect(node.textContent).toContain('"htmlLabels":false');
      node.innerHTML = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="120" height="80">',
        '  <style>.label{fill:#111827}</style>',
        '  <rect width="120" height="80" fill="#fff"></rect>',
        '  <text class="label" x="8" y="24">Visible label</text>',
        '</svg>',
      ].join('');
    });

    const markup = await renderMermaidExportSvgMarkup({ initialize, run }, 'flowchart TD\n  A[Visible label] --> B');

    expect(initialize).toHaveBeenCalledWith(expect.objectContaining({
      htmlLabels: false,
      startOnLoad: false,
      theme: 'default',
    }));
    expect(markup).toContain('Visible label');
    expect(markup).toContain('<text');
    expect(markup).not.toContain('foreignObject');
  });
  it('renders Mermaid WebMCP results in the active browser', async () => {
    const callTool = vi.fn(async (name) => {
      expect(name).toBe('read_document');
      return {
        content: 'flowchart LR\nA-->B\n',
        endLine: 3,
        kind: 'mermaid',
        path: 'flow.mmd',
        revision: 'a'.repeat(64),
        startLine: 1,
        truncated: false,
      };
    });
    const result = await renderWebMcpDiagram({
      format: 'svg',
      path: 'flow.mmd',
    }, {
      callTool,
      getMermaid: async () => ({
        initialize: vi.fn(),
        run: async ({ nodes }) => {
          nodes[0].innerHTML = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10" width="10" height="10"><path d="M0 0L10 10"/></svg>';
        },
      }),
    });

    expect(result.renderer).toBe('mermaid-browser');
    expect(result.mimeType).toBe('image/svg+xml');
    expect(atob(result.image.data)).toContain('<svg');
  });


  it('overrides existing Mermaid init directives for export safety', async () => {
    const initialize = vi.fn();
    const run = vi.fn(async ({ nodes }) => {
      const node = nodes[0];
      expect(node.textContent).toContain('"theme":"default"');
      expect(node.textContent).toContain('"htmlLabels":false');
      expect(node.textContent).not.toContain('"theme":"dark"');
      expect(node.textContent).not.toContain('"htmlLabels":true');
      node.innerHTML = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 120 80" width="120" height="80">',
        '  <text x="8" y="24">Forced SVG label</text>',
        '</svg>',
      ].join('');
    });

    const markup = await renderMermaidExportSvgMarkup({ initialize, run }, [
      '%%{init: {"theme":"dark","htmlLabels":true,"flowchart":{"htmlLabels":true}}}%%',
      'flowchart TD',
      '  A[Forced SVG label] --> B',
    ].join('\n'));

    expect(markup).toContain('Forced SVG label');
    expect(markup).not.toContain('foreignObject');
  });

  it('keeps blob download URLs alive until delayed cleanup', () => {
    vi.useFakeTimers();
    const clickSpy = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => {});
    const createObjectUrlSpy = vi.spyOn(URL, 'createObjectURL').mockReturnValue('blob:diagram-export');
    const revokeObjectUrlSpy = vi.spyOn(URL, 'revokeObjectURL').mockImplementation(() => {});

    downloadBlob(new Blob(['<svg></svg>'], { type: 'image/svg+xml' }), 'diagram.svg');

    const anchor = document.body.querySelector('a[download="diagram.svg"]');
    expect(anchor).not.toBeNull();
    expect(anchor.href).toBe('blob:diagram-export');
    expect(anchor.style.display).toBe('none');
    expect(clickSpy).toHaveBeenCalledTimes(1);
    expect(createObjectUrlSpy).toHaveBeenCalledTimes(1);
    expect(revokeObjectUrlSpy).not.toHaveBeenCalled();

    vi.runOnlyPendingTimers();

    expect(document.body.querySelector('a[download="diagram.svg"]')).toBeNull();
    expect(revokeObjectUrlSpy).toHaveBeenCalledWith('blob:diagram-export');
  });
});
