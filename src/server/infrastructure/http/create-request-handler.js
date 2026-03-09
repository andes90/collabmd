import { createEsmProxyHandler } from './create-esm-proxy-handler.js';
import { createStaticHandler } from './create-static-handler.js';
import { createVaultApiHandler } from './create-vault-api-handler.js';
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
  roomRegistry = null,
  plantUmlRenderer = null,
) {
  const handleEsmProxy = createEsmProxyHandler();
  const handleStaticRequest = createStaticHandler(config, authService);
  const handleVaultApi = createVaultApiHandler({
    backlinkIndex,
    plantUmlRenderer,
    roomRegistry,
    vaultFileStore,
  });

  return async function handleRequest(req, res) {
    const requestUrl = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const isSameOriginWrite = isSameOriginWriteRequest(req, requestUrl);

    setHeaders(res, SECURITY_HEADERS);

    if (req.method === 'OPTIONS') {
      const requestedMethod = String(req.headers['access-control-request-method'] || '').toUpperCase();
      const preflightTargetsWrite = WRITE_METHODS.has(requestedMethod);
      if (preflightTargetsWrite && !isSameOriginWrite) {
        jsonResponse(req, res, 403, { error: 'Cross-origin write requests are not allowed' });
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
      jsonResponse(req, res, 403, { error: 'Cross-origin write requests are not allowed' });
      return;
    }

    if (await authService.handleAuthApiRequest(req, res, requestUrl)) {
      return;
    }

    if (await handleEsmProxy(req, res, requestUrl)) {
      return;
    }

    if (requestUrl.pathname.startsWith('/api/') && !authService.requireApiAuthentication(req, res)) {
      return;
    }

    if (await handleVaultApi(req, res, requestUrl)) {
      return;
    }

    await handleStaticRequest(req, res, requestUrl);
  };
}
