import { readFile } from 'fs/promises';
import { extname, normalize, resolve } from 'path';

import { sendResponse, textResponse } from './http-response.js';

const CONTENT_TYPES = {
  '.css': 'text/css; charset=utf-8',
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
};

function isVersionedAssetPath(pathname = '') {
  return /-[A-Z0-9]{8,}\.(?:css|js)$/iu.test(pathname);
}

function getStaticCacheControl(pathname = '', extension = '') {
  if (pathname === '/' || pathname.endsWith('.html')) {
    return 'no-store';
  }

  if (pathname === '/app-config.js') {
    return 'no-store';
  }

  if (pathname.startsWith('/assets/')) {
    if (
      pathname.startsWith('/assets/vendor/modules/chunks/')
      || pathname.startsWith('/assets/js/chunks/')
      || isVersionedAssetPath(pathname)
    ) {
      return 'public, max-age=31536000, immutable';
    }

    if (extension === '.css' || extension === '.js') {
      return 'public, max-age=0, must-revalidate';
    }

    return 'public, max-age=300, stale-while-revalidate=3600';
  }

  return 'public, max-age=300';
}

function buildRuntimeConfig({
  auth,
  nodeEnv,
  publicWsBaseUrl,
  wsBasePath,
}) {
  return `window.__COLLABMD_CONFIG__ = ${JSON.stringify({
    auth,
    environment: nodeEnv,
    publicWsBaseUrl,
    wsBasePath,
  })};\n`;
}

function createStaticFileReader({ cacheEnabled = true } = {}) {
  const cache = new Map();

  return async function readStaticFile(filePath) {
    if (!cacheEnabled) {
      return readFile(filePath);
    }

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

export function createStaticHandler(config, authService = null) {
  const readStaticFile = createStaticFileReader({
    cacheEnabled: config.nodeEnv === 'production',
  });

  return async function handleStaticRequest(req, res, requestUrl) {
    if (requestUrl.pathname === '/health') {
      textResponse(req, res, 200, 'ok');
      return true;
    }

    if (requestUrl.pathname === '/app-config.js') {
      const body = buildRuntimeConfig({
        ...config,
        auth: authService?.getClientConfig?.() ?? {
          enabled: false,
          implemented: true,
          requiresLogin: false,
          strategy: 'none',
        },
      });
      sendResponse(req, res, {
        body,
        headers: {
          'Cache-Control': 'no-store',
          'Content-Type': 'text/javascript; charset=utf-8',
        },
        statusCode: 200,
      });
      return true;
    }

    if (req.method !== 'GET' && req.method !== 'HEAD') {
      textResponse(req, res, 405, 'Method Not Allowed');
      return true;
    }

    let filePath = resolvePublicFile(config.publicDir, requestUrl.pathname);
    if (!filePath && !extname(requestUrl.pathname)) {
      filePath = resolve(config.publicDir, 'index.html');
    }

    if (!filePath) {
      textResponse(req, res, 404, 'Not Found');
      return true;
    }

    try {
      const file = await readStaticFile(filePath);
      const extension = extname(filePath);

      sendResponse(req, res, {
        body: file,
        headers: {
          'Cache-Control': getStaticCacheControl(requestUrl.pathname, extension),
          'Content-Type': CONTENT_TYPES[extension] || 'application/octet-stream',
        },
        statusCode: 200,
      });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        textResponse(req, res, 404, 'Not Found');
        return true;
      }

      console.error(`[http] Failed to serve "${requestUrl.pathname}":`, error.message);
      textResponse(req, res, 500, 'Internal Server Error');
    }

    return true;
  };
}
