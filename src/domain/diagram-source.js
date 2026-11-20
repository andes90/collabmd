import { getVaultFileKind } from './file-kind.js';
import { extractYamlFrontmatter } from './yaml-frontmatter.js';

const FENCE_OPEN_PATTERN = /^ {0,3}(`{3,}|~{3,})(.*)$/u;
const FENCE_CLOSE_PATTERN = /^ {0,3}(`{3,}|~{3,})[ \t]*$/u;

export function listRenderableDiagrams(content = '', path = '', { contentStartLine = 1 } = {}) {
  const kind = getVaultFileKind(path);
  const lines = String(content).split(/\r?\n/u);
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
  let fence = null;
  const firstBodyLine = extractYamlFrontmatter(content)?.endLine ?? 0;
  for (let index = firstBodyLine; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      const closing = line.match(FENCE_CLOSE_PATTERN)?.[1];
      if (!closing || closing[0] !== fence.marker[0] || closing.length < fence.marker.length) continue;
      if (fence.kind) {
        diagrams.push({
          endLine: contentStartLine + index,
          kind: fence.kind,
          source: lines.slice(fence.index + 1, index).join('\n'),
          startLine: contentStartLine + fence.index,
        });
      }
      fence = null;
      continue;
    }

    const match = line.match(FENCE_OPEN_PATTERN);
    if (!match) continue;
    const [, marker, info] = match;
    if (marker[0] === '`' && info.includes('`')) continue;
    const language = info.trim().toLowerCase();
    const diagramKind = language === 'puml' ? 'plantuml' : language;
    fence = { index, kind: ['mermaid', 'plantuml'].includes(diagramKind) ? diagramKind : null, marker };
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
