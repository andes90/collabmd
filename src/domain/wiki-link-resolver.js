function normalizeWikiTarget(target) {
  const trimmed = String(target ?? '').trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
}

export function createWikiTargetIndex(files = []) {
  const exactPaths = new Set();
  const pathWithoutMd = new Map();
  const suffixMatch = new Map();

  for (const filePath of files) {
    if (typeof filePath !== 'string' || filePath.length === 0) {
      continue;
    }

    exactPaths.add(filePath);

    const rawPath = filePath.replace(/\.md$/i, '');
    if (!pathWithoutMd.has(rawPath)) {
      pathWithoutMd.set(rawPath, filePath);
    }

    const segments = filePath.split('/');
    for (let index = 0; index < segments.length; index += 1) {
      const suffix = segments.slice(index).join('/');
      if (!suffixMatch.has(suffix)) {
        suffixMatch.set(suffix, filePath);
      }
    }
  }

  return {
    exactPaths,
    pathWithoutMd,
    suffixMatch,
  };
}

export function resolveWikiTargetWithIndex(target, index) {
  const normalizedTarget = normalizeWikiTarget(target);
  if (!normalizedTarget || !index) {
    return null;
  }

  if (index.exactPaths?.has(normalizedTarget)) {
    return normalizedTarget;
  }

  const suffixMatch = index.suffixMatch?.get(normalizedTarget);
  if (suffixMatch) {
    return suffixMatch;
  }

  const rawTarget = String(target ?? '').trim();
  return index.pathWithoutMd?.get(rawTarget) ?? null;
}

export function resolveWikiTargetPath(target, files) {
  const normalizedTarget = normalizeWikiTarget(target);
  if (!normalizedTarget || !Array.isArray(files) || files.length === 0) {
    return null;
  }

  const rawTarget = String(target ?? '').trim();

  return files.find((filePath) => (
    filePath === normalizedTarget
      || filePath.endsWith(`/${normalizedTarget}`)
      || filePath.replace(/\.md$/i, '') === rawTarget
  )) ?? null;
}
