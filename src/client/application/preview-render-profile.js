export const LARGE_DOCUMENT_CHAR_THRESHOLD = 150000;
export const LARGE_DOCUMENT_MERMAID_THRESHOLD = 20;
export const LARGE_DOCUMENT_EXCALIDRAW_THRESHOLD = 8;
export const LARGE_DOCUMENT_DRAWIO_THRESHOLD = 8;
export const LARGE_DOCUMENT_PLANTUML_THRESHOLD = 12;
export const DIAGRAM_RENDER_DEBOUNCE_MS = 300;
export const DEFAULT_RENDER_DEBOUNCE_MS = 250;

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
    drawioEmbeds: countMatches(source, /!\[\[[^\]]+\.drawio(?:\|[^\]]+)?\]\]/gi),
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
      || stats.drawioEmbeds >= LARGE_DOCUMENT_DRAWIO_THRESHOLD
      || stats.excalidrawEmbeds >= LARGE_DOCUMENT_EXCALIDRAW_THRESHOLD
      || stats.plantumlBlocks >= LARGE_DOCUMENT_PLANTUML_THRESHOLD
    )
  );
}

export function getRenderProfile(markdownText = '') {
  // Reuse the single complexity scan instead of re-running the same regexes:
  // this previously cost ~10 full-source scans per keystroke.
  const stats = analyzeMarkdownComplexity(markdownText);

  if (stats.chars >= LARGE_DOCUMENT_CHAR_THRESHOLD) {
    return {
      debounceMs: 500,
      deferUntilIdle: true,
    };
  }

  if (stats.mermaidBlocks > 0 || stats.plantumlBlocks > 0) {
    return {
      debounceMs: DIAGRAM_RENDER_DEBOUNCE_MS,
      deferUntilIdle: false,
    };
  }

  if (stats.drawioEmbeds > 0 || stats.excalidrawEmbeds > 0) {
    return {
      debounceMs: 0,
      deferUntilIdle: false,
    };
  }

  return {
    debounceMs: DEFAULT_RENDER_DEBOUNCE_MS,
    deferUntilIdle: false,
  };
}
