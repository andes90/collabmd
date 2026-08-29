import { getVaultFileKind } from './file-kind.js';

const FENCE_OPEN_PATTERN = /^\s*(`{3,})(mermaid|plantuml|puml)\s*$/iu;

export function listRenderableDiagrams(content = '', path = '', { contentStartLine = 1 } = {}) {
  const kind = getVaultFileKind(path);
  const lines = String(content).split('\n');
  if (kind === 'mermaid' || kind === 'plantuml') {
    return [{
      endLine: contentStartLine + Math.max(lines.length - 1, 0),
      kind,
      source: String(content),
      startLine: contentStartLine,
    }];
  }
  if (kind !== 'markdown') return [];

  const diagrams = [];
  for (let index = 0; index < lines.length; index += 1) {
    const match = lines[index].match(FENCE_OPEN_PATTERN);
    if (!match) continue;

    const fence = match[1];
    const diagramKind = match[2].toLowerCase() === 'mermaid' ? 'mermaid' : 'plantuml';
    const sourceStart = index + 1;
    let end = sourceStart;
    while (end < lines.length && lines[end].trim() !== fence) {
      end += 1;
    }
    if (end >= lines.length) continue;

    diagrams.push({
      endLine: contentStartLine + end,
      kind: diagramKind,
      source: lines.slice(sourceStart, end).join('\n'),
      startLine: contentStartLine + index,
    });
    index = end;
  }
  return diagrams;
}

export function resolveRenderableDiagram(content = '', path = '', options = {}) {
  const diagrams = listRenderableDiagrams(content, path, options);
  const requestedStartLine = Number.parseInt(options.startLine, 10);
  if (Number.isInteger(requestedStartLine)) {
    return diagrams.find(({ startLine }) => startLine === requestedStartLine) ?? null;
  }
  return diagrams.length === 1 ? diagrams[0] : null;
}
