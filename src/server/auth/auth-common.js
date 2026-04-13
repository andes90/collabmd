import { createHash } from 'node:crypto';

import {
  AUTH_STRATEGY_NONE,
  AUTH_STRATEGY_OIDC,
  AUTH_STRATEGY_PASSWORD,
  OIDC_PROVIDER_GOOGLE,
} from './auth-constants.js';

export function hashPassword(value) {
  return createHash('sha256').update(String(value ?? ''), 'utf8').digest();
}

export function createResponse(statusCode, body, options = {}) {
  return {
    body,
    kind: options.kind || 'response',
    redirectTo: options.redirectTo || '',
    setCookie: options.setCookie || null,
    statusCode,
  };
}

export function createUnauthorizedBody(clientConfig, {
  error = 'Authentication required',
  code = 'AUTH_REQUIRED',
} = {}) {
  return {
    auth: clientConfig,
    code,
    error,
  };
}

export function prependBasePath(basePath, pathname) {
  if (!basePath) {
    return pathname;
  }

  return pathname === '/' ? basePath : `${basePath}${pathname}`;
}

export function appendHashParam(path, key, value, publicBaseUrl) {
  const url = new URL(path, publicBaseUrl);
  const hashParams = new URLSearchParams(url.hash.startsWith('#') ? url.hash.slice(1) : url.hash);
  hashParams.set(key, value);
  url.hash = hashParams.toString();
  return `${url.pathname}${url.search}${url.hash}`;
}

export function getDefaultReturnTo(basePath) {
  return basePath ? `${basePath}/` : '/';
}

export function sanitizeReturnTo(rawValue, { basePath = '', publicBaseUrl = '' } = {}) {
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

export function isNonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0;
}

export function normalizeEmailAddress(value) {
  return String(value ?? '').trim().toLowerCase();
}

export function getEmailDomain(email) {
  const normalized = normalizeEmailAddress(email);
  const atIndex = normalized.lastIndexOf('@');
  if (atIndex <= 0 || atIndex === normalized.length - 1) {
    return '';
  }

  return normalized.slice(atIndex + 1);
}

export function isOidcUserAllowed(oidcConfig, email) {
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
      ? 'This account is not in the allowed email or domain list.'
      : allowedEmails.length > 0
        ? 'This account is not in the allowed email list.'
        : 'This account is not in an allowed domain.',
  };
}

export function hasExpiredSession(session) {
  const expiresAt = Number(session?.expiresAt);
  return Number.isFinite(expiresAt) && expiresAt <= Date.now();
}

export function readAuthenticatedOidcSession(sessionCookieManager, req) {
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

  if (hasExpiredSession(session)) {
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

export function resolveSessionExpiresAt(sessionMaxAgeMs, fallbackExpiresAt = null) {
  if (Number.isFinite(sessionMaxAgeMs) && sessionMaxAgeMs > 0) {
    return Date.now() + sessionMaxAgeMs;
  }

  return Number.isFinite(fallbackExpiresAt) ? fallbackExpiresAt : null;
}

export function createSessionCookieOptions(expiresAt) {
  if (!Number.isFinite(expiresAt)) {
    return {};
  }

  return {
    expires: new Date(expiresAt),
  };
}

export function buildClientConfig(authConfig, { basePath = '' } = {}) {
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
    provider: authConfig.oidc.provider,
    requiresLogin: true,
    sessionEndpoint,
    statusEndpoint,
    strategy: AUTH_STRATEGY_OIDC,
    submitLabel: authConfig.oidc.provider === OIDC_PROVIDER_GOOGLE ? 'Continue with Google' : 'Continue with OIDC',
  };
}
