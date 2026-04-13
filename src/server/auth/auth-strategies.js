import { timingSafeEqual } from 'node:crypto';

import * as oidc from 'openid-client';

import {
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  OIDC_FLOW_TTL_MS,
} from './auth-constants.js';
import {
  appendHashParam,
  createResponse,
  createSessionCookieOptions,
  hasExpiredSession,
  hashPassword,
  isNonEmptyString,
  isOidcUserAllowed,
  readAuthenticatedOidcSession,
  resolveSessionExpiresAt,
  sanitizeReturnTo,
} from './auth-common.js';

export function createPasswordStrategy(authConfig, sessionCookieManager, clientConfig) {
  const expectedPasswordHash = hashPassword(authConfig.password);

  function hasValidSession(req) {
    const session = sessionCookieManager.readSession(req);
    return session?.strategy === AUTH_STRATEGY_PASSWORD && !hasExpiredSession(session);
  }

  return {
    clearSession(req) {
      return createResponse(200, { ok: true }, {
        kind: 'logout_ok',
        setCookie: sessionCookieManager.clearSession(req),
      });
    },

    createSession(req, body = {}) {
      if (typeof body.password !== 'string' || !body.password) {
        return createResponse(400, { error: 'Missing password' }, { kind: 'invalid_request' });
      }

      const submittedPasswordHash = hashPassword(body.password);
      const isValidPassword = submittedPasswordHash.length === expectedPasswordHash.length
        && timingSafeEqual(submittedPasswordHash, expectedPasswordHash);

      if (!isValidPassword) {
        return createResponse(401, {
          auth: clientConfig,
          code: 'AUTH_INVALID_CREDENTIALS',
          error: 'Incorrect password',
        }, { kind: 'invalid_credentials' });
      }

      const expiresAt = resolveSessionExpiresAt(authConfig.sessionMaxAgeMs);

      return createResponse(200, {
        auth: clientConfig,
        authenticated: true,
        ok: true,
        user: null,
      }, {
        kind: 'session_created',
        setCookie: sessionCookieManager.createSessionCookie(req, {
          authenticatedAt: Date.now(),
          ...(Number.isFinite(expiresAt) ? { expiresAt } : {}),
          strategy: AUTH_STRATEGY_PASSWORD,
        }, createSessionCookieOptions(expiresAt)),
      });
    },

    getAuthenticatedUser() {
      return null;
    },

    getStatus(req) {
      return createResponse(200, {
        authenticated: hasValidSession(req),
        auth: clientConfig,
        user: null,
      }, { kind: 'status' });
    },

    isAuthenticated(req) {
      return hasValidSession(req);
    },
  };
}

export function createNoneStrategy(clientConfig) {
  return {
    clearSession() {
      return createResponse(200, { ok: true, user: null }, { kind: 'logout_ok' });
    },

    createSession() {
      return createResponse(405, { error: 'Authentication is disabled' }, { kind: 'disabled' });
    },

    getAuthenticatedUser() {
      return null;
    },

    getStatus() {
      return createResponse(200, {
        authenticated: true,
        auth: clientConfig,
        user: null,
      }, { kind: 'status' });
    },

    isAuthenticated() {
      return true;
    },
  };
}

export function createOidcStrategy(authConfig, sessionCookieManager, flowCookieManager, clientConfig, { basePath = '' } = {}) {
  let oidcConfigPromise = null;

  function clearOidcCookies(req, includeSession = true) {
    const cookies = [flowCookieManager.clear(req)];
    if (includeSession) {
      cookies.unshift(sessionCookieManager.clearSession(req));
    }
    return cookies;
  }

  function createErrorRedirect(req, message, flowPayload = null) {
    const returnTo = sanitizeReturnTo(flowPayload?.returnTo, {
      basePath,
      publicBaseUrl: authConfig.oidc.publicBaseUrl,
    });
    return createResponse(302, null, {
      kind: 'redirect',
      redirectTo: appendHashParam(returnTo, 'auth_error', message, authConfig.oidc.publicBaseUrl),
      setCookie: clearOidcCookies(req),
    });
  }

  async function getOidcConfiguration() {
    if (!oidcConfigPromise) {
      const allowInsecureRequests = new URL(authConfig.oidc.issuer).protocol !== 'https:';
      oidcConfigPromise = oidc.discovery(
        new URL(authConfig.oidc.issuer),
        authConfig.oidc.clientId,
        authConfig.oidc.clientSecret,
        undefined,
        allowInsecureRequests
          ? { execute: [oidc.allowInsecureRequests] }
          : undefined,
      ).catch((error) => {
        oidcConfigPromise = null;
        throw error;
      });
    }

    return oidcConfigPromise;
  }

  function getAuthenticatedSession(req) {
    return readAuthenticatedOidcSession(sessionCookieManager, req);
  }

  function getAuthenticatedUser(req) {
    return getAuthenticatedSession(req)?.user ?? null;
  }

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
        kind: 'redirect',
        redirectTo: redirectTo.href,
        setCookie: flowCookieManager.create(req, {
          createdAt: Date.now(),
          nonce,
          pkceCodeVerifier: codeVerifier,
          returnTo,
          state,
        }, {
          expires: new Date(Date.now() + OIDC_FLOW_TTL_MS),
        }),
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

      if (
        !isNonEmptyString(flowPayload.state)
        || !isNonEmptyString(flowPayload.nonce)
        || !isNonEmptyString(flowPayload.pkceCodeVerifier)
      ) {
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

        if (
          !claims
          || !isNonEmptyString(claims.sub)
          || !isNonEmptyString(claims.email)
          || claims.email_verified === false
          || !isNonEmptyString(claims.name)
        ) {
          return createErrorRedirect(req, 'Sign-in failed: the provider did not return a verified email or name.', flowPayload);
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
          kind: 'redirect',
          redirectTo: returnTo,
          setCookie: [
            sessionCookieManager.createSessionCookie(req, {
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
        return createErrorRedirect(req, 'Sign-in failed. Try again.', flowPayload);
      }
    },

    clearSession(req) {
      return createResponse(200, { ok: true, user: null }, {
        kind: 'logout_ok',
        setCookie: clearOidcCookies(req),
      });
    },

    createSession() {
      return createResponse(405, {
        auth: clientConfig,
        code: 'AUTH_LOGIN_REDIRECT_REQUIRED',
        error: 'Use the OIDC login endpoint to authenticate.',
      }, { kind: 'invalid_request' });
    },

    getAuthenticatedUser,

    getStatus(req) {
      const user = getAuthenticatedUser(req);
      return createResponse(200, {
        authenticated: Boolean(user),
        auth: clientConfig,
        user,
      }, { kind: 'status' });
    },

    isAuthenticated(req) {
      return Boolean(getAuthenticatedSession(req));
    },
  };
}
