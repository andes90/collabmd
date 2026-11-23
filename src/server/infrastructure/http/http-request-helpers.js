import { jsonResponse } from './http-response.js';

export function stripBasePath(pathname, basePath) {
  if (!basePath) {
    return pathname;
  }

  if (pathname === basePath) {
    return '/';
  }

  if (pathname.startsWith(`${basePath}/`)) {
    return pathname.slice(basePath.length) || '/';
  }

  return pathname;
}

export function createRequestUrlWithPathname(requestUrl, pathname) {
  const nextUrl = new URL(requestUrl.toString());
  nextUrl.pathname = pathname || '/';
  return nextUrl;
}

export function readRequestId(req) {
  const value = String(req.headers['x-collabmd-request-id'] || '').trim();
  return value ? value.slice(0, 120) : null;
}

export function handleApiError(req, res, error, logMessage, fallbackMessage, defaultStatusCode = 500) {
  if (Number.isInteger(error?.statusCode)) {
    const payload = { error: error.message };
    if (typeof error?.requestCode === 'string') {
      payload.code = error.requestCode;
    }
    jsonResponse(req, res, error.statusCode, payload);
    return true;
  }

  console.error(logMessage, error.message);
  jsonResponse(req, res, defaultStatusCode, { error: fallbackMessage });
  return true;
}
