import { WebSocketServer } from 'ws';

import { normalizeEmailAddress } from '../../auth/auth-common.js';
import {
  createRequestUrlWithPathname,
  stripBasePath,
} from '../http/http-request-helpers.js';
import { ClientSocketSession } from './client-socket-session.js';

function rejectUpgrade(socket, statusCode, statusMessage, {
  body = '',
  headers = {},
} = {}) {
  if (socket.destroyed) return;

  const headerLines = Object.entries(headers)
    .map(([key, value]) => `${key}: ${value}`)
    .join('\r\n');
  const responseBody = String(body ?? '');
  const contentLengthHeader = responseBody
    ? `Content-Length: ${Buffer.byteLength(responseBody, 'utf8')}\r\n`
    : '';
  socket.write(
    `HTTP/1.1 ${statusCode} ${statusMessage}\r\n${headerLines}${headerLines ? '\r\n' : ''}${contentLengthHeader}\r\n${responseBody}`,
  );
  socket.destroy();
}

// ponytail: /ws/v/:knownId/:room scopes to a vault; anything else stays a legacy primary room.
// A primary-vault file literally at v/<vaultId>/... is shadowed by design.
function extractVaultAndRoom(pathname, wsBasePath, vaultRegistry) {
  const rest = pathname.slice(wsBasePath.length + 1);
  try {
    return decodeVaultAndRoom(rest, vaultRegistry);
  } catch (error) {
    if (error instanceof URIError) return null;
    throw error;
  }
}

function decodeVaultAndRoom(rest, vaultRegistry) {
  if (rest.startsWith('v/')) {
    const after = rest.slice('v/'.length);
    const slashIndex = after.indexOf('/');
    if (slashIndex > 0) {
      const candidate = after.slice(0, slashIndex);
      const roomPart = after.slice(slashIndex + 1);
      if (roomPart && vaultRegistry?.isKnownVaultId(candidate)) {
        return { roomName: decodeURIComponent(roomPart) || 'default', vaultId: candidate };
      }
    }
  }
  return { roomName: decodeURIComponent(rest || 'default'), vaultId: null };
}

