import { timingSafeEqual } from 'node:crypto';
import * as oidc from 'openid-client';

import { createSignedCookieManager } from './session-cookie.js';
import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  OIDC_FLOW_TTL_MS,
} from './auth-constants.js';
import {
  appendHashParam,
  buildClientConfig,
  createResponse,
  createSessionCookieOptions,
  createUnauthorizedBody,
  hasExpiredSession,
  hashPassword,
  isNonEmptyString,
  isOidcUserAllowed,
  readAuthenticatedOidcSession,
  resolveRequestProtocol,
  resolveSessionExpiresAt,
  sanitizeReturnTo,
} from './auth-common.js';

function createPasswordStrategy(authConfig, sessionCookieManager, clientConfig) {
  const expectedPasswordHash = hashPassword(authConfig.password);
  const hasValidSession = (req) => {
    const session = sessionCookieManager.read(req);
    return session?.strategy === AUTH_STRATEGY_PASSWORD && !hasExpiredSession(session);
  };

  return {
    clearSession: (req) => createResponse(200, { ok: true }, { setCookie: sessionCookieManager.clear(req) }),
    createSession(req, body = {}) {
      if (typeof body.password !== 'string' || !body.password) {
        return createResponse(400, { error: 'Missing password' });
      }
      const submittedPasswordHash = hashPassword(body.password);
      const isValidPassword = submittedPasswordHash.length === expectedPasswordHash.length
        && timingSafeEqual(submittedPasswordHash, expectedPasswordHash);
      if (!isValidPassword) {
        return createResponse(401, {
          auth: clientConfig,
          code: 'AUTH_INVALID_CREDENTIALS',
          error: 'Incorrect password',
        });
      }
      const expiresAt = resolveSessionExpiresAt(authConfig.sessionMaxAgeMs);
      return createResponse(200, {
        auth: clientConfig,
        authenticated: true,
        ok: true,
        user: null,
      }, {
        setCookie: sessionCookieManager.create(req, {
          authenticatedAt: Date.now(),
          ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
          strategy: AUTH_STRATEGY_PASSWORD,
        }, createSessionCookieOptions(expiresAt)),
      });
    },
    getAuthenticatedUser: () => null,
    getStatus: (req) => createResponse(200, { authenticated: hasValidSession(req), auth: clientConfig, user: null }),
    isAuthenticated: hasValidSession,
  };
}

function createNoneStrategy(clientConfig) {
  return {
    clearSession: () => createResponse(200, { ok: true, user: null }),
    createSession: () => createResponse(405, { error: 'Authentication is disabled' }),
    getAuthenticatedUser: () => null,
    getStatus: () => createResponse(200, { authenticated: true, auth: clientConfig, user: null }),
    isAuthenticated: () => true,
  };
}

