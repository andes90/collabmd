import { resolveApiUrl } from '../domain/runtime-paths.js';

export function createRequestHeaders(requestId, headers = {}) {
  const nextHeaders = { ...headers };
  if (requestId) {
    nextHeaders['X-CollabMD-Request-Id'] = String(requestId);
  }

  return nextHeaders;
}

export async function parseApiResponse(response, fallbackError) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || fallbackError);
    error.status = response.status;
    error.body = data;
    if (typeof data?.code === 'string') {
      error.code = data.code;
    }
    throw error;
  }

  return data;
}

export function apiRequest(path, { body = null, fallback = 'Request failed', method = 'GET' } = {}) {
  return fetch(resolveApiUrl(path), {
    ...(body === null ? {} : { body: JSON.stringify(body), headers: { 'Content-Type': 'application/json' } }),
    method,
  }).then((response) => parseApiResponse(response, fallback));
}
