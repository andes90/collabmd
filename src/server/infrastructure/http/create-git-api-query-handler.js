import { basename } from 'node:path';

import { handleApiError } from './http-request-helpers.js';
import {
  createSafeAsciiFilename,
  encodeContentDispositionFilename,
  jsonResponse,
  sendResponse,
  SVG_ATTACHMENT_CSP,
} from './http-response.js';

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

export function createGitApiQueryHandler({ gitService }) {
  return async function handleGitApiQuery(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/git/status' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, await gitService.getStatus({
          force: isTruthyParam(requestUrl.searchParams.get('force')),
        }));
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to read git status:', 'Failed to read git status');
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
        handleApiError(req, res, error, '[api] Failed to read git diff:', 'Failed to read git diff');
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
        handleApiError(req, res, error, '[api] Failed to read git history:', 'Failed to read git history');
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
        handleApiError(req, res, error, '[api] Failed to read git file history:', 'Failed to read git file history');
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
        handleApiError(req, res, error, '[api] Failed to read git commit:', 'Failed to read git commit');
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
        handleApiError(req, res, error, '[api] Failed to read git file snapshot:', 'Failed to read git file snapshot');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/file-attachment' && req.method === 'GET') {
      try {
        const attachment = await gitService.getFileAttachment({
          hash: requestUrl.searchParams.get('hash'),
          path: requestUrl.searchParams.get('path'),
        });
        const fileName = basename(String(attachment.path || 'image'));
        sendResponse(req, res, {
          body: attachment.content,
          headers: {
            'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
            'Content-Disposition': `inline; filename="${createSafeAsciiFilename(fileName)}"; filename*=UTF-8''${encodeContentDispositionFilename(fileName)}`,
            'Content-Type': attachment.mimeType || 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            ...(attachment.mimeType === 'image/svg+xml' ? { 'Content-Security-Policy': SVG_ATTACHMENT_CSP } : {}),
          },
          statusCode: 200,
        });
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to read git file attachment:', 'Failed to read git file attachment');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/pull-backup-summary' && req.method === 'GET') {
      try {
        const content = await gitService.readPullBackupSummary(requestUrl.searchParams.get('id'));
        if (content === null) {
          jsonResponse(req, res, 404, { error: 'Pull backup summary not found' });
        } else {
          sendResponse(req, res, {
            body: content,
            headers: {
              'Cache-Control': 'no-store',
              'Content-Type': 'text/plain; charset=utf-8',
              'Content-Security-Policy': "default-src 'none'; sandbox",
              'X-Content-Type-Options': 'nosniff',
            },
            statusCode: 200,
          });
        }
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to read pull backup summary:', 'Failed to read pull backup summary');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/git/pull-backups' && req.method === 'GET') {
      try {
        jsonResponse(req, res, 200, {
          backups: await gitService.listPullBackups(),
        });
      } catch (error) {
        handleApiError(req, res, error, '[api] Failed to read pull backups:', 'Failed to read pull backups');
      }
      return true;
    }

    return false;
  };
}
