import { resolveApiUrl } from '../domain/runtime-paths.js';

export function createSearchParams(values = {}) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value != null && value !== '') {
      params.set(key, String(value));
    }
  }
  return params;
}

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

export function apiRequest(path, {
  body = null,
  config,
  fallback = 'Request failed',
  headers = null,
  method = 'GET',
  query = null,
  rawBody = false,
  requestId = null,
  signal,
} = {}) {
  const queryString = query ? createSearchParams(query).toString() : '';
  const url = resolveApiUrl(queryString ? `${path}?${queryString}` : path, config);
  const resolvedHeaders = createRequestHeaders(requestId, {
    ...(body !== null && !rawBody ? { 'Content-Type': 'application/json' } : {}),
    ...(headers ?? {}),
  });
  const init = { method };
  if (body !== null) {
    init.body = rawBody ? body : JSON.stringify(body);
  }
  if (Object.keys(resolvedHeaders).length > 0) {
    init.headers = resolvedHeaders;
  }
  if (signal) {
    init.signal = signal;
  }
  return fetch(url, init).then((response) => parseApiResponse(response, fallback));
}
