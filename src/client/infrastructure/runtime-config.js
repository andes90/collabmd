import {
  getClientRuntimeConfig,
  resolveApiUrl,
  resolveAppPath,
  resolveAppUrl,
  resolveWsBaseUrl,
} from '../domain/runtime-paths.js';

export function getRuntimeConfig() {
  return getClientRuntimeConfig();
}

export { resolveApiUrl, resolveAppPath, resolveAppUrl, resolveWsBaseUrl };

function getHashParams() {
  const rawHash = window.location.hash.startsWith('#')
    ? window.location.hash.slice(1)
    : window.location.hash;
  return new URLSearchParams(rawHash);
}

function normalizeDiffScope(scope) {
  if (scope === 'staged' || scope === 'all' || scope === 'working-tree') {
    return scope;
  }

  return 'all';
}

export function getHashRoute() {
  const params = getHashParams();

  if (params.has('git-file-preview')) {
    const historicalFilePath = params.get('git-file-preview') || null;
    return {
      currentFilePath: params.get('current') || historicalFilePath,
      filePath: historicalFilePath,
      hash: params.get('hash') || null,
      type: 'git-file-preview',
    };
  }

  if (params.has('git-file-history')) {
    return {
      filePath: params.get('git-file-history') || null,
      type: 'git-file-history',
    };
  }

  if (params.has('git-history')) {
    return { type: 'git-history' };
  }

  if (params.has('git-commit')) {
    return {
      hash: params.get('git-commit') || null,
      historyFilePath: params.get('history') || null,
      path: params.get('path') || null,
      type: 'git-commit',
    };
  }

  if (params.has('git-diff')) {
    const filePath = params.get('git-diff') || null;
    return {
      filePath,
      scope: normalizeDiffScope(params.get('scope') || (filePath ? 'working-tree' : 'all')),
      type: 'git-diff',
    };
  }

  if (params.has('file')) {
    return {
      drawioMode: params.get('drawio') || null,
      filePath: params.get('file'),
      type: 'file',
    };
  }

  return { type: 'empty' };
}

export function navigateToFile(filePath, { drawioMode = null } = {}) {
  const params = new URLSearchParams();
  if (filePath) {
    params.set('file', filePath);
  }
  if (drawioMode) {
    params.set('drawio', drawioMode);
  }
  window.location.hash = params.toString();
}

export function navigateToGitDiff({ filePath = null, scope = 'all' } = {}) {
  const params = new URLSearchParams();
  params.set('git-diff', filePath ?? '');
  params.set('scope', normalizeDiffScope(scope));
  window.location.hash = params.toString();
}

export function navigateToGitCommit({ hash, path = null, historyFilePath = null } = {}) {
  const normalizedHash = String(hash ?? '').trim();
  const params = new URLSearchParams();
  params.set('git-commit', normalizedHash);
  if (historyFilePath) {
    params.set('history', historyFilePath);
  }
  if (path) {
    params.set('path', path);
  }
  window.location.hash = params.toString();
}

export function navigateToGitHistory() {
  const params = new URLSearchParams();
  params.set('git-history', '1');
  window.location.hash = params.toString();
}

export function navigateToGitFileHistory({ filePath } = {}) {
  const params = new URLSearchParams();
  params.set('git-file-history', filePath ?? '');
  window.location.hash = params.toString();
}

export function navigateToGitFilePreview({ hash, path, currentFilePath = null } = {}) {
  const normalizedHash = String(hash ?? '').trim();
  const params = new URLSearchParams();
  params.set('git-file-preview', path ?? '');
  if (currentFilePath) {
    params.set('current', currentFilePath);
  }
  params.set('hash', normalizedHash);
  window.location.hash = params.toString();
}
