import { createServer } from 'http';

import { loadConfig } from './config/env.js';
import { createAuthService } from './auth/create-auth-service.js';
import { BacklinkIndex } from './domain/backlink-index.js';
import { CollaborationDocumentStore } from './domain/collaboration/collaboration-document-store.js';
import { CollaborationRoom } from './domain/collaboration/collaboration-room.js';
import { PlantUmlRenderer } from './domain/plantuml-renderer.js';
import { RoomRegistry } from './domain/collaboration/room-registry.js';
import { createRequestHandler } from './infrastructure/http/create-request-handler.js';
import { VaultFileStore } from './infrastructure/persistence/vault-file-store.js';
import { attachCollaborationGateway } from './infrastructure/websocket/attach-collaboration-gateway.js';

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
  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => new CollaborationRoom({
      documentStore: new CollaborationDocumentStore({
        backlinkIndex: name === '__lobby__' ? null : backlinkIndex,
        name,
        vaultFileStore: name === '__lobby__' ? null : vaultFileStore,
      }),
      idleGraceMs: config.wsRoomIdleGraceMs,
      maxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
      name,
      onEmpty,
    }),
  });
  const requestHandler = createRequestHandler(
    config,
    authService,
    vaultFileStore,
    backlinkIndex,
    roomRegistry,
    plantUmlRenderer,
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

    return new Promise((resolve, reject) => {
      httpServer.once('error', reject);
      httpServer.listen(config.port, config.host, () => {
        httpServer.off('error', reject);
        const address = httpServer.address();
        resolve({
          address,
          host: getDisplayHost(config.host),
          port: typeof address === 'object' && address ? address.port : config.port,
          wsPath: `${config.wsBasePath}/:file`,
        });
      });
    });
  }

  async function close() {
    if (shutdownPromise) {
      return shutdownPromise;
    }

    shutdownPromise = Promise.all([
      collaborationGateway.close(),
      closeHttpServer(httpServer),
    ]).then(() => undefined);

    return shutdownPromise;
  }

  return {
    close,
    collaborationGateway,
    config,
    httpServer,
    listen,
    roomRegistry,
    authService,
    vaultFileStore,
    get vaultFileCount() { return vaultFileCount; },
  };
}