export function attachCollaborationGateway({
  authService,
  basePath = '',
  heartbeatIntervalMs,
  hostedWorkspaceService = null,
  httpServer,
  maxPayload,
  roomRegistry,
  vaultRegistry = null,
  wsBasePath,
}) {
  const websocketServer = new WebSocketServer({
    maxPayload,
    noServer: true,
    // Compress large frames (initial sync, pastes); small Yjs updates fall
    // under the default 1024-byte threshold and skip compression.
    perMessageDeflate: true,
  });
  const socketSessions = new Map();
  let isShuttingDown = false;
  let closePromise = null;
  const heartbeatTimer = setInterval(() => {
    websocketServer.clients.forEach((client) => {
      const sessionEntry = socketSessions.get(client);
      const session = sessionEntry?.session;
      if (!session) {
        return;
      }

      if (session.isAlive === false) {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while collecting dead clients.
        }
        return;
      }

      session.markHeartbeatPending();

      try {
        client.ping();
      } catch {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while pinging clients.
        }
      }
    });
  }, heartbeatIntervalMs);
  heartbeatTimer.unref?.();

  const unsubscribeHostedAccessChange = hostedWorkspaceService?.onAccessChanged?.(({ email }) => {
    websocketServer.clients.forEach((client) => {
      const entry = socketSessions.get(client);
      if (!entry || entry.userEmail !== email) {
        return;
      }

      try {
        client.close(4003, 'Workspace access changed');
      } catch {
        try {
          client.terminate();
        } catch {
          // Ignore termination errors while closing revoked sessions.
        }
      }
    });
  }) ?? (() => {});

  websocketServer.on('connection', (ws, _req, { expiresAt, room, roomName, targetRegistry, user }) => {
    const session = new ClientSocketSession({
      expiresAt,
      onDisconnected: (disconnectedRoomName) => {
        socketSessions.delete(ws);
        const remaining = targetRegistry.getClientCount(disconnectedRoomName);
        console.log(`[ws] "${disconnectedRoomName}" disconnected (${remaining} active client(s))`);
      },
      onFailed: () => {
        socketSessions.delete(ws);
      },
      room,
      roomName,
      ws,
    });
    socketSessions.set(ws, { session, userEmail: normalizeEmailAddress(user?.email) });
    void session.initialize();
  });

  httpServer.on('upgrade', async (req, socket, head) => {
    if (isShuttingDown) {
      rejectUpgrade(socket, 503, 'Server Shutting Down');
      return;
    }

    let originalRequestUrl;
    try {
      originalRequestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    } catch {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }
    const requestUrl = createRequestUrlWithPathname(
      originalRequestUrl,
      stripBasePath(originalRequestUrl.pathname, basePath),
    );
    const matchesRealtimeRoute =
      requestUrl.pathname === wsBasePath || requestUrl.pathname.startsWith(`${wsBasePath}/`);

    if (!matchesRealtimeRoute || requestUrl.pathname === wsBasePath) {
      rejectUpgrade(socket, 404, 'Not Found');
      return;
    }

    const roomTarget = extractVaultAndRoom(requestUrl.pathname, wsBasePath, vaultRegistry);
    if (!roomTarget) {
      rejectUpgrade(socket, 400, 'Bad Request');
      return;
    }

    const authResult = authService.authorizeWebSocketRequest(req, requestUrl);
    if (!authResult.ok) {
      rejectUpgrade(socket, authResult.statusCode, authResult.statusMessage, authResult);
      return;
    }

    const user = authService.getAuthenticatedUser?.(req) ?? null;
    const onSocketError = () => socket.destroy();
    socket.on('error', onSocketError);
    try {
      const hostedAuthResult = await hostedWorkspaceService?.authorizeWorkspaceAccess?.({ user });
      if (hostedAuthResult && !hostedAuthResult.ok) {
        rejectUpgrade(socket, hostedAuthResult.statusCode, 'Forbidden', {
          body: hostedAuthResult.body?.error || 'Workspace access denied',
          headers: {
            'Content-Type': 'text/plain; charset=utf-8',
          },
        });
        return;
      }

      const { roomName, vaultId } = roomTarget;
      const targetRegistry = vaultId
        ? (await vaultRegistry.getOrCreateContextAsync(vaultId)).roomRegistry
        : roomRegistry;
      if (socket.destroyed) return;
      if (isShuttingDown) {
        rejectUpgrade(socket, 503, 'Server Shutting Down');
        return;
      }

      websocketServer.handleUpgrade(req, socket, head, (ws) => {
        let room;
        try {
          room = targetRegistry.getOrCreate(roomName);
        } catch {
          ws.close(1011, 'Room unavailable');
          return;
        }
        websocketServer.emit('connection', ws, req, {
          expiresAt: authResult.expiresAt,
          room,
          roomName,
          targetRegistry,
          user,
        });
      });
    } catch (error) {
      if (error.statusCode === 404) {
        rejectUpgrade(socket, 404, 'Not Found');
      } else {
        rejectUpgrade(socket, 503, 'Service Unavailable');
      }
    } finally {
      socket.off('error', onSocketError);
    }
  });

  async function close() {
    if (closePromise) {
      return closePromise;
    }

    isShuttingDown = true;
    clearInterval(heartbeatTimer);
    unsubscribeHostedAccessChange();

    closePromise = new Promise((resolve, reject) => {
      const forceCloseTimer = setTimeout(() => {
        websocketServer.clients.forEach((client) => {
          try {
            client.terminate();
          } catch {
            // Ignore termination errors during forced shutdown.
          }
        });
      }, 1000);
      forceCloseTimer.unref?.();

      websocketServer.close((error) => {
        clearTimeout(forceCloseTimer);

        if (error) {
          reject(error);
          return;
        }

        resolve();
      });

      websocketServer.clients.forEach((client) => {
        try {
          client.close(1001, 'Server shutting down');
        } catch {
          // Ignore close errors during shutdown.
        }
      });
    });

    return closePromise;
  }

  return {
    close,
    websocketServer,
  };
}
