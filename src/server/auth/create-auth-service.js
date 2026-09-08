import { createSessionCookieManager, createSignedCookieManager } from './session-cookie.js';
import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  SUPPORTED_AUTH_STRATEGIES,
  createRandomAuthPassword,
  createRandomSessionSecret,
} from './auth-constants.js';
import {
  buildClientConfig,
  createResponse,
  createUnauthorizedBody,
} from './auth-common.js';
import {
  createNoneStrategy,
  createOidcStrategy,
  createPasswordStrategy,
} from './auth-strategies.js';

export {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  SUPPORTED_AUTH_STRATEGIES,
  createRandomAuthPassword,
  createRandomSessionSecret,
};

export function createAuthService(config) {
  const authConfig = config.auth ?? { strategy: AUTH_STRATEGY_NONE };
  const clientConfig = buildClientConfig(authConfig, {
    basePath: config.basePath ?? '',
  });
  const sessionCookieManager = createSessionCookieManager({
    cookieName: authConfig.sessionCookieName,
    cookiePath: config.basePath || '/',
    secret: authConfig.sessionSecret,
  });

  let strategy;
  if (authConfig.strategy === AUTH_STRATEGY_PASSWORD) {
    strategy = createPasswordStrategy(authConfig, sessionCookieManager, clientConfig);
  } else if (authConfig.strategy === AUTH_STRATEGY_OIDC) {
    const flowCookieManager = createSignedCookieManager({
      cookieName: authConfig.oidc.flowCookieName,
      cookiePath: config.basePath || '/',
      secret: authConfig.sessionSecret,
    });
    strategy = createOidcStrategy(
      authConfig,
      sessionCookieManager,
      flowCookieManager,
      clientConfig,
      { basePath: config.basePath ?? '' },
    );
  } else {
    strategy = createNoneStrategy(clientConfig);
  }

  return {
    authorizeApiRequest(req) {
      if (strategy.isAuthenticated(req)) {
        return { ok: true };
      }

      return {
        body: createUnauthorizedBody(clientConfig),
        ok: false,
        statusCode: 401,
      };
    },

    authorizeWebSocketRequest(req) {
      // Browsers always send Origin; clients without it still need authentication.
      if (req.headers.origin !== undefined) {
        let allowed = false;
        try {
          const protocol = req.socket?.encrypted || req.headers['x-forwarded-proto'] === 'https'
            ? 'https:' : 'http:';
          const expectedOrigin = authConfig.oidc?.publicBaseUrl
            ? new URL(authConfig.oidc.publicBaseUrl).origin
            : new URL(`${protocol}//${req.headers.host}`).origin;
          allowed = req.headers.origin === expectedOrigin;
        } catch {
          // Malformed or opaque origins are forbidden.
        }
        if (!allowed) {
          return { ok: false, statusCode: 403, statusMessage: 'Forbidden', body: 'Origin not allowed' };
        }
      }
      if (strategy.isAuthenticated(req)) {
        const expiresAt = authConfig.strategy === AUTH_STRATEGY_NONE
          ? null : sessionCookieManager.readSession(req)?.expiresAt;
        return { ok: true, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
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

    beginOidcLogin(req, requestUrl) {
      if (authConfig.strategy !== AUTH_STRATEGY_OIDC || typeof strategy.beginLogin !== 'function') {
        return createResponse(404, { error: 'OIDC endpoint not found' }, { kind: 'not_found' });
      }

      return strategy.beginLogin(req, requestUrl);
    },

    clearSession(req) {
      return strategy.clearSession(req);
    },

    completeOidcLogin(req, requestUrl) {
      if (authConfig.strategy !== AUTH_STRATEGY_OIDC || typeof strategy.completeLogin !== 'function') {
        return createResponse(404, { error: 'OIDC endpoint not found' }, { kind: 'not_found' });
      }

      return strategy.completeLogin(req, requestUrl);
    },

    createSession(req, body) {
      return strategy.createSession(req, body);
    },

    getAuthenticatedUser(req) {
      return strategy.getAuthenticatedUser(req);
    },

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

    getStatus(req) {
      return strategy.getStatus(req);
    },
  };
}
