import { createRequestError as createGitRequestError } from '../http/http-errors.js';

const PATH_ESCAPES = { a: '\x07', b: '\b', f: '\f', n: '\n', r: '\r', t: '\t', v: '\v' };

export function decodeQuotedPath(pathValue) {
  const rawValue = String(pathValue ?? '');
  if (!(rawValue.startsWith('"') && rawValue.endsWith('"'))) {
    return rawValue;
  }

  return rawValue.slice(1, -1).replace(/\\(?:([0-7]{3}(?:\\[0-7]{3})*)|(["\\abfnrtv]))/gu, (_match, octal, escape) => {
    if (octal) {
      const bytes = octal.split('\\').map((value) => Number.parseInt(value, 8));
      return Buffer.from(bytes).toString('utf8');
    }

    return PATH_ESCAPES[escape] ?? escape;
  });
}

export function normalizeRelativeGitPath(pathValue) {
  const normalized = decodeQuotedPath(pathValue)
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\/+/u, '')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);

  if (normalized.length === 0) {
    throw createGitRequestError(400, 'Missing path parameter');
  }

  if (normalized.some((segment) => segment === '.' || segment === '..')) {
    throw createGitRequestError(400, 'Invalid path parameter');
  }

  return normalized.join('/');
}


export function stripDiffPrefix(pathValue) {
  const normalizedPath = decodeQuotedPath(pathValue);
  if (!normalizedPath || normalizedPath === '/dev/null') {
    return null;
  }

  if (normalizedPath.startsWith('a/') || normalizedPath.startsWith('b/')) {
    return normalizedPath.slice(2);
  }

  return normalizedPath;
}
