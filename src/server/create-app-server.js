import { createServer } from 'http';
import { resolve } from 'node:path';

import { loadConfig } from './config/env.js';
import { AgentConnectionService } from './application/agent-connection-service.js';
import { AgentContentService } from './application/agent-content-service.js';
import { createAuthService } from './auth/create-auth-service.js';
import { logPerfEvent } from './config/perf-logging.js';
import { renderDocx } from './domain/docx-exporter.js';
import { GitHubAppClient } from './infrastructure/github/github-app-client.js';
import { GitHubSetupFlow } from './infrastructure/github/github-setup-flow.js';
import { HostedWorkspaceService } from './domain/hosted-workspace.js';
import { PlantUmlRenderer } from './infrastructure/plantuml/plantuml-renderer.js';
import { StructurizrWorkspaceService } from './infrastructure/structurizr/structurizr-workspace-service.js';
import { createRequestHandler } from './infrastructure/http/create-request-handler.js';
import { AgentConnectionStore } from './infrastructure/persistence/agent-connection-store.js';
import { HostedMetadataStore } from './infrastructure/persistence/hosted-metadata-store.js';
import { attachCollaborationGateway } from './infrastructure/websocket/attach-collaboration-gateway.js';
import { createSignedCookieManager } from './auth/session-cookie.js';
import { createVaultRegistry } from './vault-registry.js';

function getDisplayHost(host) {
  return host === '127.0.0.1' ? 'localhost' : host;
}

function closeHttpServer(httpServer) {
  return new Promise((resolve, reject) => {
    httpServer.close((error) => {
      if (error) {
        reject(error);
        return;
      }

      resolve();
    });

    if (typeof httpServer.closeIdleConnections === 'function') {
      httpServer.closeIdleConnections();
    }
  });
}