function createOidcStrategy(authConfig, sessionCookieManager, flowCookieManager, clientConfig, { basePath = '' } = {}) {
  let oidcConfigPromise = null;
  const clearOidcCookies = (req, includeSession = true) => (
    includeSession ? [sessionCookieManager.clear(req), flowCookieManager.clear(req)] : [flowCookieManager.clear(req)]
  );
  const createErrorRedirect = (req, message, flowPayload = null) => {
    const returnTo = sanitizeReturnTo(flowPayload?.returnTo, {
      basePath,
      publicBaseUrl: authConfig.oidc.publicBaseUrl,
    });
    return createResponse(302, null, {
      redirectTo: appendHashParam(returnTo, 'auth_error', message, authConfig.oidc.publicBaseUrl),
      setCookie: clearOidcCookies(req),
    });
  };
  const getOidcConfiguration = async () => {
    if (!oidcConfigPromise) {
      const allowInsecureRequests = new URL(authConfig.oidc.issuer).protocol !== 'https:';
      oidcConfigPromise = oidc.discovery(
        new URL(authConfig.oidc.issuer),
        authConfig.oidc.clientId,
        authConfig.oidc.clientSecret,
        undefined,
        allowInsecureRequests ? { execute: [oidc.allowInsecureRequests] } : undefined,
      ).catch((error) => {
        oidcConfigPromise = null;
        throw error;
      });
    }
    return oidcConfigPromise;
  };
  const getAuthenticatedSession = (req) => readAuthenticatedOidcSession(sessionCookieManager, req);
  const getAuthenticatedUser = (req) => getAuthenticatedSession(req)?.user ?? null;

  return {
    async beginLogin(req, requestUrl) {
      const config = await getOidcConfiguration();
      const returnTo = sanitizeReturnTo(requestUrl.searchParams.get('returnTo'), {
        basePath,
        publicBaseUrl: authConfig.oidc.publicBaseUrl,
      });
      const codeVerifier = oidc.randomPKCECodeVerifier();
      const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
      const nonce = oidc.randomNonce();
      const state = oidc.randomState();
      const redirectTo = oidc.buildAuthorizationUrl(config, {
        code_challenge: codeChallenge,
        code_challenge_method: 'S256',
        ...(authConfig.oidc.allowedDomains.length === 1 ? { hd: authConfig.oidc.allowedDomains[0] } : {}),
        nonce,
        redirect_uri: authConfig.oidc.callbackUrl,
        response_type: 'code',
        scope: 'openid email profile',
        state,
      });
      return createResponse(302, null, {
        redirectTo: redirectTo.href,
        setCookie: flowCookieManager.create(req, {
          createdAt: Date.now(),
          nonce,
          pkceCodeVerifier: codeVerifier,
          returnTo,
          state,
        }, { expires: new Date(Date.now() + OIDC_FLOW_TTL_MS) }),
      });
    },

    async completeLogin(req, requestUrl) {
      const flowPayload = flowCookieManager.read(req);
      if (!flowPayload) {
        return createErrorRedirect(req, 'Authentication session expired. Try again.');
      }
      if (requestUrl.searchParams.get('error')) {
        const errorMessage = requestUrl.searchParams.get('error_description')
          || requestUrl.searchParams.get('error')
          || 'Authentication failed';
        return createErrorRedirect(req, errorMessage, flowPayload);
      }
      if (!isNonEmptyString(flowPayload.state) || !isNonEmptyString(flowPayload.nonce) || !isNonEmptyString(flowPayload.pkceCodeVerifier)) {
        return createErrorRedirect(req, 'Authentication session expired. Try again.', flowPayload);
      }

      try {
        const config = await getOidcConfiguration();
        const callbackUrl = new URL(authConfig.oidc.callbackUrl);
        callbackUrl.search = requestUrl.search;
        const tokens = await oidc.authorizationCodeGrant(config, callbackUrl, {
          expectedNonce: flowPayload.nonce,
          expectedState: flowPayload.state,
          idTokenExpected: true,
          pkceCodeVerifier: flowPayload.pkceCodeVerifier,
        });
        const claims = tokens.claims();
        if (!claims || !isNonEmptyString(claims.sub) || !isNonEmptyString(claims.email) || claims.email_verified !== true || !isNonEmptyString(claims.name)) {
          return createErrorRedirect(req, 'Google account is missing a verified email or name.', flowPayload);
        }
        const accessDecision = isOidcUserAllowed(authConfig.oidc, claims.email);
        if (!accessDecision.allowed) {
          return createErrorRedirect(req, accessDecision.error, flowPayload);
        }

        const tokenExpiresAt = Number.isFinite(claims.exp)
          ? claims.exp * 1000
          : Date.now() + (Math.max(Number(tokens.expires_in) || 3600, 1) * 1000);
        const expiresAt = resolveSessionExpiresAt(authConfig.sessionMaxAgeMs, tokenExpiresAt);
        const returnTo = sanitizeReturnTo(flowPayload.returnTo, {
          basePath,
          publicBaseUrl: authConfig.oidc.publicBaseUrl,
        });
        const user = {
          email: claims.email,
          emailVerified: true,
          name: claims.name,
          picture: typeof claims.picture === 'string' ? claims.picture : '',
          sub: claims.sub,
        };
        return createResponse(302, null, {
          redirectTo: returnTo,
          setCookie: [
            sessionCookieManager.create(req, {
              authenticatedAt: Date.now(),
              expiresAt,
              strategy: AUTH_STRATEGY_OIDC,
              user,
            }, createSessionCookieOptions(expiresAt)),
            flowCookieManager.clear(req),
          ],
        });
      } catch (error) {
        console.error('[auth] OIDC callback failed:', error.message);
        return createErrorRedirect(req, 'Google sign-in failed. Try again.', flowPayload);
      }
    },

    clearSession: (req) => createResponse(200, { ok: true, user: null }, { setCookie: clearOidcCookies(req) }),
    createSession: () => createResponse(405, {
      auth: clientConfig,
      code: 'AUTH_LOGIN_REDIRECT_REQUIRED',
      error: 'Use the OIDC login endpoint to authenticate.',
    }),
    getAuthenticatedUser,
    getStatus(req) {
      const user = getAuthenticatedUser(req);
      return createResponse(200, { authenticated: Boolean(user), auth: clientConfig, user });
    },
    isAuthenticated: (req) => Boolean(getAuthenticatedSession(req)),
  };
}

export function createAuthService(config) {
  const authConfig = config.auth ?? { strategy: AUTH_STRATEGY_NONE };
  const clientConfig = buildClientConfig(authConfig, { basePath: config.basePath ?? '' });
  const sessionCookieManager = createSignedCookieManager({
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
      return strategy.isAuthenticated(req)
        ? { ok: true }
        : { body: createUnauthorizedBody(clientConfig), ok: false, statusCode: 401 };
    },

    authorizeWebSocketRequest(req) {
      // Browsers always send Origin; clients without it still need authentication.
      if (req.headers.origin !== undefined) {
        let allowed = false;
        try {
          const protocol = resolveRequestProtocol(req);
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
          ? null : sessionCookieManager.read(req)?.expiresAt;
        return { ok: true, expiresAt: Number.isFinite(expiresAt) ? expiresAt : null };
      }

      return {
        body: 'Authentication required',
        headers: { 'Content-Type': 'text/plain; charset=utf-8' },
        ok: false,
        statusCode: 401,
        statusMessage: 'Unauthorized',
      };
    },

    beginOidcLogin(req, requestUrl) {
      if (authConfig.strategy !== AUTH_STRATEGY_OIDC || typeof strategy.beginLogin !== 'function') {
        return createResponse(404, { error: 'OIDC endpoint not found' });
      }
      return strategy.beginLogin(req, requestUrl);
    },

    clearSession: (req) => strategy.clearSession(req),

    completeOidcLogin(req, requestUrl) {
      if (authConfig.strategy !== AUTH_STRATEGY_OIDC || typeof strategy.completeLogin !== 'function') {
        return createResponse(404, { error: 'OIDC endpoint not found' });
      }
      return strategy.completeLogin(req, requestUrl);
    },

    createSession: (req, body) => strategy.createSession(req, body),
    getAuthenticatedUser: (req) => strategy.getAuthenticatedUser(req),
    getClientConfig: () => clientConfig,
    getStatus: (req) => strategy.getStatus(req),
  };
}
