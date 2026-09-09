import { stripVaultFileExtension } from '../../domain/file-kind.js';

function createRangeIndices(start, length) {
  return Array.from({ length }, (_, index) => start + index);
}

function findFuzzyMatch(text, query) {
  const indices = [];
  let queryIndex = 0;
  let score = 0;
  let consecutiveBonus = 0;

  for (let index = 0; index < text.length && queryIndex < query.length; index += 1) {
    if (/\s/u.test(query[queryIndex]) && /[\s/\\_-]/u.test(text[index])) {
      queryIndex += 1;
      consecutiveBonus = 0;
      continue;
    }

    if (text[index] !== query[queryIndex]) {
      if (queryIndex > 0) score -= 0.25;
      consecutiveBonus = 0;
      continue;
    }

    queryIndex += 1;
    indices.push(index);
    consecutiveBonus += 1;
    score += consecutiveBonus;

    if (index === 0 || /[/\-_ ]/u.test(text[index - 1])) score += 5;
  }

  return queryIndex === query.length && score > 0 ? { indices, score } : null;
}

export function createFileSearchEntry(filePath) {
  const displayName = stripVaultFileExtension(filePath);
  const fileName = displayName.split('/').pop() || displayName;
  const rawFileName = String(filePath ?? '').split('/').pop() || String(filePath ?? '');

  return {
    dirPath: displayName.includes('/') ? displayName.slice(0, displayName.lastIndexOf('/')) : '',
    displayName,
    fileName,
    filePath,
    lowerDisplayName: displayName.toLowerCase(),
    lowerFileName: fileName.toLowerCase(),
    lowerPath: String(filePath).toLowerCase(),
    lowerRawFileName: rawFileName.toLowerCase(),
  };
}

export function findFileSearchMatch(entry, query) {
  const fileNameStart = entry.displayName.length - entry.fileName.length;
  const searches = [
    [entry.lowerFileName, fileNameStart, 100],
    [entry.lowerDisplayName, 0, 50],
    [entry.lowerRawFileName, fileNameStart, 40],
    [entry.lowerPath, 0, 25],
  ];

  for (const [text, offset, baseScore] of searches) {
    const index = text.indexOf(query);
    if (index >= 0) {
      return {
        indices: createRangeIndices(index + offset, query.length),
        score: baseScore + (1 / text.length),
      };
    }
  }

  return findFuzzyMatch(entry.lowerDisplayName, query);
}
