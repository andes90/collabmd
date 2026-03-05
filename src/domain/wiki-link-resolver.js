function normalizeWikiTarget(target) {
  const trimmed = String(target ?? '').trim();
  if (!trimmed) {
    return null;
  }

  return trimmed.endsWith('.md') ? trimmed : `${trimmed}.md`;
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
