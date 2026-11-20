import { createHmac, timingSafeEqual } from 'node:crypto';
import { resolveRequestProtocol } from './auth-common.js';

function decodeBase64Url(value) {
  return Buffer.from(String(value ?? ''), 'base64url');
}

function encodeBase64Url(value) {
  return Buffer.from(value).toString('base64url');
}

function parseCookieHeader(headerValue) {
  const cookies = new Map();
  const rawPairs = String(headerValue ?? '').split(';');

  for (const rawPair of rawPairs) {
    const separatorIndex = rawPair.indexOf('=');
    if (separatorIndex <= 0) {
      continue;
    }

    const key = rawPair.slice(0, separatorIndex).trim();
    const value = rawPair.slice(separatorIndex + 1).trim();
    if (!key) {
      continue;
    }

    cookies.set(key, value);
  }

  return cookies;
}

function createSignature(payload, secret) {
  return createHmac('sha256', secret).update(payload).digest();
}

export function createSignedCookieManager({
  cookieName,
  cookiePath = '/',
  secret,
}) {
  // Authenticating one request can verify the same cookie several times
  // (strategy check + expiry read + user lookup). Memoize per request object;
  // the cookie-header check keeps it correct if headers ever change.
  const readCache = new WeakMap();

  function readSignedCookie(cookieHeader) {
    const token = parseCookieHeader(cookieHeader).get(cookieName);
    if (!token) {
      return null;
    }

    const separatorIndex = token.lastIndexOf('.');
    if (separatorIndex <= 0) {
      return null;
    }

    const encodedPayload = token.slice(0, separatorIndex);
    const encodedSignature = token.slice(separatorIndex + 1);

    try {
      const expectedSignature = createSignature(encodedPayload, secret);
      const actualSignature = decodeBase64Url(encodedSignature);

      if (actualSignature.length !== expectedSignature.length) {
        return null;
      }

      if (!timingSafeEqual(actualSignature, expectedSignature)) {
        return null;
      }

      const payloadBuffer = decodeBase64Url(encodedPayload);
      const payload = JSON.parse(payloadBuffer.toString('utf8'));
      return payload && typeof payload === 'object' ? payload : null;
    } catch {
      return null;
    }
  }
  function createCookieAttributes(req, { expires = null } = {}) {
    const attributes = [
      'HttpOnly',
      `Path=${cookiePath}`,
      'SameSite=Lax',
    ];

    if (resolveRequestProtocol(req) === 'https:') {
      attributes.push('Secure');
    }

    if (expires instanceof Date) {
      attributes.push(`Expires=${expires.toUTCString()}`);
    }

    return attributes;
  }

  return {
    clear(req) {
      return [
        `${cookieName}=`,
        ...createCookieAttributes(req, { expires: new Date(0) }),
      ].join('; ');
    },

    create(req, payload, { expires = null } = {}) {
      const serializedPayload = JSON.stringify(payload);
      const encodedPayload = encodeBase64Url(serializedPayload);
      const signature = encodeBase64Url(createSignature(encodedPayload, secret));
      return [
        `${cookieName}=${encodedPayload}.${signature}`,
        ...createCookieAttributes(req, { expires }),
      ].join('; ');
    },

    read(req) {
      if (!req || typeof req !== 'object') return null;

      const cookieHeader = req.headers?.cookie;
      const cached = readCache.get(req);
      if (cached && cached.cookieHeader === cookieHeader) {
        return cached.value;
      }

      const value = readSignedCookie(cookieHeader);
      readCache.set(req, { cookieHeader, value });
      return value;
    },
  };
}
