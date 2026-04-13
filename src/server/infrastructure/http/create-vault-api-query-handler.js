import archiver from 'archiver';
import { basename } from 'node:path';

import {
  isBaseFilePath,
  isDrawioFilePath,
  isExcalidrawFilePath,
  isImageAttachmentFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';
import { parseJsonBody } from './request-body.js';
import { jsonResponse, sendResponse, sendStreamResponse } from './http-response.js';

const SVG_MIME_TYPE = 'image/svg+xml';
const SVG_ATTACHMENT_CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox";

function encodeContentDispositionFilename(fileName) {
  return encodeURIComponent(String(fileName ?? ''))
    .replace(/['()*]/g, (character) => `%${character.charCodeAt(0).toString(16).toUpperCase()}`);
}

function createSafeAsciiFilename(fileName) {
  const fallback = String(fileName ?? '')
    .replace(/[^\x20-\x7E]+/g, '_')
    .replace(/["\\]/g, '_')
    .trim();
  return fallback || 'attachment';
}

function createAttachmentHeaders(attachment) {
  const fileName = basename(String(attachment?.path ?? 'attachment'));
  const headers = {
    'Cache-Control': 'private, max-age=300, stale-while-revalidate=3600',
    'Content-Disposition': `inline; filename="${createSafeAsciiFilename(fileName)}"; filename*=UTF-8''${encodeContentDispositionFilename(fileName)}`,
    'Content-Type': attachment.mimeType,
    'X-Content-Type-Options': 'nosniff',
  };

  if (attachment?.mimeType === SVG_MIME_TYPE) {
    headers['Content-Security-Policy'] = SVG_ATTACHMENT_CSP;
  }

  return headers;
}

function createDownloadHeaders(fileName, contentType) {
  return {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${createSafeAsciiFilename(fileName)}"; filename*=UTF-8''${encodeContentDispositionFilename(fileName)}`,
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };
}

function selectReadOperation(vaultFileStore, filePath) {
  if (isExcalidrawFilePath(filePath)) {
    return vaultFileStore.readExcalidrawFile(filePath);
  }

  if (isBaseFilePath(filePath)) {
    return vaultFileStore.readBaseFile(filePath);
  }

  if (isDrawioFilePath(filePath)) {
    return vaultFileStore.readDrawioFile(filePath);
  }

  if (isMermaidFilePath(filePath)) {
    return vaultFileStore.readMermaidFile(filePath);
  }

  if (isPlantUmlFilePath(filePath)) {
    return vaultFileStore.readPlantUmlFile(filePath);
  }

  return vaultFileStore.readMarkdownFile(filePath);
}

async function streamDirectoryArchive(req, res, {
  entries = [],
  rootName = 'archive',
} = {}) {
  const archive = archiver('zip', {
    zlib: {
      level: 6,
    },
  });

  archive.on('warning', (error) => {
    if (error?.code !== 'ENOENT') {
      archive.emit('error', error);
    }
  });

  const responsePromise = sendStreamResponse(req, res, {
    headers: createDownloadHeaders(`${rootName}.zip`, 'application/zip'),
    statusCode: 200,
    stream: archive,
  });

  for (const entry of entries) {
    if (entry.type === 'directory') {
      const directoryName = entry.path
        ? `${rootName}/${entry.path}/`
        : `${rootName}/`;
      archive.append('', { name: directoryName });
      continue;
    }

    archive.file(entry.absolutePath, {
      name: `${rootName}/${entry.path}`,
    });
  }

  await archive.finalize();
  await responsePromise;
}

// --- Route handlers ---

async function handleBaseQuery(req, res, _requestUrl, { baseQueryService }) {
  try {
    if (!baseQueryService?.query) {
      jsonResponse(req, res, 503, { error: 'Bases query service is unavailable' });
      return;
    }

    const body = await parseJsonBody(req);
    const result = await baseQueryService.query({
      activeFilePath: body?.activeFilePath ?? '',
      basePath: body?.path ?? '',
      search: body?.search ?? '',
      source: typeof body?.source === 'string' ? body.source : null,
      sourcePath: body?.sourcePath ?? '',
      view: body?.view ?? '',
    });

    jsonResponse(req, res, 200, { ok: true, result });
  } catch (error) {
    console.error('[api] Failed to query base:', error.message);
    jsonResponse(req, res, 400, { error: error.message || 'Failed to query base' });
  }
}

async function handleBasePropertyValues(req, res, _requestUrl, { baseQueryService }) {
  try {
    if (!baseQueryService?.propertyValues) {
      jsonResponse(req, res, 503, { error: 'Bases query service is unavailable' });
      return;
    }

    const body = await parseJsonBody(req);
    const result = await baseQueryService.propertyValues({
      activeFilePath: body?.activeFilePath ?? '',
      basePath: body?.path ?? '',
      propertyId: body?.propertyId ?? '',
      query: body?.query ?? '',
      source: typeof body?.source === 'string' ? body.source : null,
      sourcePath: body?.sourcePath ?? '',
      view: body?.view ?? '',
    });

    jsonResponse(req, res, 200, { ok: true, result });
  } catch (error) {
    console.error('[api] Failed to read base property values:', error.message);
    jsonResponse(req, res, 400, { error: error.message || 'Failed to read base property values' });
  }
}

async function handleBaseTransform(req, res, _requestUrl, { baseQueryService }) {
  try {
    if (!baseQueryService?.transform) {
      jsonResponse(req, res, 503, { error: 'Bases query service is unavailable' });
      return;
    }

    const body = await parseJsonBody(req);
    const result = await baseQueryService.transform({
      activeFilePath: body?.activeFilePath ?? '',
      basePath: body?.path ?? '',
      mutation: body?.mutation ?? null,
      source: typeof body?.source === 'string' ? body.source : null,
      sourcePath: body?.sourcePath ?? '',
      view: body?.view ?? '',
    });

    jsonResponse(req, res, 200, { ok: true, result });
  } catch (error) {
    console.error('[api] Failed to transform base:', error.message);
    jsonResponse(req, res, 400, { error: error.message || 'Failed to transform base' });
  }
}

async function handleBaseExport(req, res, _requestUrl, { baseQueryService }) {
  try {
    if (!baseQueryService?.query) {
      jsonResponse(req, res, 503, { error: 'Bases query service is unavailable' });
      return;
    }

    const body = await parseJsonBody(req);
    const result = await baseQueryService.query({
      activeFilePath: body?.activeFilePath ?? '',
      basePath: body?.path ?? '',
      includeCsv: true,
      search: body?.search ?? '',
      source: typeof body?.source === 'string' ? body.source : null,
      sourcePath: body?.sourcePath ?? '',
      view: body?.view ?? '',
    });
    const fileName = basename(String(body?.path || body?.sourcePath || 'base')).replace(/\.[^.]+$/u, '') || 'base';
    sendResponse(req, res, {
      body: result.csv,
      headers: {
        'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="${createSafeAsciiFilename(`${fileName}.csv`)}"; filename*=UTF-8''${encodeContentDispositionFilename(`${fileName}.csv`)}`,
        'Content-Type': 'text/csv; charset=utf-8',
        'X-Content-Type-Options': 'nosniff',
      },
      statusCode: 200,
    });
  } catch (error) {
    console.error('[api] Failed to export base CSV:', error.message);
    jsonResponse(req, res, 400, { error: error.message || 'Failed to export base CSV' });
  }
}

async function handleFileTree(req, res, _requestUrl, { vaultFileStore, workspaceMutationCoordinator }) {
  try {
    const tree = workspaceMutationCoordinator?.getWorkspaceTree?.() ?? await vaultFileStore.tree();
    jsonResponse(req, res, 200, { tree });
  } catch (error) {
    console.error('[api] Failed to read file tree:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to read file tree' });
  }
}

async function handleFileRead(req, res, requestUrl, { vaultFileStore }) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  try {
    const content = await selectReadOperation(vaultFileStore, filePath);
    if (content === null) {
      jsonResponse(req, res, 404, { error: 'File not found' });
      return;
    }

    jsonResponse(req, res, 200, { path: filePath, content });
  } catch (error) {
    console.error('[api] Failed to read file:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to read file' });
  }
}

async function handleFileDownload(req, res, requestUrl, { vaultFileStore }) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  try {
    const download = await vaultFileStore.readDownloadFile(filePath);
    if (!download) {
      jsonResponse(req, res, 404, { error: 'File not found' });
      return;
    }

    sendResponse(req, res, {
      body: download.content,
      headers: createDownloadHeaders(
        basename(String(download.path ?? 'download')),
        download.mimeType || 'application/octet-stream',
      ),
      statusCode: 200,
    });
  } catch (error) {
    console.error('[api] Failed to download file:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to download file' });
  }
}