export function createAppServer(config = loadConfig()) {
  const authService = createAuthService(config);
  const hostedWorkspaceService = new HostedWorkspaceService({
    claim: config.hosted?.claim,
    enabled: config.hosted?.enabled,
    store: config.hosted?.enabled
      ? new HostedMetadataStore({ dbPath: config.hosted.metadataDbPath })
      : null,
  });
  const githubAppClient = config.hosted?.enabled
    ? new GitHubAppClient(config.hosted.githubApp)
    : null;
  const githubSetupFlow = config.hosted?.enabled
    ? new GitHubSetupFlow({
        cookieManager: createSignedCookieManager({
          cookieName: config.hosted.githubApp.flowCookieName,
          cookiePath: config.basePath || '/',
          secret: config.auth.sessionSecret,
        }),
        githubAppClient,
      })
    : null;
  const testControls = {
    wsRoomHydrateDelayMs: Math.max(0, Number(config.testWsRoomHydrateDelayMs || 0)),
  };
  // ponytail: one live context per vault; agent/hosted/structurizr stay on the primary this slice
  const vaultRegistry = createVaultRegistry({ config, testControls });
  const primary = vaultRegistry.getPrimaryContext();
  const vaultFileStore = primary.vaultFileStore;
  const backlinkIndex = primary.backlinkIndex;
  const baseQueryService = primary.baseQueryService;
  const gitService = primary.gitService;
  const searchService = primary.searchService;
  const roomRegistry = primary.roomRegistry;
  const workspaceMutationCoordinator = primary.workspaceMutationCoordinator;
  const fileSystemSyncService = primary.fileSystemSyncService;
  const plantUmlRenderer = new PlantUmlRenderer({
    serverUrl: config.plantumlServerUrl,
  });
  const structurizrWorkspaceService = new StructurizrWorkspaceService({
    mirrorDir: config.structurizr?.mirrorDir || resolve(config.vaultDir, '.collabmd/structurizr'),
    serverUrl: config.structurizr?.serverUrl || '',
    trustedExecutableDsl: config.structurizr?.trustedExecutableDsl,
    vaultDir: config.vaultDir,
  });
  const agentConnectionStore = new AgentConnectionStore({
    dbPath: config.agentAccess.dbPath,
  });
  const agentConnectionService = new AgentConnectionService({
    authStrategy: config.auth.strategy,
    connectionTtlMs: config.agentAccess.connectionTtlMs,
    hostedWorkspaceService,
    store: agentConnectionStore,
  });
  const agentContentService = new AgentContentService({
    backlinkIndex,
    baseQueryService,
    plantUmlRenderer,
    roomRegistry,
    searchService,
    vaultFileStore,
    workspaceMutationCoordinator,
  });
  const requestHandler = createRequestHandler(
    config,
    authService,
    vaultFileStore,
    backlinkIndex,
    baseQueryService,
    renderDocx,
    roomRegistry,
    plantUmlRenderer,
    gitService,
    searchService,
    testControls,
    workspaceMutationCoordinator,
    fileSystemSyncService,
    hostedWorkspaceService,
    githubSetupFlow,
    structurizrWorkspaceService,
    {
      connectionService: agentConnectionService,
      contentService: agentContentService,
    },
    vaultRegistry,
  );
  const httpServer = createServer((req, res) => {
    requestHandler(req, res).catch((error) => {
      console.error('[http] Unhandled request error:', error.message);
      if (!res.headersSent) {
        res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      }
      res.end('Internal Server Error');
    });
  });
  httpServer.headersTimeout = config.httpHeadersTimeoutMs;
  httpServer.keepAliveTimeout = config.httpKeepAliveTimeoutMs;
  httpServer.requestTimeout = config.httpRequestTimeoutMs;
  const collaborationGateway = attachCollaborationGateway({
    authService,
    basePath: config.basePath,
    heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
    maxPayload: config.wsMaxPayloadBytes,
    httpServer,
    roomRegistry,
    wsBasePath: config.wsBasePath,
    hostedWorkspaceService,
    vaultRegistry,
  });

  let shutdownPromise = null;
  let vaultFileCount = 0;

  async function listen() {
    const startupStartedAt = Date.now();

    await hostedWorkspaceService.initialize();
    if (config.agentAccess.enabled && config.auth.strategy !== 'none') {
      await agentConnectionService.initialize();
    }

    const { searchCapability, snapshot: liveWorkspaceSnapshot, vaultFileCount: primaryFileCount } = await vaultRegistry.initializePrimary();
    config.search = searchCapability;
    vaultFileCount = primaryFileCount;

    return new Promise((resolve, reject) => {
      const listenStartedAt = Date.now();
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        const result = {
          address,
          host: getDisplayHost(config.host),
          port: typeof address === 'object' && address ? address.port : config.port,
          wsPath: `${config.basePath || ''}${config.wsBasePath}/:file`,
        };
        logPerfEvent(config.perfLoggingEnabled, 'startup', {
          durationMs: Date.now() - listenStartedAt,
          phase: 'listen',
          port: result.port,
        });
        logPerfEvent(config.perfLoggingEnabled, 'startup-total', {
          durationMs: Date.now() - startupStartedAt,
          markdownFileCount: liveWorkspaceSnapshot.markdownPaths?.length ?? 0,
          vaultFileCount,
        });
        resolve({
          ...result,
        });
      });
    });
  }

  async function close() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = (async () => {
      await collaborationGateway.close();
      await vaultRegistry.closeAll();
      await Promise.all([
        closeHttpServer(httpServer),
        config.git?.cleanup?.(),
        hostedWorkspaceService.close(),
        config.agentAccess.enabled && config.auth.strategy !== 'none'
          ? agentConnectionStore.close()
          : Promise.resolve(),
      ]);
    })().then(() => undefined);

    return shutdownPromise;
  }

  return {
    close,
    agentConnectionService,
    agentContentService,
    collaborationGateway,
    config,
    httpServer,
    listen,
    roomRegistry,
    workspaceMutationCoordinator,
    authService,
    backlinkIndex,
    fileSystemSyncService,
    gitService,
    hostedWorkspaceService,
    searchService,
    structurizrWorkspaceService,
    setTestHydrateDelayMs(delayMs = 0) {
      testControls.wsRoomHydrateDelayMs = Math.max(0, Number(delayMs) || 0);
    },
    vaultFileStore,
    vaultRegistry,
    get vaultFileCount() { return vaultFileCount; },
  };
}
