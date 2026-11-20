import { readFile } from 'node:fs/promises';

import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse, sendResponse, textResponse } from './http-response.js';
import { parseJsonBody, readBinaryRequestBody } from './request-body.js';

const EMBED_STYLESHEET_PATH = new URL('../structurizr/structurizr-embed.css', import.meta.url);

function isSyncRequest(requestUrl, req) {
  return requestUrl.pathname === '/api/structurizr/sync' && req.method === 'POST';
}

function isEmbedStylesheetRequest(requestUrl) {
  return requestUrl.pathname === '/api/structurizr/embed.css';
}

function rewriteBasePath(body, contentType, basePath, { injectEmbedStylesheet = false } = {}) {
  if (!/(?:text\/(?:html|css)|javascript|ecmascript)/iu.test(contentType)) {
    return body;
  }

  let source = body.toString('utf8');
  if (basePath) {
    source = source.replace(
      /(["'`(=])\/(static|workspace|api\/workspace)(?=[/"'`?#)])/gu,
      (_match, prefix, segment) => `${prefix}${basePath}/${segment}`,
    );
  }

  if (injectEmbedStylesheet && /text\/html/iu.test(contentType)) {
    const normalizedBasePath = String(basePath || '').replace(/\/+$/u, '');
    const stylesheetPath = `${normalizedBasePath}/api/structurizr/embed.css`;
    source = source.replace(
      /<\/head\s*>/iu,
      (endHead) => `<link rel="stylesheet" href="${stylesheetPath}">\n${endHead}`,
    );
  }

  return Buffer.from(source);
}

export function createStructurizrApiHandler({ basePath = '', service = null } = {}) {
  async function handleRequest(req, res, requestUrl) {
    if (isSyncRequest(requestUrl, req)) {
      try {
        const body = await parseJsonBody(req);
        if (!body || typeof body.path !== 'string') {
          jsonResponse(req, res, 400, { error: 'Missing Structurizr workspace path' });
          return true;
        }

        if (!service?.isEnabled()) {
          jsonResponse(req, res, 503, { error: 'Structurizr renderer is not configured' });
          return true;
        }

        jsonResponse(req, res, 200, await service.sync({
          content: body.source,
          rootPath: body.path,
        }));
      } catch (error) {
        const statusCode = getRequestErrorStatusCode(error) || Number(error?.statusCode) || 502;
        if (statusCode >= 500) {
          console.error('[api] Failed to sync Structurizr workspace:', error.message);
        }
        jsonResponse(req, res, statusCode, {
          code: error?.requestCode,
          error: error instanceof Error ? error.message : 'Failed to sync Structurizr workspace',
        });
      }
      return true;
    }

    if (isEmbedStylesheetRequest(requestUrl)) {
      if (!service?.isEnabled()) {
        return false;
      }

      if (req.method !== 'GET' && req.method !== 'HEAD') {
        textResponse(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
        return true;
      }

      try {
        sendResponse(req, res, {
          body: await readFile(EMBED_STYLESHEET_PATH),
          headers: {
            'Cache-Control': 'no-store',
            'Content-Type': 'text/css; charset=utf-8',
          },
          statusCode: 200,
        });
      } catch (error) {
        console.error('[http] Failed to serve Structurizr embed stylesheet:', error.message);
        textResponse(req, res, 500, 'Internal Server Error');
      }
      return true;
    }

    if (!service?.isProxyPath(requestUrl.pathname)) {
      return false;
    }

    const isThumbnailPut = req.method === 'PUT' && service.isThumbnailPath(requestUrl.pathname);
    if (req.method !== 'GET' && req.method !== 'HEAD' && !isThumbnailPut) {
      textResponse(req, res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return true;
    }

    try {
      const response = await service.proxy(requestUrl, {
        body: isThumbnailPut ? await readBinaryRequestBody(req) : null,
        headers: req.headers,
        method: req.method,
      });
      if (!response) {
        return false;
      }

      sendResponse(req, res, {
        body: rewriteBasePath(response.body, response.contentType, basePath, {
          injectEmbedStylesheet: requestUrl.pathname === '/workspace/1/diagrams',
        }),
        headers: {
          'Cache-Control': requestUrl.pathname.startsWith('/static/')
            ? 'public, max-age=300'
            : 'no-store',
          'Content-Type': response.contentType,
        },
        statusCode: response.statusCode,
      });
    } catch (error) {
      const statusCode = getRequestErrorStatusCode(error) || Number(error?.statusCode) || 502;
      console.error('[http] Failed to proxy Structurizr request:', error.message);
      textResponse(req, res, statusCode, error.message || 'Structurizr renderer unavailable');
    }

    return true;
  }

  handleRequest.requiresAuthorization = (requestUrl) => (
    Boolean(service?.isProxyPath(requestUrl.pathname))
    && !requestUrl.pathname.startsWith('/api/')
  );

  return handleRequest;
}
