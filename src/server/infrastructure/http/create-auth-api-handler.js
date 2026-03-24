import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';
import { createRateLimiter } from './rate-limiter.js';
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
  const loginLimiter = createRateLimiter({ maxAttempts: 5, windowMs: 60_000 });

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
      if (!loginLimiter.isAllowed(req)) {
        res.setHeader('Retry-After', '60');
        jsonResponse(req, res, 429, { error: 'Too many login attempts. Try again later.' });
        return true;
      }

      loginLimiter.record(req);

      try {
        const body = await parseJsonBody(req);
        return applyAuthResponse(req, res, await authService.createSession(req, body));
      } catch (error) {
        const statusCode = getRequestErrorStatusCode(error);
        if (statusCode) {
          jsonResponse(req, res, statusCode, { error: error.message });
          return true;
        }

        console.error('[api] Failed to create auth session:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to create auth session' });
        return true;
      }
    }

    if (requestUrl.pathname === '/api/auth/session' && req.method === 'DELETE') {
      return applyAuthResponse(req, res, await authService.clearSession(req));
    }

    jsonResponse(req, res, 404, { error: 'Auth endpoint not found' });
    return true;
  };
}
