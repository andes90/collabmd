import { resolveApiUrl } from '../domain/runtime-paths.js';

function encodeHeaderMetadata(value) {
  return encodeURIComponent(String(value ?? ''));
}

function createRequestHeaders(requestId, headers = {}) {
  const nextHeaders = { ...headers };
  if (requestId) {
    nextHeaders['X-CollabMD-Request-Id'] = String(requestId);
  }

  return nextHeaders;
}

async function parseApiResponse(response, fallbackError) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok || data.ok === false) {
    const error = new Error(data.error || fallbackError);
    error.status = response.status;
    error.body = data;
    throw error;
  }

  return data;
}

export class VaultApiClient {
  async readTree() {
    const response = await fetch(resolveApiUrl('/files'));
    return parseApiResponse(response, 'Failed to load file tree');
  }

  async readFile(path) {
    const response = await fetch(resolveApiUrl(`/file?path=${encodeURIComponent(path)}`));
    return parseApiResponse(response, 'Failed to read file');
  }

  async createFile({ content, path, requestId = null }) {
    const response = await fetch(resolveApiUrl('/file'), {
      body: JSON.stringify({ content, path }),
      headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to create file');
  }

  async writeFile({ content, path, requestId = null }) {
    const response = await fetch(resolveApiUrl('/file'), {
      body: JSON.stringify({ content, path }),
      headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      method: 'PUT',
    });
    return parseApiResponse(response, 'Failed to write file');
  }

  async renameFile({ oldPath, newPath, requestId = null }) {
    const response = await fetch(resolveApiUrl('/file'), {
      body: JSON.stringify({ newPath, oldPath }),
      headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      method: 'PATCH',
    });
    return parseApiResponse(response, 'Failed to rename file');
  }

  async deleteFile(path, { requestId = null } = {}) {
    const response = await fetch(resolveApiUrl(`/file?path=${encodeURIComponent(path)}`), {
      headers: requestId ? createRequestHeaders(requestId) : undefined,
      method: 'DELETE',
    });
    return parseApiResponse(response, 'Failed to delete file');
  }

  async createDirectory(path, { requestId = null } = {}) {
    const response = await fetch(resolveApiUrl('/directory'), {
      body: JSON.stringify({ path }),
      headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to create folder');
  }

  async renameDirectory({ oldPath, newPath, requestId = null }) {
    const response = await fetch(resolveApiUrl('/directory'), {
      body: JSON.stringify({ newPath, oldPath }),
      headers: createRequestHeaders(requestId, { 'Content-Type': 'application/json' }),
      method: 'PATCH',
    });
    return parseApiResponse(response, 'Failed to rename folder');
  }

  async deleteDirectory(path, { recursive = false, requestId = null } = {}) {
    const searchParams = new URLSearchParams({
      path: String(path ?? ''),
    });
    if (recursive) {
      searchParams.set('recursive', '1');
    }

    const response = await fetch(resolveApiUrl(`/directory?${searchParams.toString()}`), {
      headers: requestId ? createRequestHeaders(requestId) : undefined,
      method: 'DELETE',
    });
    return parseApiResponse(response, 'Failed to delete folder');
  }

  async uploadImageAttachment({ file, fileName = '', sourcePath }) {
    const response = await fetch(resolveApiUrl('/attachments'), {
      body: file,
      headers: {
        'Content-Type': file?.type || 'application/octet-stream',
        'X-CollabMD-File-Name': encodeHeaderMetadata(fileName),
        'X-CollabMD-Source-Path': encodeHeaderMetadata(sourcePath),
      },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to upload image');
  }
}

export const vaultApiClient = new VaultApiClient();
