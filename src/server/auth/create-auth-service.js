import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

import * as oidc from 'openid-client';

import { createSessionCookieManager, createSignedCookieManager } from './session-cookie.js';

export const AUTH_STRATEGY_NONE = 'none';
export const AUTH_STRATEGY_PASSWORD = 'password';
export const AUTH_STRATEGY_OIDC = 'oidc';

export const SUPPORTED_AUTH_STRATEGIES = new Set([
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_PASSWORD,
  AUTH_STRATEGY_OIDC,
]);

const OIDC_FLOW_TTL_MS = 10 * 60 * 1000;
const OIDC_PROVIDER_GOOGLE = 'google';

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

function createResponse(statusCode, body, options = {}) {
  return {
    body,
    kind: options.kind || 'response',
    redirectTo: options.redirectTo || '',
    setCookie: options.setCookie || null,
    statusCode,
  };
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

function prependBasePath(basePath, pathname) {
  if (!basePath) {
    return pathname;
  }

  return pathname === '/' ? basePath : `${basePath}${pathname}`;
}

function appendHashParam(path, key, value, publicBaseUrl) {
  const url = new URL(path, publicBaseUrl);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  hashParams.set(key, value);
  url.hash = hashParams.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

function getDefaultReturnTo(basePath) {
  return basePath ? `${basePath}/` : '/';
}

function sanitizeReturnTo(rawValue, { basePath = '', publicBaseUrl = '' } = {}) {
  const fallback = getDefaultReturnTo(basePath);
  const candidate = String(rawValue ?? '').trim();
  if (!candidate) {
    return fallback;
  }

  try {
    const resolved = new URL(candidate, `${publicBaseUrl || 'http://localhost'}/`);
    const publicOrigin = publicBaseUrl ? new URL(publicBaseUrl).origin : resolved.origin;
    if (resolved.origin !== publicOrigin) {
      return fallback;
    }

    if (basePath) {
      const withinBasePath = resolved.pathname === basePath || resolved.pathname.startsWith(`${basePath}/`);
      if (!withinBasePath) {
        return fallback;
      }
    }

    return `${resolved.pathname}${resolved.search}${resolved.hash}`;
  } catch {
    return fallback;
  }
}

function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

function normalizeEmailAddress(value) {
  return String(value ?? '').trim().toLowerCase();
}

function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return '';
  }

  return normalized.slice(atIndex + 1);
}

function isOidcUserAllowed(oidcConfig, email) {
  const normalizedEmail = normalizeEmailAddress(email);
  const emailDomain = getEmailDomain(normalizedEmail);
  const allowedEmails = Array.isArray(oidcConfig?.allowedEmails) ? oidcConfig.allowedEmails : [];
  const allowedDomains = Array.isArray(oidcConfig?.allowedDomains) ? oidcConfig.allowedDomains : [];

  if (allowedEmails.length === 0 && allowedDomains.length === 0) {
    return { allowed: true };
  }

  if (allowedEmails.includes(normalizedEmail)) {
    return { allowed: true, reason: 'email' };
  }

  if (allowedDomains.includes(emailDomain)) {
    return { allowed: true, reason: 'domain' };
  }

  return {
    allowed: false,
    error: allowedEmails.length > 0 && allowedDomains.length > 0
      ? 'This Google account is not in the allowed email or domain list.'
      : allowedEmails.length > 0
        ? 'This Google account is not in the allowed email list.'
        : 'This Google account is not in an allowed domain.',
  };
}

function readAuthenticatedOidcSession(sessionCookieManager, req) {
  const session = sessionCookieManager.readSession(req);
  if (session?.strategy !== AUTH_STRATEGY_OIDC) {
    return null;
  }

  const user = session.user;
  if (
    !user
    || typeof user !== 'object'
    || !isNonEmptyString(user.sub)
    || !isNonEmptyString(user.email)
    || !isNonEmptyString(user.name)
  ) {
    return null;
  }

  const expiresAt = Number(session.expiresAt);
  if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
    return null;
  }

  return {
    ...session,
    user: {
      email: user.email,
      emailVerified: user.emailVerified === true,
      name: user.name,
      picture: typeof user.picture === 'string' ? user.picture : '',
      sub: user.sub,
    },
  };
}

function buildClientConfig(authConfig, { basePath = '' } = {}) {
  const loginEndpoint = prependBasePath(basePath, '/api/auth/oidc/login');
  const sessionEndpoint = prependBasePath(basePath, '/api/auth/session');
  const statusEndpoint = prependBasePath(basePath, '/api/auth/status');

  if (authConfig.strategy === AUTH_STRATEGY_NONE) {
    return {
      enabled: false,
      implemented: true,
      requiresLogin: false,
      sessionEndpoint,
      statusEndpoint,
      strategy: AUTH_STRATEGY_NONE,
    };
  }

  if (authConfig.strategy === AUTH_STRATEGY_PASSWORD) {
    return {
      enabled: true,
      implemented: true,
      passwordLabel: 'Host password',
      requiresLogin: true,
      sessionEndpoint,
      statusEndpoint,
      strategy: AUTH_STRATEGY_PASSWORD,
      submitLabel: 'Join session',
    };
  }

  return {
    enabled: true,
    implemented: true,
    loginEndpoint,
    provider: OIDC_PROVIDER_GOOGLE,
    requiresLogin: true,
    sessionEndpoint,
    statusEndpoint,
    strategy: AUTH_STRATEGY_OIDC,
    submitLabel: 'Continue with Google',
  };
}

function createPasswordStrategy(authConfig, sessionCookieManager, clientConfig) {
  const expectedPasswordHash = hashPassword(authConfig.password);
  const sessionTtlMs = Number(authConfig.sessionTtlMs) || 24 * 60 * 60 * 1000;

  function hasValidSession(req) {
    const session = sessionCookieManager.readSession(req);
    if (session?.strategy !== AUTH_STRATEGY_PASSWORD) {
      return false;
    }

    const authenticatedAt = Number(session.authenticatedAt);
    if (Number.isFinite(authenticatedAt) && (Date.now() - authenticatedAt) > sessionTtlMs) {
      return false;
    }

    return true;
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

      const authenticatedAt = Date.now();
      return createResponse(200, {
        auth: clientConfig,
        authenticated: true,
        ok: true,
        user: null,
      }, {
        kind: 'session_created',
        setCookie: sessionCookieManager.createSessionCookie(req, {
          authenticatedAt,
          strategy: AUTH_STRATEGY_PASSWORD,
        }, {
          expires: new Date(authenticatedAt + sessionTtlMs),
        }),
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

function createNoneStrategy(clientConfig) {
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

function createOidcStrategy(authConfig, sessionCookieManager, flowCookieManager, clientConfig, { basePath = '' } = {}) {
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
          || claims.email_verified !== true
          || !isNonEmptyString(claims.name)
        ) {
          return createErrorRedirect(req, 'Google account is missing a verified email or name.', flowPayload);
        }

        const accessDecision = isOidcUserAllowed(authConfig.oidc, claims.email);
        if (!accessDecision.allowed) {
          return createErrorRedirect(req, accessDecision.error, flowPayload);
        }

        const expiresAt = Number.isFinite(claims.exp)
          ? claims.exp * 1000
          : Date.now() + (Math.max(Number(tokens.expires_in) || 3600, 1) * 1000);
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
            }),
            flowCookieManager.clear(req),
          ],
        });
      } catch (error) {
        console.error('[auth] OIDC callback failed:', error.message);
        return createErrorRedirect(req, 'Google sign-in failed. Try again.', flowPayload);
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
