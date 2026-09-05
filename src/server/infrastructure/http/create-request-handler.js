import { createAgentApiHandler } from './create-agent-api-handler.js';
import { createAgentMcpHandler } from '../mcp/create-agent-mcp-handler.js';
import { createAgentToolRateLimiter } from '../../shared/agent-tool-rate-limiter.js';
import { createAuthApiHandler } from './create-auth-api-handler.js';
import { createGitApiCommandHandler } from './create-git-api-command-handler.js';
import { createGitApiQueryHandler } from './create-git-api-query-handler.js';
import { createHostedApiHandler } from './create-hosted-api-handler.js';
import { createPlantUmlApiHandler } from './create-plantuml-api-handler.js';
import { createStaticHandler } from './create-static-handler.js';
import { createStructurizrApiHandler } from './create-structurizr-api-handler.js';
import { createVaultApiCommandHandler } from './create-vault-api-command-handler.js';
import { createVaultApiQueryHandler } from './create-vault-api-query-handler.js';
import { parseJsonBody } from './request-body.js';
import {
  createRequestUrlWithPathname,
  stripBasePath,
} from './http-request-helpers.js';
import {
  applyCorsHeaders,
  jsonResponse,
  SECURITY_HEADERS,
  setHeaders,
  isSameOriginWriteRequest,
  WRITE_METHODS,
} from './http-response.js';

