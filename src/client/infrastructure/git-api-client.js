import { resolveApiUrl } from '../domain/runtime-paths.js';
import { createRequestHeaders, parseApiResponse } from './api-client-utils.js';

function createSearchParams(values = {}) {
  const params = new URLSearchParams();
  Object.entries(values).forEach(([key, value]) => {
    if (value == null || value === '') {
      return;
    }

    params.set(key, String(value));
  });
  return params;
}

async function postJson(path, payload, { fallbackError, requestId = null } = {}) {
  const response = await fetch(resolveApiUrl(path), {
    body: JSON.stringify(payload),
    headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
    method: 'POST',
  });
  return parseApiResponse(response, fallbackError);
}

export const gitApiClient = {
  async readStatus({ force = false } = {}) {
    const response = await fetch(resolveApiUrl(`/git/status${force ? '?force=true' : ''}`));
    return parseApiResponse(response, 'Failed to load git status');
  },

  async readPullBackups() {
    const response = await fetch(resolveApiUrl('/git/pull-backups'));
    return parseApiResponse(response, 'Failed to load pull backups');
  },

  async readHistory({ limit, offset } = {}) {
    const params = createSearchParams({ limit, offset });
    const response = await fetch(resolveApiUrl(`/git/history?${params.toString()}`));
    return parseApiResponse(response, 'Failed to load git history');
  },

  async readFileHistory({ path, limit, offset } = {}) {
    const params = createSearchParams({ limit, offset, path });
    const response = await fetch(resolveApiUrl(`/git/file-history?${params.toString()}`));
    return parseApiResponse(response, 'Failed to load file history');
  },

  async readDiff({
    allowLargePatch = false,
    metaOnly = false,
    path = null,
    scope = 'all',
  } = {}) {
    const params = createSearchParams({
      allowLargePatch: allowLargePatch ? 'true' : null,
      metaOnly: metaOnly ? 'true' : null,
      path,
      scope,
    });
    const response = await fetch(resolveApiUrl(`/git/diff?${params.toString()}`));
    return parseApiResponse(response, 'Failed to load git diff');
  },

  async readCommit({
    allowLargePatch = false,
    hash,
    metaOnly = false,
    path = null,
  } = {}) {
    const params = createSearchParams({
      allowLargePatch: allowLargePatch ? 'true' : null,
      hash,
      metaOnly: metaOnly ? 'true' : null,
      path,
    });
    const response = await fetch(resolveApiUrl(`/git/commit?${params.toString()}`));
    return parseApiResponse(response, 'Failed to load git commit');
  },

  async readFileSnapshot({ hash, path } = {}) {
    const params = createSearchParams({ hash, path });
    const response = await fetch(resolveApiUrl(`/git/file-snapshot?${params.toString()}`));
    return parseApiResponse(response, 'Failed to load historical file preview');
  },

  getFileAttachmentUrl({ hash, path } = {}) {
    const params = createSearchParams({ hash, path });
    return resolveApiUrl(`/git/file-attachment?${params.toString()}`);
  },

  async stageFile({ path, requestId = null } = {}) {
    return postJson('/git/stage', { path }, { requestId, fallbackError: 'Failed to stage file' });
  },

  async unstageFile({ path, requestId = null } = {}) {
    return postJson('/git/unstage', { path }, { requestId, fallbackError: 'Failed to unstage file' });
  },

  async stageAll({ requestId = null } = {}) {
    return postJson('/git/stage-all', {}, { requestId, fallbackError: 'Failed to stage all changes' });
  },

  async unstageAll({ requestId = null } = {}) {
    return postJson('/git/unstage-all', {}, { requestId, fallbackError: 'Failed to unstage all changes' });
  },

  async pushBranch({ requestId = null } = {}) {
    return postJson('/git/push', {}, { requestId, fallbackError: 'Failed to push branch' });
  },

  async pullBranch({ requestId = null } = {}) {
    return postJson('/git/pull', {}, { requestId, fallbackError: 'Failed to pull branch' });
  },

  async resetFile({ path, requestId = null } = {}) {
    return postJson('/git/reset-file', { path }, { requestId, fallbackError: 'Failed to reset file' });
  },

  async commit({ message, requestId = null } = {}) {
    return postJson('/git/commit', { message }, { requestId, fallbackError: 'Failed to commit staged changes' });
  },
};
