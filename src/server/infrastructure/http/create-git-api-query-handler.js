import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';

function resolveDiffScope(requestUrl) {
  const scope = String(requestUrl.searchParams.get('scope') || '').trim().toLowerCase();
  if (scope === 'staged' || scope === 'all' || scope === 'working-tree') {
    return scope;
  }

  if (requestUrl.searchParams.get('staged') === 'true') {
    return 'staged';
  }

  return 'working-tree';
}

function isTruthyParam(value) {
  return value === '1' || value === 'true';
}

function readHistoryLimit(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 30;
}

function readHistoryOffset(value) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : 0;
}

function handleGitError(req, res, error, message, fallback) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    const payload = { error: error.message };
    if (typeof error?.requestCode === 'string') {
      payload.code = error.requestCode;
    }
    jsonResponse(req, res, statusCode, payload);
    return true;
  }

  console.error(message, error.message);
  jsonResponse(req, res, 500, { error: fallback });
  return true;
}

export function createGitApiQueryHandler({ gitService }) {
  return async function handleGitApiQuery(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/git/status' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getStatus({
          force: isTruthyParam(requestUrl.searchParams.get('force')),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git status:', 'Failed to read git status');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/diff' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getDiff({
          allowLargePatch: isTruthyParam(requestUrl.searchParams.get('allowLargePatch')),
          metaOnly: isTruthyParam(requestUrl.searchParams.get('metaOnly')),
          path: requestUrl.searchParams.get('path'),
          scope: resolveDiffScope(requestUrl),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git diff:', 'Failed to read git diff');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/history' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getHistory({
          limit: readHistoryLimit(requestUrl.searchParams.get('limit')),
          offset: readHistoryOffset(requestUrl.searchParams.get('offset')),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git history:', 'Failed to read git history');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/file-history' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getFileHistory({
          limit: readHistoryLimit(requestUrl.searchParams.get('limit')),
          offset: readHistoryOffset(requestUrl.searchParams.get('offset')),
          path: requestUrl.searchParams.get('path'),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git file history:', 'Failed to read git file history');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/commit' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getCommit({
          allowLargePatch: isTruthyParam(requestUrl.searchParams.get('allowLargePatch')),
          hash: requestUrl.searchParams.get('hash'),
          metaOnly: isTruthyParam(requestUrl.searchParams.get('metaOnly')),
          path: requestUrl.searchParams.get('path'),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git commit:', 'Failed to read git commit');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/file-snapshot' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getFileSnapshot({
          hash: requestUrl.searchParams.get('hash'),
          path: requestUrl.searchParams.get('path'),
        }));
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read git file snapshot:', 'Failed to read git file snapshot');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/pull-backups' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, {
          backups: await gitService.listPullBackups(),
        });
      } catch (error) {
        handleGitError(req, res, error, '[api] Failed to read pull backups:', 'Failed to read pull backups');
      }
      return true;
    }

    return false;
  };
}
