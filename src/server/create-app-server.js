import { createServer } from 'http';

import { loadConfig } from './config/env.js';
import { createAuthService } from './auth/create-auth-service.js';
import { BacklinkIndex } from './domain/backlink-index.js';
import { CollaborationDocumentStore } from './domain/collaboration/collaboration-document-store.js';
import { CollaborationRoom } from './domain/collaboration/collaboration-room.js';
import { GitService } from './infrastructure/git/git-service.js';
import { PlantUmlRenderer } from './infrastructure/plantuml/plantuml-renderer.js';
import { RoomRegistry } from './domain/collaboration/room-registry.js';
import { createRequestHandler } from './infrastructure/http/create-request-handler.js';
import { VaultFileStore } from './infrastructure/persistence/vault-file-store.js';
import { attachCollaborationGateway } from './infrastructure/websocket/attach-collaboration-gateway.js';
import { isDrawioLeaseRoom } from '../domain/drawio-room.js';
import { WORKSPACE_ROOM_NAME } from '../domain/workspace-room.js';
import { FileSystemSyncService } from './infrastructure/workspace/file-system-sync-service.js';
import { WorkspaceMutationCoordinator } from './infrastructure/workspace/workspace-mutation-coordinator.js';

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
  const vaultFileStore = new VaultFileStore({ vaultDir: config.vaultDir });
  const backlinkIndex = new BacklinkIndex({ vaultFileStore });
  const plantUmlRenderer = new PlantUmlRenderer({
    serverUrl: config.plantumlServerUrl,
  });
  const gitService = new GitService({
    commandEnv: config.git?.commandEnv,
    enabled: config.gitEnabled,
    vaultDir: config.vaultDir,
  });
  const testControls = {
    wsRoomHydrateDelayMs: Math.max(0, Number(config.testWsRoomHydrateDelayMs || 0)),
  };
  let workspaceMutationCoordinator = null;
  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => {
      const isTransientRoom = name === '__lobby__' || name === WORKSPACE_ROOM_NAME || isDrawioLeaseRoom(name);
      const room = new CollaborationRoom({
        documentStore: new CollaborationDocumentStore({
          backlinkIndex: isTransientRoom ? null : backlinkIndex,
          name,
          vaultFileStore: isTransientRoom ? null : vaultFileStore,
        }),
        getHydrateDelayMs: () => testControls.wsRoomHydrateDelayMs,
        idleGraceMs: config.wsRoomIdleGraceMs,
        maxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
        name,
        onEmpty,
      });

      if (name === WORKSPACE_ROOM_NAME && workspaceMutationCoordinator?.workspaceState) {
        room.replaceWorkspaceEntries(workspaceMutationCoordinator.workspaceState.entries, {
          generatedAt: workspaceMutationCoordinator.workspaceState.scannedAt,
        });
      }

      return room;
    },
  });
  workspaceMutationCoordinator = new WorkspaceMutationCoordinator({
    backlinkIndex,
    roomRegistry,
    vaultFileStore,
  });
  vaultFileStore.setManagedWriteTracker(workspaceMutationCoordinator);
  const fileSystemSyncService = new FileSystemSyncService({
    mutationCoordinator: workspaceMutationCoordinator,
    vaultFileStore,
  });
  const requestHandler = createRequestHandler(
    config,
    authService,
    vaultFileStore,
    backlinkIndex,
    roomRegistry,
    plantUmlRenderer,
    gitService,
    testControls,
    workspaceMutationCoordinator,
    fileSystemSyncService,
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
  });

  let shutdownPromise = null;
  let vaultFileCount = 0;

  async function listen() {
    vaultFileCount = await vaultFileStore.countVaultFiles();
    await backlinkIndex.build();
    await workspaceMutationCoordinator.initialize();
    await fileSystemSyncService.start();

    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        resolve({
          address,
          host: getDisplayHost(config.host),
          port: typeof address === 'object' && address ? address.port : config.port,
          wsPath: `${config.basePath || ''}${config.wsBasePath}/:file`,
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
      await fileSystemSyncService.close();
      await roomRegistry.reset();
      await Promise.all([
        closeHttpServer(httpServer),
        config.git?.cleanup?.(),
      ]);
    })().then(() => undefined);

    return shutdownPromise;
  }

  return {
    close,
    collaborationGateway,
    config,
    httpServer,
    listen,
    roomRegistry,
    workspaceMutationCoordinator,
    authService,
    fileSystemSyncService,
    gitService,
    setTestHydrateDelayMs(delayMs = 0) {
      testControls.wsRoomHydrateDelayMs = Math.max(0, Number(delayMs) || 0);
    },
    vaultFileStore,
    get vaultFileCount() { return vaultFileCount; },
  };
}
