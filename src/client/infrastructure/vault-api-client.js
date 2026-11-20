import { resolveApiUrl } from '../domain/runtime-paths.js';
import { isPdfFilePath } from '../../domain/file-kind.js';
import { getVaultPathLeaf } from '../domain/vault-paths.js';
import { apiRequest } from './api-client-utils.js';
import { downloadBlob, parseDownloadFileName } from '../browser-utils.js';

function encodeHeaderMetadata(value) {
  return encodeURIComponent(String(value ?? ''));
}

async function triggerDownload(url, { fallbackError, fallbackFileName } = {}) {
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || fallbackError);
  }

  const blob = await response.blob();
  downloadBlob(
    blob,
    parseDownloadFileName(response.headers.get('content-disposition') || '', fallbackFileName),
    { removeDelayMs: 0, revokeDelayMs: 0 },
  );
  return response;
}

export const vaultApiClient = {
  readTree(config) {
    return apiRequest('/files', { config, fallback: 'Failed to load file tree' });
  },

  callAgentTool(name, input, { signal } = {}) {
    return apiRequest(`/agent/tools/${encodeURIComponent(name)}`, {
      body: input,
      fallback: `Failed to execute ${name}`,
      method: 'POST',
      signal,
    });
  },

  readCommentOverview() {
    return apiRequest('/comments/overview', { fallback: 'Failed to load comment overview' });
  },

  readFile(path, config) {
    return apiRequest('/file', { config, fallback: 'Failed to read file', query: { path } });
  },

  async readBacklinks(filePath, { signal } = {}) {
    const data = await apiRequest('/backlinks', {
      fallback: 'Failed to load backlinks',
      query: { file: filePath },
      signal,
    });
    return Array.isArray(data.backlinks) ? data.backlinks : [];
  },

  syncStructurizrWorkspace({ path, source }) {
    return apiRequest('/structurizr/sync', {
      body: { path, source },
      fallback: 'Failed to sync Structurizr workspace',
      method: 'POST',
    });
  },

  async renderSvg(source) {
    const data = await apiRequest('/plantuml/render', {
      body: { source },
      fallback: 'Failed to render PlantUML',
      method: 'POST',
    });
    if (!data.ok || typeof data.svg !== 'string') {
      throw new Error(data.error || 'Failed to render PlantUML');
    }
    return data.svg;
  },

  searchText({ limit = 50, query = '', signal = null } = {}) {
    return apiRequest('/search', {
      fallback: 'Failed to search files',
      query: { limit, q: String(query ?? '') },
      signal,
    });
  },

  queryBase({ activeFilePath = '', path = '', search = '', source = null, sourcePath = '', view = '' } = {}) {
    return apiRequest('/base/query', {
      body: { activeFilePath, path, search, source, sourcePath, view },
      fallback: 'Failed to query base',
      method: 'POST',
    });
  },

  async exportBaseCsv({ activeFilePath = '', path = '', search = '', source = null, sourcePath = '', view = '' } = {}) {
    const response = await fetch(resolveApiUrl('/base/export'), {
      body: JSON.stringify({ activeFilePath, path, search, source, sourcePath, view }),
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
  },

  queryBasePropertyValues({
    activeFilePath = '',
    path = '',
    propertyId = '',
    query = '',
    source = null,
    sourcePath = '',
    view = '',
  } = {}) {
    return apiRequest('/base/property-values', {
      body: { activeFilePath, path, propertyId, query, source, sourcePath, view },
      fallback: 'Failed to load base property values',
      method: 'POST',
    });
  },

  transformBase({ activeFilePath = '', mutation = null, path = '', source = null, sourcePath = '', view = '' } = {}) {
    return apiRequest('/base/transform', {
      body: { activeFilePath, mutation, path, source, sourcePath, view },
      fallback: 'Failed to transform base',
      method: 'POST',
    });
  },

  createFile({ content, path, requestId = null }) {
    return apiRequest('/file', { body: { content, path }, fallback: 'Failed to create file', method: 'POST', requestId });
  },

  writeFile({ content, path, requestId = null }) {
    return apiRequest('/file', { body: { content, path }, fallback: 'Failed to write file', method: 'PUT', requestId });
  },

  renameFile({ oldPath, newPath, requestId = null }) {
    return apiRequest('/file', { body: { newPath, oldPath }, fallback: 'Failed to rename file', method: 'PATCH', requestId });
  },

  deleteFile(path, { requestId = null } = {}) {
    return apiRequest('/file', { fallback: 'Failed to delete file', method: 'DELETE', query: { path }, requestId });
  },

  createDirectory(path, { requestId = null } = {}) {
    return apiRequest('/directory', { body: { path }, fallback: 'Failed to create folder', method: 'POST', requestId });
  },

  renameDirectory({ oldPath, newPath, requestId = null }) {
    return apiRequest('/directory', { body: { newPath, oldPath }, fallback: 'Failed to rename folder', method: 'PATCH', requestId });
  },

  deleteDirectory(path, { recursive = false, requestId = null } = {}) {
    return apiRequest('/directory', {
      fallback: 'Failed to delete folder',
      method: 'DELETE',
      query: { path: String(path ?? ''), recursive: recursive ? '1' : null },
      requestId,
    });
  },

  uploadImageAttachment({ file, fileName = '', sourcePath }) {
    return apiRequest('/attachments', {
      body: file,
      fallback: 'Failed to upload image',
      headers: {
        'Content-Type': file?.type || 'application/octet-stream',
        'X-CollabMD-File-Name': encodeHeaderMetadata(fileName),
        'X-CollabMD-Source-Path': encodeHeaderMetadata(sourcePath),
      },
      method: 'POST',
      rawBody: true,
    });
  },

  uploadFile({ file, path, requestId = null }) {
    return apiRequest('/file/upload', {
      body: file,
      fallback: 'Failed to upload file',
      headers: {
        'Content-Type': isPdfFilePath(path) ? 'application/pdf' : (file?.type || 'application/octet-stream'),
        'X-CollabMD-File-Path': encodeHeaderMetadata(path),
      },
      method: 'POST',
      rawBody: true,
      requestId,
    });
  },

  downloadFile(path) {
    return triggerDownload(resolveApiUrl(`/download/file?path=${encodeURIComponent(path)}`), {
      fallbackError: 'Failed to download file',
      fallbackFileName: getVaultPathLeaf(path) || 'download',
    });
  },

  downloadDirectory(path) {
    const directoryName = getVaultPathLeaf(path) || 'vault';
    return triggerDownload(resolveApiUrl(`/download/directory?path=${encodeURIComponent(path)}`), {
      fallbackError: 'Failed to download folder',
      fallbackFileName: `${directoryName}.zip`,
    });
  },
};
