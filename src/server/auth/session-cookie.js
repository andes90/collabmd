import { createHmac, timingSafeEqual } from 'node:crypto';

function decodeBase64Url(value) {
  const normalized = String(value ?? '')
    .replace(/-/g, '+')
    .replace(/_/g, '/');
  const paddingLength = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(`${normalized}${'='.repeat(paddingLength)}`, 'base64');
}

function encodeBase64Url(value) {
  return Buffer.from(value)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
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

function hasSecureRequestHeaders(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] ?? '').toLowerCase();
  return forwardedProto === 'https';
}

export function createSessionCookieManager({
  cookieName,
  secret,
}) {
  function createCookieAttributes(req, { expires = null } = {}) {
    const attributes = [
      'HttpOnly',
      'Path=/',
      'SameSite=Lax',
    ];

    if (hasSecureRequestHeaders(req)) {
      attributes.push('Secure');
    }

    if (expires instanceof Date) {
      attributes.push(`Expires=${expires.toUTCString()}`);
    }

    return attributes;
  }

  return {
    clearSession(req) {
      return [
        `${cookieName}=`,
        ...createCookieAttributes(req, { expires: new Date(0) }),
      ].join('; ');
    },

    createSessionCookie(req, payload) {
      const serializedPayload = JSON.stringify(payload);
      const encodedPayload = encodeBase64Url(serializedPayload);
      const signature = encodeBase64Url(createSignature(encodedPayload, secret));
      return [
        `${cookieName}=${encodedPayload}.${signature}`,
        ...createCookieAttributes(req),
      ].join('; ');
    },

    readSession(req) {
      const token = parseCookieHeader(req.headers.cookie).get(cookieName);
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
    },
  };
}
