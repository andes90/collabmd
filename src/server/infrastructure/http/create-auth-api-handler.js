import { handleApiError } from './http-request-helpers.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

function applyAuthResponse(req, res, result) {
  if (result?.setCookie) {
    res.setHeader('Set-Cookie', result.setCookie);
  }

  if (result?.redirectTo) {
    res.writeHead(result?.statusCode ?? 302, {
      Location: result.redirectTo,
    });
    res.end();
    return true;
  }

  jsonResponse(req, res, result?.statusCode ?? 200, result?.body ?? { ok: true });
  return true;
}

export function createAuthApiHandler({ authService }) {
  return async function handleAuthApi(req, res, requestUrl) {
    if (!(requestUrl.pathname === '/api/auth' || requestUrl.pathname.startsWith('/api/auth/'))) {
      return false;
    }

    if (requestUrl.pathname === '/api/auth/status' && req.method === 'GET') {
      return applyAuthResponse(req, res, authService.getStatus(req));
    }

    if (requestUrl.pathname === '/api/auth/oidc/login' && req.method === 'GET') {
      try {
        return applyAuthResponse(req, res, await authService.beginOidcLogin(req, requestUrl));
      } catch (error) {
        console.error('[api] Failed to start OIDC login:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to start OIDC login' });
        return true;
      }
    }

    if (requestUrl.pathname === '/api/auth/oidc/callback' && req.method === 'GET') {
      try {
        return applyAuthResponse(req, res, await authService.completeOidcLogin(req, requestUrl));
      } catch (error) {
        console.error('[api] Failed to complete OIDC login:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to complete OIDC login' });
        return true;
      }
    }

    if (requestUrl.pathname === '/api/auth/session' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        return applyAuthResponse(req, res, await authService.createSession(req, body));
      } catch (error) {
        return handleApiError(req, res, error, '[api] Failed to create auth session:', 'Failed to create auth session');
      }
    }

    if (requestUrl.pathname === '/api/auth/session' && req.method === 'DELETE') {
      return applyAuthResponse(req, res, await authService.clearSession(req));
    }

    jsonResponse(req, res, 404, { error: 'Auth endpoint not found' });
    return true;
  };
}
