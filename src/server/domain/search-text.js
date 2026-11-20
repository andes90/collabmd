import { getVaultFileKind } from '../../domain/file-kind.js';
import { isWholeWordMatch } from '../../domain/literal-text-search.js';

export const DEFAULT_MAX_FILES = 50;
export const DEFAULT_MAX_SNIPPETS_PER_FILE = 5;
const SNIPPET_CONTEXT_CHARS = 90;

export function createEmptySearchResult({
  backend = 'ripgrep',
  query = '',
  searchAvailable = true,
  truncated = false,
} = {}) {
  return {
    backend,
    files: [],
    matchCount: 0,
    ok: true,
    query,
    search: {
      available: searchAvailable,
      backend,
    },
    truncated,
  };
}

function byteOffsetToStringIndex(value = '', byteOffset = 0) {
  const normalizedOffset = Math.max(0, Number(byteOffset) || 0);
  if (normalizedOffset === 0) {
    return 0;
  }

  const buffer = Buffer.from(String(value ?? ''), 'utf8');
  let end = Math.min(normalizedOffset, buffer.length);
  while (end > 0 && end < buffer.length && (buffer[end] & 0xc0) === 0x80) {
    end -= 1;
  }
  return buffer.subarray(0, end).toString('utf8').length;
}

function createSnippet(lineText = '', matchStart = 0, matchEnd = matchStart) {
  const normalizedLine = String(lineText ?? '').replace(/\r?\n$/u, '');
  const safeStart = Math.min(Math.max(Math.round(matchStart), 0), normalizedLine.length);
  const safeEnd = Math.min(Math.max(Math.round(matchEnd), safeStart), normalizedLine.length);
  const snippetStart = Math.max(0, safeStart - SNIPPET_CONTEXT_CHARS);
  const snippetEnd = Math.min(normalizedLine.length, safeEnd + SNIPPET_CONTEXT_CHARS);
  const prefix = snippetStart > 0 ? '...' : '';
  const suffix = snippetEnd < normalizedLine.length ? '...' : '';
  const text = `${prefix}${normalizedLine.slice(snippetStart, snippetEnd)}${suffix}`;
  const prefixLength = prefix.length;

  return {
    matchEnd: prefixLength + (safeEnd - snippetStart),
    matchStart: prefixLength + (safeStart - snippetStart),
    text,
  };
}

export function parseRipgrepJson(stdout, {
  excludedPaths = [],
  kinds = [],
  maxFiles = DEFAULT_MAX_FILES,
  maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
  prefix = '',
  query = '',
} = {}) {
  const excluded = new Set(excludedPaths);
  const kindFilter = new Set(Array.isArray(kinds) ? kinds : []);
  const files = [];
  const filesByPath = new Map();
  let matchCount = 0;
  let truncated = false;

  const lines = String(stdout ?? '').split(/\r?\n/u);
  for (const line of lines) {
    if (!line.trim()) {
      continue;
    }

    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }

    if (event?.type !== 'match') {
      continue;
    }

    const filePath = String(event?.data?.path?.text ?? '').replace(/^\.\//u, '');
    const kind = getVaultFileKind(filePath) ?? 'text';
    if (
      !filePath
      || excluded.has(filePath)
      || (prefix && filePath !== prefix && !filePath.startsWith(`${prefix}/`))
      || (kindFilter.size > 0 && !kindFilter.has(kind))
    ) {
      continue;
    }

    let fileGroup = filesByPath.get(filePath);
    if (!fileGroup) {
      if (files.length >= maxFiles) {
        truncated = true;
        continue;
      }

      fileGroup = {
        file: filePath,
        kind,
        matchCount: 0,
        snippets: [],
        truncated: false,
      };
      filesByPath.set(filePath, fileGroup);
      files.push(fileGroup);
    }

    const lineText = String(event?.data?.lines?.text ?? '');
    const lineNumber = Number(event?.data?.line_number) || 1;
    const submatches = Array.isArray(event?.data?.submatches) && event.data.submatches.length > 0
      ? event.data.submatches
      : [{ start: Math.max((Number(event?.data?.column) || 1) - 1, 0), end: Math.max((Number(event?.data?.column) || 1) - 1, 0) + String(query).length }];

    for (const submatch of submatches) {
      fileGroup.matchCount += 1;
      matchCount += 1;

      if (fileGroup.snippets.length >= maxSnippetsPerFile) {
        fileGroup.truncated = true;
        truncated = true;
        continue;
      }

      const matchStart = byteOffsetToStringIndex(lineText, submatch.start);
      const matchEnd = byteOffsetToStringIndex(lineText, submatch.end);
      const snippet = createSnippet(lineText, matchStart, matchEnd);
      fileGroup.snippets.push({
        column: matchStart + 1,
        line: lineNumber,
        matchEnd: snippet.matchEnd,
        matchStart: snippet.matchStart,
        text: snippet.text,
      });
    }
  }

  return {
    ...createEmptySearchResult({ query, truncated }),
    files,
    matchCount,
    truncated,
  };
}

export function searchExcalidrawSceneText(scene, { query, maxSnippetsPerFile = 5, wholeWord = false }) {
  const normalizedQuery = query.toLocaleLowerCase();
  const snippets = [];
  let matchCount = 0;
  for (const element of Array.isArray(scene?.elements) ? scene.elements : []) {
    if (element?.isDeleted || element?.type !== 'text' || typeof element.text !== 'string') continue;
    const text = element.text;
    const normalizedText = text.toLocaleLowerCase();
    let matchStart = normalizedText.indexOf(normalizedQuery);
    while (matchStart >= 0) {
      if (!wholeWord || isWholeWordMatch(normalizedText, matchStart, matchStart + normalizedQuery.length)) {
        matchCount += 1;
        if (snippets.length < maxSnippetsPerFile) {
          const snippet = createSnippet(text, matchStart, matchStart + query.length);
          snippets.push({
            column: matchStart + 1,
            line: 1,
            matchEnd: snippet.matchEnd,
            matchStart: snippet.matchStart,
            text: snippet.text,
          });
        }
      }
      matchStart = normalizedText.indexOf(normalizedQuery, matchStart + Math.max(query.length, 1));
    }
  }

  return { matchCount, snippets, truncated: matchCount > snippets.length };
}
