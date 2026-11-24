import { createRequestError as createGitRequestError } from '../../shared/http-errors.js';

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
  if (typeof pathValue !== 'string' || !pathValue) {
    throw createGitRequestError(400, 'Missing path parameter');
  }

  if (pathValue.includes('\0') || pathValue.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    throw createGitRequestError(400, 'Invalid path parameter');
  }

  return pathValue;
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
