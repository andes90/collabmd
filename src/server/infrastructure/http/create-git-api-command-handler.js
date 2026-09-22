import { handleApiError, readRequestId } from './http-request-helpers.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';
import { createEmptyWorkspaceChange, hasWorkspaceMutation } from '../../../domain/workspace-change.js';

async function parseRequiredBody(req, res, fieldName) {
  const body = await parseJsonBody(req);
  if (!body?.[fieldName]) {
    jsonResponse(req, res, 400, { error: `Missing ${fieldName}` });
    return null;
  }

  return body;
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

export function createGitApiCommandHandler({
  authService = null,
  gitService,
  workspaceMutationCoordinator = null,
}) {
  const routes = [
    {
      action: 'stage', bodyField: 'path', errorMessage: 'Failed to stage git file',
      run: (body) => gitService.stageFile(body.path),
    },
    {
      action: 'unstage', bodyField: 'path', errorMessage: 'Failed to unstage git file',
      run: (body) => gitService.unstageFile(body.path),
    },
    {
      action: 'stage-all', errorMessage: 'Failed to stage all git changes',
      run: () => gitService.stageAll(),
    },
    {
      action: 'unstage-all', errorMessage: 'Failed to unstage all git changes',
      run: () => gitService.unstageAll(),
    },
    {
      action: 'commit', bodyField: 'message', errorMessage: 'Failed to commit staged changes',
      run: (body, req) => gitService.commitStaged({
        author: authService?.getAuthenticatedUser?.(req) ?? null,
        message: body.message,
      }),
    },
    {
      action: 'push', errorMessage: 'Failed to push git branch',
      run: () => gitService.pushBranch(),
    },
    {
      action: 'pull', errorMessage: 'Failed to pull git branch',
      run: (_body, req) => gitService.pullBranch({
        author: authService?.getAuthenticatedUser?.(req) ?? null,
      }),
    },
    {
      action: 'reset-file', bodyField: 'path', errorMessage: 'Failed to reset git file',
      run: (body) => gitService.resetFileToHead(body.path),
    },
  ];

  return async function handleGitApiCommand(req, res, requestUrl) {
    const route = req.method === 'POST'
      ? routes.find(({ action }) => requestUrl.pathname === `/api/git/${action}`)
      : null;
    if (!route) {
      return false;
    }

    try {
      const body = route.bodyField ? await parseRequiredBody(req, res, route.bodyField) : {};
      if (!body) {
        return true;
      }

      jsonResponse(req, res, 200, await applyWorkspaceMutationEffects({
        action: route.action,
        req,
        responsePayload: await workspaceMutationCoordinator.runManagedWorkspaceMutation(
          () => route.run(body, req),
        ),
        workspaceMutationCoordinator,
      }));
    } catch (error) {
      handleApiError(req, res, error, `[api] ${route.errorMessage}:`, route.errorMessage);
    }
    return true;
  };
}
