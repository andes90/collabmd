import { resolveApiUrl } from '../domain/runtime-paths.js';
import { apiRequest, createSearchParams } from './api-client-utils.js';

export const gitApiClient = {
  readStatus({ force = false } = {}) {
    return apiRequest('/git/status', {
      fallback: 'Failed to load git status',
      query: force ? { force: 'true' } : null,
    });
  },

  getPullBackupSummaryUrl(backupId) {
    return resolveApiUrl(`/git/pull-backup-summary?${createSearchParams({ id: backupId }).toString()}`);
  },

  readPullBackups() {
    return apiRequest('/git/pull-backups', { fallback: 'Failed to load pull backups' });
  },

  readHistory({ limit, offset } = {}) {
    return apiRequest('/git/history', { fallback: 'Failed to load git history', query: { limit, offset } });
  },

  readFileHistory({ path, limit, offset } = {}) {
    return apiRequest('/git/file-history', { fallback: 'Failed to load file history', query: { limit, offset, path } });
  },

  readDiff({ allowLargePatch = false, metaOnly = false, path = null, scope = 'all' } = {}) {
    return apiRequest('/git/diff', {
      fallback: 'Failed to load git diff',
      query: {
        allowLargePatch: allowLargePatch ? 'true' : null,
        metaOnly: metaOnly ? 'true' : null,
        path,
        scope,
      },
    });
  },

  readCommit({ allowLargePatch = false, hash, metaOnly = false, path = null } = {}) {
    return apiRequest('/git/commit', {
      fallback: 'Failed to load git commit',
      query: {
        allowLargePatch: allowLargePatch ? 'true' : null,
        hash,
        metaOnly: metaOnly ? 'true' : null,
        path,
      },
    });
  },

  readFileSnapshot({ hash, path, ref } = {}) {
    return apiRequest('/git/file-snapshot', { fallback: 'Failed to load historical file preview', query: { hash, path, ref } });
  },

  getFileAttachmentUrl({ hash, path } = {}) {
    return resolveApiUrl(`/git/file-attachment?${createSearchParams({ hash, path }).toString()}`);
  },

  stageFile({ path, requestId = null } = {}) {
    return apiRequest('/git/stage', { body: { path }, fallback: 'Failed to stage file', method: 'POST', requestId });
  },

  unstageFile({ path, requestId = null } = {}) {
    return apiRequest('/git/unstage', { body: { path }, fallback: 'Failed to unstage file', method: 'POST', requestId });
  },

  stageAll({ requestId = null } = {}) {
    return apiRequest('/git/stage-all', { body: {}, fallback: 'Failed to stage all changes', method: 'POST', requestId });
  },

  unstageAll({ requestId = null } = {}) {
    return apiRequest('/git/unstage-all', { body: {}, fallback: 'Failed to unstage all changes', method: 'POST', requestId });
  },

  pushBranch({ requestId = null } = {}) {
    return apiRequest('/git/push', { body: {}, fallback: 'Failed to push branch', method: 'POST', requestId });
  },

  pullBranch({ requestId = null } = {}) {
    return apiRequest('/git/pull', { body: {}, fallback: 'Failed to pull branch', method: 'POST', requestId });
  },

  resetFile({ path, requestId = null } = {}) {
    return apiRequest('/git/reset-file', { body: { path }, fallback: 'Failed to reset file', method: 'POST', requestId });
  },

  commit({ message, requestId = null } = {}) {
    return apiRequest('/git/commit', { body: { message }, fallback: 'Failed to commit staged changes', method: 'POST', requestId });
  },
};
