import { createServer } from 'http';

import { loadConfig } from './config/env.js';
import { BacklinkIndex } from './domain/backlink-index.js';
import { CollaborationRoom } from './domain/collaboration/collaboration-room.js';
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
  const vaultFileStore = new VaultFileStore({ vaultDir: config.vaultDir });
  const backlinkIndex = new BacklinkIndex({ vaultFileStore });
  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => new CollaborationRoom({
      maxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
      name,
      onEmpty,
      // The __lobby__ room is awareness-only (global presence) — no file.
      vaultFileStore: name === '__lobby__' ? null : vaultFileStore,
      backlinkIndex: name === '__lobby__' ? null : backlinkIndex,
    }),
  });
  const requestHandler = createRequestHandler(config, vaultFileStore, backlinkIndex);
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
    heartbeatIntervalMs: config.wsHeartbeatIntervalMs,
    maxPayload: config.wsMaxPayloadBytes,
    httpServer,
    roomRegistry,
    wsBasePath: config.wsBasePath,
  });

  let shutdownPromise = null;
  let vaultFileCount = 0;

  async function listen() {
    vaultFileCount = await vaultFileStore.countMarkdownFiles();
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
    vaultFileStore,
    get vaultFileCount() { return vaultFileCount; },
  };
}
