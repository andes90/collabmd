import { resolveRenderableDiagram } from '../../domain/diagram-source.js';
import {
  rasterizeSvgMarkupToPngBlob,
  renderMermaidExportSvgMarkup,
} from './diagram-preview-export.js';

export async function renderWebMcpDiagram(input = {}, {
  callTool,
  getMermaid,
  signal,
} = {}) {
  const requestedStartLine = Number.parseInt(input.startLine, 10);
  const read = await callTool('read_document', {
    lineCount: 500,
    path: input.path,
    startLine: Number.isInteger(requestedStartLine) ? requestedStartLine : 1,
  }, { signal });
  const diagram = resolveRenderableDiagram(read.content, input.path, {
    contentStartLine: read.startLine,
    startLine: input.startLine,
  });
  if (!diagram || diagram.kind !== 'mermaid') {
    return callTool('render_diagram', input, { signal });
  }
  if (read.kind === 'mermaid' && read.truncated) {
    throw new Error('Mermaid source exceeds the WebMCP read limit');
  }

  const svg = await renderMermaidExportSvgMarkup(await getMermaid(), diagram.source);
  const format = input.format ?? 'png';
  const mimeType = format === 'svg' ? 'image/svg+xml' : 'image/png';
  const bytes = format === 'svg'
    ? new TextEncoder().encode(svg)
    : new Uint8Array(await (await rasterizeSvgMarkupToPngBlob(svg)).arrayBuffer());
  return {
    endLine: diagram.endLine,
    format,
    image: { data: bytes.toBase64(), encoding: 'base64', mimeType },
    kind: diagram.kind,
    mimeType,
    path: read.path,
    renderer: 'mermaid-browser',
    revision: read.revision,
    startLine: diagram.startLine,
    warnings: [],
  };
}
