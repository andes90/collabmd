import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import { jsonResponse } from '../infrastructure/http/http-response.js';
import { parseJsonBody } from '../infrastructure/http/request-body.js';
import { createSessionCookieManager } from './session-cookie.js';

export const AUTH_STRATEGY_NONE = 'none';
export const AUTH_STRATEGY_PASSWORD = 'password';
export const AUTH_STRATEGY_OIDC = 'oidc';

export const SUPPORTED_AUTH_STRATEGIES = new Set([
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_PASSWORD,
  AUTH_STRATEGY_OIDC,
]);

export function createRandomAuthPassword(length = 18) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = randomBytes(length);
  let password = '';

  for (let index = 0; index < length; index += 1) {
    password += alphabet[bytes[index] % alphabet.length];
  }

  return password;
}

export function createRandomSessionSecret() {
  return randomBytes(32).toString('base64url');
}

function hashPassword(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

function createUnauthorizedBody(clientConfig, {
  error = 'Authentication required',
  code = 'AUTH_REQUIRED',
} = {}) {
  return {
    auth: clientConfig,
    code,
    error,
  };
}

function buildClientConfig(authConfig) {
  if (authConfig.strategy === AUTH_STRATEGY_NONE) {
    return {
      enabled: false,
      implemented: true,
      requiresLogin: false,
      sessionEndpoint: '/api/auth/session',
      statusEndpoint: '/api/auth/status',
      strategy: AUTH_STRATEGY_NONE,
    };
  }

  if (authConfig.strategy === AUTH_STRATEGY_PASSWORD) {
    return {
      enabled: true,
      implemented: true,
      passwordLabel: 'Host password',
      requiresLogin: true,
      sessionEndpoint: '/api/auth/session',
      statusEndpoint: '/api/auth/status',
      strategy: AUTH_STRATEGY_PASSWORD,
      submitLabel: 'Join session',
    };
  }

  return {
    enabled: true,
    implemented: false,
    requiresLogin: true,
    sessionEndpoint: '/api/auth/session',
    statusEndpoint: '/api/auth/status',
    strategy: AUTH_STRATEGY_OIDC,
  };
}

function createPasswordStrategy(authConfig, sessionCookieManager, clientConfig) {
  const expectedPasswordHash = hashPassword(authConfig.password);

  function hasValidSession(req) {
    const session = sessionCookieManager.readSession(req);
    return session?.strategy === AUTH_STRATEGY_PASSWORD;
  }

  return {
    async handleAuthApiRequest(req, res, requestUrl) {
      if (requestUrl.pathname === '/api/auth/status' && req.method === 'GET') {
        jsonResponse(req, res, 200, {
          authenticated: hasValidSession(req),
          auth: clientConfig,
        });
        return true;
      }

      if (requestUrl.pathname === '/api/auth/session' && req.method === 'POST') {
        const body = await parseJsonBody(req);
        if (typeof body.password !== 'string' || !body.password) {
          jsonResponse(req, res, 400, { error: 'Missing password' });
          return true;
        }

        const submittedPasswordHash = hashPassword(body.password);
        const isValidPassword = submittedPasswordHash.length === expectedPasswordHash.length
          && timingSafeEqual(submittedPasswordHash, expectedPasswordHash);

        if (!isValidPassword) {
          jsonResponse(req, res, 401, {
            auth: clientConfig,
            code: 'AUTH_INVALID_CREDENTIALS',
            error: 'Incorrect password',
          });
          return true;
        }

        const setCookie = sessionCookieManager.createSessionCookie(req, {
          authenticatedAt: Date.now(),
          strategy: AUTH_STRATEGY_PASSWORD,
        });

        res.setHeader('Set-Cookie', setCookie);
        jsonResponse(req, res, 200, {
          auth: clientConfig,
          authenticated: true,
          ok: true,
        });
        return true;
      }

      if (requestUrl.pathname === '/api/auth/session' && req.method === 'DELETE') {
        res.setHeader('Set-Cookie', sessionCookieManager.clearSession(req));
        jsonResponse(req, res, 200, { ok: true });
        return true;
      }

      return false;
    },

    isAuthenticated(req) {
      return hasValidSession(req);
    },
  };
}

function createNoneStrategy(clientConfig) {
  return {
    async handleAuthApiRequest(req, res, requestUrl) {
      if (requestUrl.pathname === '/api/auth/status' && req.method === 'GET') {
        jsonResponse(req, res, 200, {
          authenticated: true,
          auth: clientConfig,
        });
        return true;
      }

      if (requestUrl.pathname === '/api/auth/session' && req.method === 'DELETE') {
        jsonResponse(req, res, 200, { ok: true });
        return true;
      }

      if (requestUrl.pathname === '/api/auth/session' && req.method === 'POST') {
        jsonResponse(req, res, 405, { error: 'Authentication is disabled' });
        return true;
      }

      return false;
    },

    isAuthenticated() {
      return true;
    },
  };
}

function createOidcStrategy(clientConfig, sessionCookieManager) {
  return {
    async handleAuthApiRequest(req, res, requestUrl) {
      if (requestUrl.pathname === '/api/auth/status' && req.method === 'GET') {
        jsonResponse(req, res, 200, {
          authenticated: false,
          auth: clientConfig,
        });
        return true;
      }

      if (requestUrl.pathname === '/api/auth/session' && req.method === 'DELETE') {
        res.setHeader('Set-Cookie', sessionCookieManager.clearSession(req));
        jsonResponse(req, res, 200, { ok: true });
        return true;
      }

      if (requestUrl.pathname === '/api/auth/session' && req.method === 'POST') {
        jsonResponse(req, res, 501, {
          auth: clientConfig,
          code: 'AUTH_NOT_IMPLEMENTED',
          error: 'OIDC authentication is not implemented yet',
        });
        return true;
      }

      return false;
    },

    isAuthenticated(req) {
      const session = sessionCookieManager.readSession(req);
      return session?.strategy === AUTH_STRATEGY_OIDC;
    },
  };
}

export function createAuthService(config) {
  const authConfig = config.auth ?? { strategy: AUTH_STRATEGY_NONE };
  const clientConfig = buildClientConfig(authConfig);
  const sessionCookieManager = createSessionCookieManager({
    cookieName: authConfig.sessionCookieName,
    secret: authConfig.sessionSecret,
  });

  let strategy;
  if (authConfig.strategy === AUTH_STRATEGY_PASSWORD) {
    strategy = createPasswordStrategy(authConfig, sessionCookieManager, clientConfig);
  } else if (authConfig.strategy === AUTH_STRATEGY_OIDC) {
    strategy = createOidcStrategy(clientConfig, sessionCookieManager);
  } else {
    strategy = createNoneStrategy(clientConfig);
  }

  return {
    getClientConfig() {
      return clientConfig;
    },

    getStartupInfo() {
      return {
        generatedPassword: authConfig.generatedPassword || '',
        password: authConfig.password || '',
        passwordWasGenerated: Boolean(authConfig.passwordWasGenerated),
        strategy: authConfig.strategy,
      };
    },

    async handleAuthApiRequest(req, res, requestUrl) {
      const handled = await strategy.handleAuthApiRequest(req, res, requestUrl);
      if (handled) {
        return true;
      }

      if (requestUrl.pathname === '/api/auth' || requestUrl.pathname.startsWith('/api/auth/')) {
        jsonResponse(req, res, 404, { error: 'Auth endpoint not found' });
        return true;
      }

      return false;
    },

    requireApiAuthentication(req, res) {
      if (strategy.isAuthenticated(req)) {
        return true;
      }

      jsonResponse(req, res, 401, createUnauthorizedBody(clientConfig));
      return false;
    },

    authorizeWebSocketRequest(req) {
      if (strategy.isAuthenticated(req)) {
        return { ok: true };
      }

      return {
        body: 'Authentication required',
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
        },
        ok: false,
        statusCode: 401,
        statusMessage: 'Unauthorized',
      };
    },
  };
}
