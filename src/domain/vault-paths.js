export function resolveVaultRelativePath(fromFilePath = '', relativePath = '') {
  const sourceSegments = String(fromFilePath ?? '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean);
  const targetSegments = String(relativePath ?? '')
    .split('/')
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return segment;
      }
    });

  if (targetSegments.length === 0) {
    return '';
  }

  sourceSegments.pop();
  const resolvedSegments = [...sourceSegments];

  for (const rawSegment of targetSegments) {
    const segment = String(rawSegment ?? '').trim();
    if (!segment || segment === '.') {
      continue;
    }

    if (segment === '..') {
      if (resolvedSegments.length === 0) {
        return '';
      }
      resolvedSegments.pop();
      continue;
    }

    resolvedSegments.push(segment);
  }

  return resolvedSegments.join('/');
}

export function replacePathPrefix(pathValue, oldPrefix, newPrefix) {
  if (pathValue === oldPrefix) {
    return newPrefix;
  }

  return `${newPrefix}${pathValue.slice(oldPrefix.length)}`;
}
