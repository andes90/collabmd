import { WebSocketServer } from 'ws';

import { ClientSocketSession } from './client-socket-session.js';

function rejectUpgrade(socket, statusCode, statusMessage, {
  body = '',
  headers = {},
} = {}) {
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

function extractRoomName(pathname, wsBasePath) {
  const roomSegment = pathname.slice(wsBasePath.length + 1);
  const decoded = decodeURIComponent(roomSegment || 'default');
  if (decoded.includes('\0') || decoded.includes('..')) {
    return null;
  }
  return decoded;
}

function stripBasePath(pathname, basePath) {
  if (!basePath) {
    return pathname;
  }

  if (pathname === basePath) {
    return '/';
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || '/';
  }

  return pathname;
}

function createRequestUrlWithPathname(requestUrl, pathname) {
  const nextUrl = new URL(requestUrl.toString());
  nextUrl.pathname = pathname || '/';
  return nextUrl;
}

export function attachCollaborationGateway({
  authService,
  basePath = '',
  heartbeatIntervalMs,
  httpServer,
  maxPayload,
  roomRegistry,
  wsBasePath,
}) {
  const websocketServer = new WebSocketServer({
    maxPayload,
    noServer: true,
    perMessageDeflate: false,
  });
  const socketSessions = new Map();
  let isShuttingDown = false;
  let closePromise = null;
  const heartbeatTimer = setInterval(() => {
    websocketServer.clients.forEach((client) => {
      const session = socketSessions.get(client);
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

  websocketServer.on('connection', (ws, req, requestUrl) => {
    const roomName = extractRoomName(requestUrl.pathname, wsBasePath);
    if (!roomName) {
      ws.close(1008, 'Invalid room name');
      return;
    }
    const room = roomRegistry.getOrCreate(roomName);
    const session = new ClientSocketSession({
      onDisconnected: (disconnectedRoomName) => {
        socketSessions.delete(ws);
        const remaining = roomRegistry.rooms.get(disconnectedRoomName)?.clients.size ?? 0;
        console.log(`[ws] "${disconnectedRoomName}" disconnected (${remaining} active client(s))`);
      },
      onFailed: () => {
        socketSessions.delete(ws);
      },
      room,
      roomName,
      ws,
    });
    socketSessions.set(ws, session);
    void session.initialize();
  });

  httpServer.on('upgrade', (req, socket, head) => {
    if (isShuttingDown) {
      rejectUpgrade(socket, 503, 'Server Shutting Down');
      return;
    }

    const originalRequestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
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

    const authResult = authService.authorizeWebSocketRequest(req, requestUrl);
    if (!authResult.ok) {
      rejectUpgrade(socket, authResult.statusCode, authResult.statusMessage, authResult);
      return;
    }

    websocketServer.handleUpgrade(req, socket, head, (ws) => {
      websocketServer.emit('connection', ws, req, requestUrl);
    });
  });

  async function close() {
    if (closePromise) {
      return closePromise;
    }

    isShuttingDown = true;
    clearInterval(heartbeatTimer);

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
