export const LARGE_DOCUMENT_CHAR_THRESHOLD = 150000;
export const LARGE_DOCUMENT_MERMAID_THRESHOLD = 20;
export const LARGE_DOCUMENT_EXCALIDRAW_THRESHOLD = 8;
export const LARGE_DOCUMENT_PLANTUML_THRESHOLD = 12;

function countMatches(source, pattern) {
  return source.match(pattern)?.length ?? 0;
}

export function analyzeMarkdownComplexity(markdownText = '') {
  const source = String(markdownText);
  const mermaidEmbeds = countMatches(source, /!\[\[[^\]]+\.(?:mmd|mermaid)(?:\|[^\]]+)?\]\]/gi);
  const plantUmlFences = countMatches(source, /(^|\n)```(?:plantuml|puml)\b/gi);
  const plantUmlEmbeds = countMatches(source, /!\[\[[^\]]+\.(?:puml|plantuml)(?:\|[^\]]+)?\]\]/gi);

  return {
    chars: source.length,
    excalidrawEmbeds: countMatches(source, /!\[\[[^\]]+\.excalidraw(?:\|[^\]]+)?\]\]/gi),
    mermaidBlocks: countMatches(source, /(^|\n)```mermaid\b/gi) + mermaidEmbeds,
    plantumlBlocks: plantUmlFences + plantUmlEmbeds,
  };
}

export function isLargeDocumentStats(stats) {
  return Boolean(
    stats
    && (
      stats.chars >= LARGE_DOCUMENT_CHAR_THRESHOLD
      || stats.mermaidBlocks >= LARGE_DOCUMENT_MERMAID_THRESHOLD
      || stats.excalidrawEmbeds >= LARGE_DOCUMENT_EXCALIDRAW_THRESHOLD
      || stats.plantumlBlocks >= LARGE_DOCUMENT_PLANTUML_THRESHOLD
    )
  );
}

export function getRenderProfile(markdownText = '') {
  const source = String(markdownText);
  const hasMermaid = /(^|\n)```mermaid\b/i.test(source)
    || /!\[\[[^\]]+\.(?:mmd|mermaid)(?:\|[^\]]+)?\]\]/i.test(source);
  const hasExcalidrawEmbed = /!\[\[[^\]]+\.excalidraw(?:\|[^\]]+)?\]\]/i.test(source);
  const hasPlantUml = /(^|\n)```(?:plantuml|puml)\b/i.test(source)
    || /!\[\[[^\]]+\.(?:puml|plantuml)(?:\|[^\]]+)?\]\]/i.test(source);
  const isLargeByLength = source.length >= LARGE_DOCUMENT_CHAR_THRESHOLD;

  if (isLargeByLength) {
    return {
      debounceMs: 500,
      deferUntilIdle: true,
    };
  }

  if (hasMermaid || hasExcalidrawEmbed || hasPlantUml) {
    return {
      debounceMs: 0,
      deferUntilIdle: false,
    };
  }

  return {
    debounceMs: 100,
    deferUntilIdle: false,
  };
}