async function handleDirectoryDownload(req, res, requestUrl, { vaultFileStore }) {
  const directoryPath = requestUrl.searchParams.get('path');
  if (!directoryPath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  try {
    const result = await vaultFileStore.listDirectoryEntriesForDownload(directoryPath);
    if (!result.ok) {
      jsonResponse(req, res, result.error === 'Directory not found' ? 404 : 400, { error: result.error });
      return;
    }

    await streamDirectoryArchive(req, res, {
      entries: result.entries,
      rootName: result.rootName || 'archive',
    });
  } catch (error) {
    console.error('[api] Failed to download directory:', error.message);
    if (!res.headersSent) {
      jsonResponse(req, res, 500, { error: 'Failed to download directory' });
    } else {
      res.destroy(error);
    }
  }
}

async function handleAttachmentRead(req, res, requestUrl, { vaultFileStore }) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  if (!isImageAttachmentFilePath(filePath)) {
    jsonResponse(req, res, 400, { error: 'Unsupported attachment path' });
    return;
  }

  try {
    const attachment = await vaultFileStore.readImageAttachmentFile(filePath);
    if (!attachment) {
      jsonResponse(req, res, 404, { error: 'Attachment not found' });
      return;
    }

    sendResponse(req, res, {
      body: attachment.content,
      headers: createAttachmentHeaders(attachment),
      statusCode: 200,
    });
  } catch (error) {
    console.error('[api] Failed to read attachment:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to read attachment' });
  }
}