export function createRequestHandler(
  config,
  authService,
  vaultFileStore,
  backlinkIndex,
  baseQueryService = null,
  renderDocx = null,
  roomRegistry = null,
  plantUmlRenderer = null,
  gitService = null,
  searchService = null,
  testControls = { wsRoomHydrateDelayMs: 0 },
  workspaceMutationCoordinator = null,
  fileSystemSyncService = null,
  hostedWorkspaceService = null,
  githubSetupFlow = null,
  structurizrWorkspaceService = null,
  agentIntegration = null,
  vaultRegistry = null,
) {
  const handleStaticRequest = createStaticHandler(config, authService, searchService);
  const handleAuthApi = createAuthApiHandler({ authService });
  const handleHostedApi = createHostedApiHandler({
    authService,
    githubSetupFlow,
    hostedWorkspaceService,
  });
  // ponytail: one builder for legacy primary paths and scoped vaults; only the parts differ
  const vaultHandlerCache = new Map();
  function getVaultHandlers(id, parts) {
    let handlers = vaultHandlerCache.get(id);
    if (!handlers) {
      handlers = {
        command: createVaultApiCommandHandler({
          backlinkIndex: parts.backlinkIndex,
          maxPdfUploadBytes: config.maxPdfUploadBytes,
          renderDocx,
          roomRegistry: parts.roomRegistry,
          vaultFileStore: parts.vaultFileStore,
          workspaceMutationCoordinator: parts.workspaceMutationCoordinator,
        }),
        gitCommand: createGitApiCommandHandler({
          authService,
          gitService: parts.gitService,
          workspaceMutationCoordinator: parts.workspaceMutationCoordinator,
        }),
        gitQuery: createGitApiQueryHandler({ gitService: parts.gitService }),
        query: createVaultApiQueryHandler({
          baseQueryService: parts.baseQueryService,
          backlinkIndex: parts.backlinkIndex,
          config,
          searchService: parts.searchService,
          vaultFileStore: parts.vaultFileStore,
          workspaceMutationCoordinator: parts.workspaceMutationCoordinator,
        }),
      };
      vaultHandlerCache.set(id, handlers);
    }
    return handlers;
  }
  const primaryHandlers = getVaultHandlers(
    vaultRegistry?.getPrimaryContext?.()?.def.id ?? '__primary__',
    { backlinkIndex, baseQueryService, gitService, roomRegistry, searchService, vaultFileStore, workspaceMutationCoordinator },
  );
  const handlePlantUmlApi = createPlantUmlApiHandler({ plantUmlRenderer });
  const handleStructurizrApi = createStructurizrApiHandler({
    basePath: config.basePath,
    service: structurizrWorkspaceService,
  });
  const agentToolRateLimiter = createAgentToolRateLimiter(config.agentAccess.requestsPerMinute);
  const handleAgentApi = createAgentApiHandler({
    agentConnectionService: agentIntegration?.connectionService,
    agentContentService: agentIntegration?.contentService,
    authService,
    config,
    rateLimiter: agentToolRateLimiter,
  });
  const handleAgentMcp = config.agentAccess.enabled && agentIntegration
    ? createAgentMcpHandler({
        agentConnectionService: agentIntegration.connectionService,
        agentContentService: agentIntegration.contentService,
        config,
        rateLimiter: agentToolRateLimiter,
      })
    : async () => false;

  function parseVaultScope(pathname) {
    if (!pathname.startsWith('/api/v/')) {
      return null;
    }
    const rest = pathname.slice('/api/v/'.length);
    const slashIndex = rest.indexOf('/');
    if (slashIndex === -1) {
      return null;
    }
    const vaultId = rest.slice(0, slashIndex);
    if (!vaultId) {
      return null;
    }
    return { subPath: `/api${rest.slice(slashIndex)}`, vaultId };
  }

  async function handleVaultScopedApi(req, res, requestUrl) {
    const scope = parseVaultScope(requestUrl.pathname);
    if (!scope || !vaultRegistry) {
      return false;
    }
    let context;
    try {
      context = await vaultRegistry.getOrCreateContextAsync(scope.vaultId);
    } catch (error) {
      jsonResponse(req, res, error?.statusCode || 500, { error: error?.message || 'Vault unavailable' });
      return true;
    }
    const subUrl = new URL(requestUrl.toString());
    subUrl.pathname = scope.subPath;
    const handlers = getVaultHandlers(context.def.id, context);
    if (await handlers.query(req, res, subUrl)) {
      return true;
    }
    if (await handlers.command(req, res, subUrl)) {
      return true;
    }
    if (subUrl.pathname.startsWith('/api/git')) {
      if (await handlers.gitQuery(req, res, subUrl)) {
        return true;
      }
      if (await handlers.gitCommand(req, res, subUrl)) {
        return true;
      }
      jsonResponse(req, res, 404, { error: 'Git API endpoint not found' });
      return true;
    }
    return false;
  }

  function handleBasePathRedirect(req, res, originalRequestUrl) {
    if (
      config.basePath
      && (req.method === 'GET' || req.method === 'HEAD')
      && originalRequestUrl.pathname === config.basePath
    ) {
      const location = `${config.basePath}/${originalRequestUrl.search}`;
      res.writeHead(308, { Location: location });
      res.end();
      return true;
    }
    return false;
  }

  function handleCorsPreflight(req, res, isSameOriginWrite) {
    if (req.method !== 'OPTIONS') {
      return false;
    }

    const requestedMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
    const preflightTargetsWrite = WRITE_METHODS.has(requestedMethod);
    if (preflightTargetsWrite && !isSameOriginWrite) {
      jsonResponse(req, res, 403, { error: 'Cross-origin write requests are not allowed' });
      return true;
    }

    if (isSameOriginWrite) {
      applyCorsHeaders(res, req.headers.origin);
    }

    res.writeHead(204);
    res.end();
    return true;
  }

  function handleCorsWriteGuard(req, res, isSameOriginWrite) {
    if (WRITE_METHODS.has(req.method) && !isSameOriginWrite) {
      jsonResponse(req, res, 403, { error: 'Cross-origin write requests are not allowed' });
      return true;
    }
    return false;
  }

  async function handleTestEndpoints(req, res, requestUrl) {
    if (config.nodeEnv !== 'test') {
      return false;
    }

    if (requestUrl.pathname === '/api/test/reset-state' && req.method === 'POST') {
      await fileSystemSyncService?.resetForExternalStateChange?.();
      await roomRegistry?.reset?.();
      await backlinkIndex?.build?.();
      await workspaceMutationCoordinator?.initialize?.();
      await fileSystemSyncService?.resetForExternalStateChange?.();
      jsonResponse(req, res, 200, { ok: true });
      return true;
    }

    if (requestUrl.pathname === '/api/test/hydrate-delay' && req.method === 'POST') {
      const body = await parseJsonBody(req).catch(() => ({}));
      testControls.wsRoomHydrateDelayMs = Math.max(0, Number(body?.delayMs) || 0);
      await fileSystemSyncService?.resetForExternalStateChange?.();
      await roomRegistry?.reset?.();
      await backlinkIndex?.build?.();
      await workspaceMutationCoordinator?.initialize?.();
      await fileSystemSyncService?.resetForExternalStateChange?.();
      jsonResponse(req, res, 200, { delayMs: testControls.wsRoomHydrateDelayMs, ok: true });
      return true;
    }

    return false;
  }

  return async function handleRequest(req, res) {
    const originalRequestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);

    if (handleBasePathRedirect(req, res, originalRequestUrl)) {
      return;
    }

    const requestUrl = createRequestUrlWithPathname(
      originalRequestUrl,
      stripBasePath(originalRequestUrl.pathname, config.basePath),
    );
    const isSameOriginWrite = isSameOriginWriteRequest(req, requestUrl);

    setHeaders(res, SECURITY_HEADERS);

    if (handleCorsPreflight(req, res, isSameOriginWrite)) {
      return;
    }

    if (handleCorsWriteGuard(req, res, isSameOriginWrite)) {
      return;
    }

    if (await handleTestEndpoints(req, res, requestUrl)) {
      return;
    }

    if (await handleAuthApi(req, res, requestUrl)) {
      return;
    }

    if (await handleHostedApi(req, res, requestUrl)) {
      return;
    }

    if (await handleAgentMcp(req, res, requestUrl)) {
      return;
    }

    if (requestUrl.pathname.startsWith('/api/') || handleStructurizrApi.requiresAuthorization(requestUrl)) {
      const authorization = authService.authorizeApiRequest(req);
      if (!authorization.ok) {
        jsonResponse(req, res, authorization.statusCode, authorization.body);
        return;
      }

      const hostedAuthorization = await hostedWorkspaceService?.authorizeWorkspaceAccess?.({
        user: authService.getAuthenticatedUser?.(req) ?? null,
      });
      if (hostedAuthorization && !hostedAuthorization.ok) {
        jsonResponse(req, res, hostedAuthorization.statusCode, hostedAuthorization.body);
        return;
      }
    }

    if (await handleAgentApi(req, res, requestUrl)) {
      return;
    }

    if (await handleStructurizrApi(req, res, requestUrl)) {
      return;
    }

    if (requestUrl.pathname.startsWith('/api/')) {
      if (await handleVaultScopedApi(req, res, requestUrl)) {
        return;
      }
      if (await primaryHandlers.query(req, res, requestUrl)) {
        return;
      }
      if (await primaryHandlers.command(req, res, requestUrl)) {
        return;
      }
      if (await handlePlantUmlApi(req, res, requestUrl)) {
        return;
      }
    }

    if (requestUrl.pathname.startsWith('/api/git')) {
      if (!gitService) {
        jsonResponse(req, res, 503, { error: 'Git integration is not configured' });
        return;
      }
      if (await primaryHandlers.gitQuery(req, res, requestUrl)) {
        return;
      }
      if (await primaryHandlers.gitCommand(req, res, requestUrl)) {
        return;
      }
      jsonResponse(req, res, 404, { error: 'Git API endpoint not found' });
      return;
    }

    await handleStaticRequest(req, res, requestUrl);
  };
}
