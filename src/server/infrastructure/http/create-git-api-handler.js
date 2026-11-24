import { basename } from 'node:path';

import { createEmptyWorkspaceChange, hasWorkspaceMutation } from '../../../domain/workspace-change.js';
import { handleApiError, readRequestId } from './http-request-helpers.js';
import {
  createDownloadHeaders,
  jsonResponse,
  sendResponse,
} from './http-response.js';
import { parseJsonBody } from './request-body.js';

function resolveDiffScope(requestUrl) {
  const scope = String(requestUrl.searchParams.get('scope') || '').trim().toLowerCase();
  if (scope === 'staged' || scope === 'all' || scope === 'working-tree') {
    return scope;
  }
  return requestUrl.searchParams.get('staged') === 'true' ? 'staged' : 'working-tree';
}

function isTruthyParam(value) {
  return value === '1' || value === 'true';
}

function readIntParam(value, fallback) {
  const parsed = Number.parseInt(String(value ?? ''), 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

async function applyWorkspaceMutationEffects({
  action,
  req,
  responsePayload,
  workspaceMutationCoordinator,
}) {
  const workspaceChange = responsePayload?.workspaceChange ?? createEmptyWorkspaceChange();
  responsePayload.workspaceChange = workspaceChange;
  if (!hasWorkspaceMutation(workspaceChange)) {
    return responsePayload;
  }

  await workspaceMutationCoordinator?.reconcileVaultChangeObservation?.({
    action,
    origin: 'git',
    requestId: readRequestId(req),
    sourceRef: responsePayload?.sourceRef ?? null,
    workspaceChange,
  });
  return responsePayload;
}

export function createGitApiHandler({
  authService = null,
  gitService,
  workspaceMutationCoordinator = null,
}) {
  const queryRoutes = new Map([
    ['/api/git/status', {
      errorMessage: 'Failed to read git status',
      run: (params) => gitService.getStatus({ force: isTruthyParam(params.get('force')) }),
    }],
    ['/api/git/diff', {
      errorMessage: 'Failed to read git diff',
      run: (params, requestUrl) => gitService.getDiff({
        allowLargePatch: isTruthyParam(params.get('allowLargePatch')),
        metaOnly: isTruthyParam(params.get('metaOnly')),
        path: params.get('path'),
        scope: resolveDiffScope(requestUrl),
      }),
    }],
    ['/api/git/history', {
      errorMessage: 'Failed to read git history',
      run: (params) => gitService.getHistory({
        limit: readIntParam(params.get('limit'), 30),
        offset: readIntParam(params.get('offset'), 0),
      }),
    }],
    ['/api/git/file-history', {
      errorMessage: 'Failed to read git file history',
      run: (params) => gitService.getFileHistory({
        limit: readIntParam(params.get('limit'), 30),
        offset: readIntParam(params.get('offset'), 0),
        path: params.get('path'),
      }),
    }],
    ['/api/git/commit', {
      errorMessage: 'Failed to read git commit',
      run: (params) => gitService.getCommit({
        allowLargePatch: isTruthyParam(params.get('allowLargePatch')),
        hash: params.get('hash'),
        metaOnly: isTruthyParam(params.get('metaOnly')),
        path: params.get('path'),
      }),
    }],
    ['/api/git/file-snapshot', {
      errorMessage: 'Failed to read git file snapshot',
      run: (params) => gitService.getFileSnapshot({
        hash: params.get('hash'),
        path: params.get('path'),
        ref: params.get('ref'),
      }),
    }],
    ['/api/git/pull-backups', {
      errorMessage: 'Failed to read pull backups',
      run: async () => ({ backups: await gitService.listPullBackups() }),
    }],
  ]);

  const commandRoutes = new Map([
    ['stage', { bodyField: 'path', errorMessage: 'Failed to stage git file', run: (body) => gitService.stageFile(body.path) }],
    ['unstage', { bodyField: 'path', errorMessage: 'Failed to unstage git file', run: (body) => gitService.unstageFile(body.path) }],
    ['stage-all', { errorMessage: 'Failed to stage all git changes', run: () => gitService.stageAll() }],
    ['unstage-all', { errorMessage: 'Failed to unstage all git changes', run: () => gitService.unstageAll() }],
    ['commit', {
      bodyField: 'message',
      errorMessage: 'Failed to commit staged changes',
      run: (body, req) => gitService.commitStaged({
        author: authService?.getAuthenticatedUser?.(req) ?? null,
        message: body.message,
      }),
    }],
    ['push', { errorMessage: 'Failed to push git branch', run: () => gitService.pushBranch() }],
    ['pull', {
      errorMessage: 'Failed to pull git branch',
      run: (_body, req) => gitService.pullBranch({
        author: authService?.getAuthenticatedUser?.(req) ?? null,
      }),
    }],
    ['reset-file', { bodyField: 'path', errorMessage: 'Failed to reset git file', run: (body) => gitService.resetFileToHead(body.path) }],
  ]);

  return async function handleGitApi(req, res, requestUrl) {
    if (req.method === 'GET') {
      const queryRoute = queryRoutes.get(requestUrl.pathname);
      if (queryRoute) {
        try {
          jsonResponse(req, res, 200, await queryRoute.run(requestUrl.searchParams, requestUrl));
        } catch (error) {
          handleApiError(req, res, error, `[api] ${queryRoute.errorMessage}:`, queryRoute.errorMessage);
        }
        return true;
      }

      if (requestUrl.pathname === '/api/git/file-attachment') {
        try {
          const attachment = await gitService.getFileAttachment({
            hash: requestUrl.searchParams.get('hash'),
            path: requestUrl.searchParams.get('path'),
          });
          sendResponse(req, res, {
            body: attachment.content,
            headers: createDownloadHeaders(
              basename(String(attachment.path || 'image')),
              attachment.mimeType || 'application/octet-stream',
              {
                cacheControl: 'private, max-age=300, stale-while-revalidate=3600',
                inline: true,
                svgCsp: true,
              },
            ),
            statusCode: 200,
          });
        } catch (error) {
          handleApiError(req, res, error, '[api] Failed to read git file attachment:', 'Failed to read git file attachment');
        }
        return true;
      }

      if (requestUrl.pathname === '/api/git/pull-backup-summary') {
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

      return false;
    }

    if (req.method !== 'POST' || !requestUrl.pathname.startsWith('/api/git/')) {
      return false;
    }

    const action = requestUrl.pathname.slice('/api/git/'.length);
    const route = commandRoutes.get(action);
    if (!route) {
      return false;
    }

    try {
      const body = route.bodyField ? await parseJsonBody(req) : {};
      if (route.bodyField && !body?.[route.bodyField]) {
        jsonResponse(req, res, 400, { error: `Missing ${route.bodyField}` });
        return true;
      }

      jsonResponse(req, res, 200, await workspaceMutationCoordinator.runManagedWorkspaceMutation(async () => (
        applyWorkspaceMutationEffects({
          action,
          req,
          responsePayload: await route.run(body, req),
          workspaceMutationCoordinator,
        })
      )));
    } catch (error) {
      handleApiError(req, res, error, `[api] ${route.errorMessage}:`, route.errorMessage);
    }
    return true;
  };
}
