import { readFile } from 'fs/promises';
import { extname, normalize, resolve } from 'path';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function isExcalidrawPath(filePath) {
  return typeof filePath === 'string' && filePath.toLowerCase().endsWith('.excalidraw');
}

const SECURITY_HEADERS = {
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
};
const REQUEST_BODY_LIMIT_BYTES = 8_388_608;
const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

function buildRuntimeConfig({ nodeEnv, publicWsBaseUrl, wsBasePath }) {
  return `window.__COLLABMD_CONFIG__ = ${JSON.stringify({
    environment: nodeEnv,
    publicWsBaseUrl,
    wsBasePath,
  })};\n`;
}

function setHeaders(res, headers) {
  for (const [key, value] of Object.entries(headers)) {
    res.setHeader(key, value);
  }
}

function createStaticFileReader() {
  const cache = new Map();

  return async function readStaticFile(filePath) {
    if (!cache.has(filePath)) {
      cache.set(filePath, readFile(filePath).catch((error) => {
        cache.delete(filePath);
        throw error;
      }));
    }

    return cache.get(filePath);
  };
}

function resolvePublicFile(publicDir, pathname) {
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.[/\\])+/, '');
  const absolutePath = resolve(publicDir, `.${safePath}`);
  const publicRoot = publicDir.endsWith('/') ? publicDir : `${publicDir}/`;

  if (!absolutePath.startsWith(publicRoot) && absolutePath !== resolve(publicDir, 'index.html')) {
    return null;
  }

  return absolutePath;
}

function createRequestError(statusCode, message) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

function isSameOriginWriteRequest(req, requestUrl) {
  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  try {
    const originUrl = new URL(origin);
    return originUrl.host === requestUrl.host;
  } catch {
    return false;
  }
}

function applyCorsHeaders(res, origin) {
  if (!origin) {
    return;
  }

  setHeaders(res, {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  });
}

async function readRequestBody(req, maxBytes = REQUEST_BODY_LIMIT_BYTES) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    let done = false;

    const finish = (callback, value) => {
      if (done) {
        return;
      }

      done = true;
      req.off('data', onData);
      req.off('end', onEnd);
      req.off('error', onError);
      callback(value);
    };

    const onData = (chunk) => {
      size += chunk.length;
      if (size > maxBytes) {
        req.resume();
        finish(reject, createRequestError(413, 'Request body too large'));
        return;
      }
      chunks.push(chunk);
    };

    const onEnd = () => {
      finish(resolve, Buffer.concat(chunks).toString('utf-8'));
    };

    const onError = (error) => {
      finish(reject, error);
    };

    req.on('data', onData);
    req.on('end', onEnd);
    req.on('error', onError);
  });
}

async function parseJsonBody(req) {
  const rawBody = await readRequestBody(req);

  try {
    return JSON.parse(rawBody);
  } catch {
    throw createRequestError(400, 'Invalid JSON payload');
  }
}

function handleRequestError(res, error) {
  if (!Number.isInteger(error?.statusCode)) {
    return false;
  }

  jsonResponse(res, error.statusCode, { error: error.message });
  return true;
}

function jsonResponse(res, statusCode, data) {
  const body = JSON.stringify(data);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  });
  res.end(body);
}

