import {
  getVaultFileExtension,
  isImageAttachmentFilePath,
  isMarkdownFilePath,
} from '../../domain/file-kind.js';
import { resolveVaultRelativePath } from '../../domain/vault-paths.js';
import { resolveWikiTargetWithIndex } from '../../domain/wiki-link-resolver.js';

const INTERNAL_LINK_RE = /(!)?\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]+)?\]\]/g;
const MARKDOWN_IMAGE_OPEN_RE = /!\[[^\]\n]*\]\(/g;

function isAbsoluteOrExternalUrl(source = '') {
  const normalized = String(source ?? '').trim();
  return (
    !normalized
    || normalized.startsWith('data:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('#')
    || normalized.startsWith('//')
    || /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(normalized)
    || normalized.startsWith('/')
  );
}

function parseMarkdownImageDestination(sourceText = '') {
  const text = String(sourceText ?? '');
  let index = 0;
  while (/\s/u.test(text[index] ?? '')) {
    index += 1;
  }

  if (text[index] === '<') {
    const endIndex = text.indexOf('>', index + 1);
    if (endIndex < 0 || text.indexOf(')', endIndex + 1) < 0) {
      return '';
    }
    return text.slice(index + 1, endIndex).trim();
  }

  const startIndex = index;
  while (index < text.length) {
    const char = text[index];
    if (char === ')' || /\s/u.test(char)) {
      break;
    }
    index += 1;
  }

  if (startIndex === index || text.indexOf(')', index) < 0) {
    return '';
  }

  return text.slice(startIndex, index).trim();
}

function resolveMarkdownImageTargetPath(sourceFilePath = '', imageSource = '') {
  const source = String(imageSource ?? '').trim();
  if (isAbsoluteOrExternalUrl(source)) {
    return '';
  }

  const resolvedPath = resolveVaultRelativePath(sourceFilePath, source);
  return isImageAttachmentFilePath(resolvedPath) ? resolvedPath : '';
}

function resolveAliasedTargetPath(targetPath = '', wikiTargetIndex = null, targetPathAliases = new Map()) {
  const candidates = [
    String(targetPath ?? '').trim(),
    normalizeReferenceTargetKey(targetPath),
  ].filter(Boolean);

  for (const candidate of candidates) {
    const aliasedPath = targetPathAliases?.get?.(candidate);
    if (aliasedPath && wikiTargetIndex?.exactPaths?.has?.(aliasedPath)) {
      return aliasedPath;
    }
  }

  return null;
}

export function normalizeReferenceTargetKey(target = '') {
  const normalizedTarget = String(target ?? '').trim();
  if (!normalizedTarget) {
    return '';
  }

  return getVaultFileExtension(normalizedTarget)
    ? normalizedTarget
    : `${normalizedTarget}.md`;
}

export function collectReferenceTargetKeysForFilePath(filePath = '') {
  const normalizedPath = String(filePath ?? '').trim();
  if (!normalizedPath) {
    return [];
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const keys = [];
  for (let index = 0; index < segments.length; index += 1) {
    keys.push(segments.slice(index).join('/'));
  }

  if (isMarkdownFilePath(normalizedPath)) {
    const rawSegments = normalizedPath.replace(/\.md$/i, '').split('/').filter(Boolean);
    for (let index = 0; index < rawSegments.length; index += 1) {
      keys.push(rawSegments.slice(index).join('/'));
    }
  }

  return [...new Set(keys)];
}

export function createReferenceTargetAliasMap(renamedEntries = []) {
  const aliases = new Map();

  renamedEntries.forEach((entry) => {
    const oldPath = Array.isArray(entry) ? entry[0] : entry?.oldPath;
    const newPath = Array.isArray(entry) ? entry[1] : entry?.newPath;
    if (!oldPath || !newPath) {
      return;
    }

    aliases.set(oldPath, newPath);
    collectReferenceTargetKeysForFilePath(oldPath).forEach((targetKey) => {
      aliases.set(targetKey, newPath);
    });
  });

  return aliases;
}
export function collectMarkdownImageSources(markdownText = '') {
  const sources = [];
  String(markdownText ?? '').split('\n').forEach((line, lineIndex) => {
    MARKDOWN_IMAGE_OPEN_RE.lastIndex = 0;
    while (MARKDOWN_IMAGE_OPEN_RE.exec(line) !== null) {
      const source = parseMarkdownImageDestination(line.slice(MARKDOWN_IMAGE_OPEN_RE.lastIndex));
      if (source) sources.push({ line: lineIndex + 1, source });
    }
  });
  return sources;
}


export function collectMarkdownReferences(markdownText = '', {
  sourceFilePath = '',
  targetPathAliases = new Map(),
  wikiTargetIndex = null,
} = {}) {
  const references = [];
  const lines = String(markdownText ?? '').split('\n');

  for (const [lineIndex, line] of lines.entries()) {
    const context = line.trim();

    INTERNAL_LINK_RE.lastIndex = 0;
    let linkMatch;
    while ((linkMatch = INTERNAL_LINK_RE.exec(line)) !== null) {
      const rawTarget = String(linkMatch[2] ?? '').trim();
      if (!rawTarget) {
        continue;
      }

      const resolvedPath = resolveWikiTargetWithIndex(rawTarget, wikiTargetIndex)
        || resolveAliasedTargetPath(rawTarget, wikiTargetIndex, targetPathAliases);
      references.push({
        context,
        isEmbed: Boolean(linkMatch[1]),
        line: lineIndex + 1,
        rawTarget,
        rawTargetKey: normalizeReferenceTargetKey(rawTarget),
        resolvedPath,
        targetPath: resolvedPath || rawTarget,
      });
    }

    MARKDOWN_IMAGE_OPEN_RE.lastIndex = 0;
    while (MARKDOWN_IMAGE_OPEN_RE.exec(line) !== null) {
      const rawTarget = parseMarkdownImageDestination(line.slice(MARKDOWN_IMAGE_OPEN_RE.lastIndex));
      const targetPath = resolveMarkdownImageTargetPath(sourceFilePath, rawTarget);
      if (!targetPath) {
        continue;
      }

      const resolvedPath = wikiTargetIndex?.exactPaths?.has?.(targetPath)
        ? targetPath
        : resolveAliasedTargetPath(targetPath, wikiTargetIndex, targetPathAliases);
      references.push({
        context,
        isEmbed: true,
        line: lineIndex + 1,
        rawTarget,
        rawTargetKey: normalizeReferenceTargetKey(targetPath),
        resolvedPath,
        targetPath,
      });
    }
  }

  return references;
}
