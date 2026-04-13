import { resolveApiUrl } from '../domain/runtime-paths.js';

function encodeHeaderMetadata(value) {
  return encodeURIComponent(String(value ?? ''));
}

function getPathLeaf(pathValue) {
  return String(pathValue ?? '')
    .replace(/\/+$/u, '')
    .split('/')
    .filter(Boolean)
    .pop() || '';
}

function downloadBlob(blob, fileName) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

function parseDownloadFileName(contentDisposition = '', fallbackName = 'download') {
  const utfMatch = String(contentDisposition).match(/filename\*=UTF-8''([^;]+)/iu);
  if (utfMatch) {
    try {
      return decodeURIComponent(utfMatch[1]);
    } catch {
      return fallbackName;
    }
  }

  const asciiMatch = String(contentDisposition).match(/filename="([^"]+)"/iu);
  return asciiMatch?.[1] || fallbackName;
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

async function triggerDownload(url, {
  fallbackError,
  fallbackFileName,
} = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || fallbackError);
  }

  const blob = await response.blob();
  downloadBlob(
    blob,
    parseDownloadFileName(response.headers.get('content-disposition') || '', fallbackFileName),
  );
  return response;
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

  async searchContent(query) {
    const response = await fetch(resolveApiUrl(`/search?q=${encodeURIComponent(query)}`));
    return parseApiResponse(response, 'Content search failed');
  }

  async queryBase({
    activeFilePath = '',
    path = '',
    search = '',
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    const response = await fetch(resolveApiUrl('/base/query'), {
      body: JSON.stringify({
        activeFilePath,
        path,
        search,
        source,
        sourcePath,
        view,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to query base');
  }

  async exportBaseCsv({
    activeFilePath = '',
    path = '',
    search = '',
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    const response = await fetch(resolveApiUrl('/base/export'), {
      body: JSON.stringify({
        activeFilePath,
        path,
        search,
        source,
        sourcePath,
        view,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || 'Failed to export base CSV');
    }

    return {
      blob: await response.blob(),
      contentDisposition: response.headers.get('content-disposition') || '',
    };
  }

  async queryBasePropertyValues({
    activeFilePath = '',
    path = '',
    propertyId = '',
    query = '',
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    const response = await fetch(resolveApiUrl('/base/property-values'), {
      body: JSON.stringify({
        activeFilePath,
        path,
        propertyId,
        query,
        source,
        sourcePath,
        view,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to load base property values');
  }

  async transformBase({
    activeFilePath = '',
    mutation = null,
    path = '',
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    const response = await fetch(resolveApiUrl('/base/transform'), {
      body: JSON.stringify({
        activeFilePath,
        mutation,
        path,
        source,
        sourcePath,
        view,
      }),
      headers: { 'Content-Type': 'application/json' },
      method: 'POST',
    });
    return parseApiResponse(response, 'Failed to transform base');
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

  async downloadFile(path) {
    const fallbackFileName = getPathLeaf(path) || 'download';
    return triggerDownload(resolveApiUrl(`/download/file?path=${encodeURIComponent(path)}`), {
      fallbackError: 'Failed to download file',
      fallbackFileName,
    });
  }

  async downloadDirectory(path) {
    const directoryName = getPathLeaf(path) || 'vault';
    return triggerDownload(resolveApiUrl(`/download/directory?path=${encodeURIComponent(path)}`), {
      fallbackError: 'Failed to download folder',
      fallbackFileName: `${directoryName}.zip`,
    });
  }
}

export const vaultApiClient = new VaultApiClient();