export function createRequestHandler(config, vaultFileStore, backlinkIndex, roomRegistry = null) {
  const readStaticFile = createStaticFileReader();

  return async function handleRequest(req, res) {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const isSameOriginWrite = isSameOriginWriteRequest(req, requestUrl);

    setHeaders(res, SECURITY_HEADERS);

    if (req.method === 'OPTIONS') {
      const requestedMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
      const preflightTargetsWrite = WRITE_METHODS.has(requestedMethod);
      if (preflightTargetsWrite && !isSameOriginWrite) {
        jsonResponse(res, 403, { error: 'Cross-origin write requests are not allowed' });
        return;
      }

      if (isSameOriginWrite) {
        applyCorsHeaders(res, req.headers.origin);
      }

      res.writeHead(204);
      res.end();
      return;
    }

    if (WRITE_METHODS.has(req.method) && !isSameOriginWrite) {
      jsonResponse(res, 403, { error: 'Cross-origin write requests are not allowed' });
      return;
    }

    // Health check
    if (requestUrl.pathname === '/health') {
      res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('ok');
      return;
    }

    // Runtime config
    if (requestUrl.pathname === '/app-config.js') {
      const body = buildRuntimeConfig(config);
      res.writeHead(200, {
        'Cache-Control': 'no-store',
        'Content-Type': 'text/javascript; charset=utf-8',
      });
      res.end(req.method === 'HEAD' ? undefined : body);
      return;
    }

    // === Vault API ===

    // GET /api/files — file tree
    if (requestUrl.pathname === '/api/files' && req.method === 'GET') {
      try {
        const tree = await vaultFileStore.tree();
        jsonResponse(res, 200, { tree });
      } catch (error) {
        console.error('[api] Failed to read file tree:', error.message);
        jsonResponse(res, 500, { error: 'Failed to read file tree' });
      }
      return;
    }

    // GET /api/file?path=... — read file (markdown or excalidraw)
    if (requestUrl.pathname === '/api/file' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        jsonResponse(res, 400, { error: 'Missing path parameter' });
        return;
      }

      try {
        const content = isExcalidrawPath(filePath)
          ? await vaultFileStore.readExcalidrawFile(filePath)
          : await vaultFileStore.readMarkdownFile(filePath);
        if (content === null) {
          jsonResponse(res, 404, { error: 'File not found' });
          return;
        }
        jsonResponse(res, 200, { path: filePath, content });
      } catch (error) {
        console.error('[api] Failed to read file:', error.message);
        jsonResponse(res, 500, { error: 'Failed to read file' });
      }
      return;
    }

    // PUT /api/file — write/update file (markdown or excalidraw)
    if (requestUrl.pathname === '/api/file' && req.method === 'PUT') {
      try {
        const body = await parseJsonBody(req);
        if (!body.path || typeof body.content !== 'string') {
          jsonResponse(res, 400, { error: 'Missing path or content' });
          return;
        }
        const result = isExcalidrawPath(body.path)
          ? await vaultFileStore.writeExcalidrawFile(body.path, body.content)
          : await vaultFileStore.writeMarkdownFile(body.path, body.content);
        if (!result.ok) {
          jsonResponse(res, 400, { error: result.error });
          return;
        }
        jsonResponse(res, 200, { ok: true });
      } catch (error) {
        if (handleRequestError(res, error)) {
          return;
        }
        console.error('[api] Failed to write file:', error.message);
        jsonResponse(res, 500, { error: 'Failed to write file' });
      }
      return;
    }

    // POST /api/file — create new file
    if (requestUrl.pathname === '/api/file' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.path) {
          jsonResponse(res, 400, { error: 'Missing path' });
          return;
        }
        const result = await vaultFileStore.createFile(body.path, body.content || '');
        if (!result.ok) {
          jsonResponse(res, 409, { error: result.error });
          return;
        }
        backlinkIndex?.onFileCreated(body.path, body.content || '');
        jsonResponse(res, 201, { ok: true, path: body.path });
      } catch (error) {
        if (handleRequestError(res, error)) {
          return;
        }
        console.error('[api] Failed to create file:', error.message);
        jsonResponse(res, 500, { error: 'Failed to create file' });
      }
      return;
    }

    // DELETE /api/file?path=... — delete file
    if (requestUrl.pathname === '/api/file' && req.method === 'DELETE') {
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        jsonResponse(res, 400, { error: 'Missing path parameter' });
        return;
      }

      const activeRoom = roomRegistry?.get(filePath);
      try {
        activeRoom?.markDeleted?.();
        const result = await vaultFileStore.deleteFile(filePath);
        if (!result.ok) {
          activeRoom?.unmarkDeleted?.();
          jsonResponse(res, 400, { error: result.error });
          return;
        }
        backlinkIndex?.onFileDeleted(filePath);
        jsonResponse(res, 200, { ok: true });
      } catch (error) {
        activeRoom?.unmarkDeleted?.();
        console.error('[api] Failed to delete file:', error.message);
        jsonResponse(res, 500, { error: 'Failed to delete file' });
      }
      return;
    }

    // PATCH /api/file — rename/move file
    if (requestUrl.pathname === '/api/file' && req.method === 'PATCH') {
      try {
        const body = await parseJsonBody(req);
        if (!body.oldPath || !body.newPath) {
          jsonResponse(res, 400, { error: 'Missing oldPath or newPath' });
          return;
        }
        const result = await vaultFileStore.renameFile(body.oldPath, body.newPath);
        if (!result.ok) {
          jsonResponse(res, 400, { error: result.error });
          return;
        }
        roomRegistry?.rename(body.oldPath, body.newPath);
        backlinkIndex?.onFileRenamed(body.oldPath, body.newPath);
        jsonResponse(res, 200, { ok: true, path: body.newPath });
      } catch (error) {
        if (handleRequestError(res, error)) {
          return;
        }
        console.error('[api] Failed to rename file:', error.message);
        jsonResponse(res, 500, { error: 'Failed to rename file' });
      }
      return;
    }

    // POST /api/directory — create directory
    if (requestUrl.pathname === '/api/directory' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.path) {
          jsonResponse(res, 400, { error: 'Missing path' });
          return;
        }
        const result = await vaultFileStore.createDirectory(body.path);
        if (!result.ok) {
          jsonResponse(res, 400, { error: result.error });
          return;
        }
        jsonResponse(res, 201, { ok: true });
      } catch (error) {
        if (handleRequestError(res, error)) {
          return;
        }
        console.error('[api] Failed to create directory:', error.message);
        jsonResponse(res, 500, { error: 'Failed to create directory' });
      }
      return;
    }

    // GET /api/backlinks?file=... — backlinks for a file
    if (requestUrl.pathname === '/api/backlinks' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('file');
      if (!filePath) {
        jsonResponse(res, 400, { error: 'Missing file parameter' });
        return;
      }

      try {
        const backlinks = backlinkIndex
          ? await backlinkIndex.getBacklinks(filePath)
          : [];
        jsonResponse(res, 200, { file: filePath, backlinks });
      } catch (error) {
        console.error('[api] Failed to get backlinks:', error.message);
        jsonResponse(res, 500, { error: 'Failed to get backlinks' });
      }
      return;
    }

    // === Static file serving ===

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Method Not Allowed');
      return;
    }

    let filePath = resolvePublicFile(config.publicDir, requestUrl.pathname);
    if (!filePath && !extname(requestUrl.pathname)) {
      filePath = resolve(config.publicDir, 'index.html');
    }

    if (!filePath) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    try {
      const file = await readStaticFile(filePath);
      const extension = extname(filePath);
      const isAsset = requestUrl.pathname.startsWith('/assets/');

      res.writeHead(200, {
        'Cache-Control': isAsset ? 'public, max-age=31536000, immutable' : 'no-store',
        'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
      });

      if (req.method === 'HEAD') {
        res.end();
        return;
      }

      res.end(file);
    } catch (error) {
      if (error?.code === 'ENOENT') {
        res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
        res.end('Not Found');
        return;
      }

      console.error(`[http] Failed to serve "${requestUrl.pathname}":`, error.message);
      res.writeHead(500, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Internal Server Error');
    }
  };
}