async function handleBacklinks(req, res, requestUrl, { backlinkIndex }) {
  const filePath = requestUrl.searchParams.get('file');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing file parameter' });
    return;
  }

  try {
    jsonResponse(req, res, 200, {
      backlinks: backlinkIndex ? await backlinkIndex.getBacklinks(filePath) : [],
      file: filePath,
    });
  } catch (error) {
    console.error('[api] Failed to get backlinks:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to get backlinks' });
  }
}

const CONTENT_SEARCH_MIN_LENGTH = 2;
const CONTENT_SEARCH_MAX_RESULTS = 20;
const CONTENT_SEARCH_CONTEXT_CHARS = 120;

function flattenTextFilePaths(nodes, files = []) {
  for (const node of nodes) {
    if (node.type === 'file' || node.type === 'mermaid' || node.type === 'plantuml') {
      files.push(node.path);
    } else if (node.type === 'directory' && Array.isArray(node.children)) {
      flattenTextFilePaths(node.children, files);
    }
  }
  return files;
}

async function handleContentSearch(req, res, requestUrl, { vaultFileStore, workspaceMutationCoordinator }) {
  const query = String(requestUrl.searchParams.get('q') ?? '').trim().toLowerCase();
  if (query.length < CONTENT_SEARCH_MIN_LENGTH) {
    jsonResponse(req, res, 400, { error: `Query must be at least ${CONTENT_SEARCH_MIN_LENGTH} characters` });
    return;
  }

  try {
    const tree = workspaceMutationCoordinator?.getWorkspaceTree?.() ?? await vaultFileStore.tree();
    const filePaths = flattenTextFilePaths(tree);
    const results = [];

    for (const filePath of filePaths) {
      if (results.length >= CONTENT_SEARCH_MAX_RESULTS) break;

      let content;
      try {
        content = await vaultFileStore.readMarkdownFile(filePath);
      } catch {
        continue;
      }
      if (!content) continue;

      const lowerContent = content.toLowerCase();
      const idx = lowerContent.indexOf(query);
      if (idx === -1) continue;

      const start = Math.max(0, idx - Math.floor(CONTENT_SEARCH_CONTEXT_CHARS / 2));
      const end = Math.min(content.length, idx + query.length + Math.ceil(CONTENT_SEARCH_CONTEXT_CHARS / 2));
      let excerpt = content.slice(start, end).replace(/\s+/g, ' ').trim();
      if (start > 0) excerpt = `\u2026${excerpt}`;
      if (end < content.length) excerpt = `${excerpt}\u2026`;

      results.push({ excerpt, filePath });
    }

    jsonResponse(req, res, 200, { results });
  } catch (error) {
    console.error('[api] Content search failed:', error.message);
    jsonResponse(req, res, 500, { error: 'Content search failed' });
  }
}

// --- Route table ---

function createRouteTable(context) {
  return [
    { method: 'POST', path: '/api/base/query', handler: handleBaseQuery },
    { method: 'POST', path: '/api/base/property-values', handler: handleBasePropertyValues },
    { method: 'POST', path: '/api/base/transform', handler: handleBaseTransform },
    { method: 'POST', path: '/api/base/export', handler: handleBaseExport },
    { method: 'GET', path: '/api/files', handler: handleFileTree },
    { method: 'GET', path: '/api/file', handler: handleFileRead },
    { method: 'GET', path: '/api/search', handler: handleContentSearch },
    { method: 'GET', path: '/api/download/file', handler: handleFileDownload },
    { method: 'GET', path: '/api/download/directory', handler: handleDirectoryDownload },
    { method: 'GET', path: '/api/attachment', handler: handleAttachmentRead },
    { method: 'GET', path: '/api/backlinks', handler: handleBacklinks },
  ].map((route) => ({
    ...route,
    handler: (req, res, requestUrl) => route.handler(req, res, requestUrl, context),
  }));
}

export function createVaultApiQueryHandler({
  baseQueryService = null,
  backlinkIndex,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  const context = { baseQueryService, backlinkIndex, vaultFileStore, workspaceMutationCoordinator };
  const routes = createRouteTable(context);

  return async function handleVaultApiQuery(req, res, requestUrl) {
    for (const route of routes) {
      if (req.method === route.method && requestUrl.pathname === route.path) {
        await route.handler(req, res, requestUrl);
        return true;
      }
    }

    return false;
  };
}
