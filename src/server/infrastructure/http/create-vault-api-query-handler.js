import { ZipArchive } from 'archiver';
import { readdir } from 'node:fs/promises';
import { basename } from 'node:path';
import { join } from 'node:path';

import { getVaultFileKind, isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { isIgnoredVaultEntry } from '../persistence/path-utils.js';
import { parseJsonBody } from './request-body.js';
import {
  createSafeAsciiFilename,
  encodeContentDispositionFilename,
  jsonResponse,
  sendResponse,
  sendStreamResponse,
} from './http-response.js';

const SVG_MIME_TYPE = 'image/svg+xml';
const SVG_ATTACHMENT_CSP = "default-src 'none'; img-src 'self' data: blob:; style-src 'unsafe-inline'; sandbox";
const DEFAULT_MAX_ARCHIVE_ENTRIES = 10_000;
const DEFAULT_MAX_DOWNLOAD_FILE_BYTES = 268_435_456;

function createSearchCancellation(req, res) {
  const controller = new AbortController();

  const abort = () => {
    if (controller.signal.aborted || res.writableEnded || res.writableFinished) {
      return;
    }

    controller.abort();
  };
  const handleRequestClose = () => {
    if (!req.complete) {
      abort();
    }
  };

  req.once('aborted', abort);
  req.once('close', handleRequestClose);
  res.once('close', abort);

  return {
    cleanup() {
      req.off('aborted', abort);
      req.off('close', handleRequestClose);
      res.off('close', abort);
    },
    signal: controller.signal,
  };
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

function createDownloadHeaders(fileName, contentType, { inline = false } = {}) {
  return {
    'Cache-Control': 'no-store',
    'Content-Disposition': `${inline ? 'inline' : 'attachment'}; filename="${createSafeAsciiFilename(fileName)}"; filename*=UTF-8''${encodeContentDispositionFilename(fileName)}`,
    'Content-Type': contentType,
    'X-Content-Type-Options': 'nosniff',
  };
}

async function streamDirectoryArchive(req, res, {
  maxEntries = 10_000,
  rootAbsolutePath = '',
  rootName = 'archive',
} = {}) {
  const archive = new ZipArchive({
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

  let entryCount = 0;
  const appendEntry = () => {
    entryCount += 1;
    if (entryCount > maxEntries) {
      throw new Error(`Directory archive exceeds ${maxEntries} entries`);
    }
  };

  try {
    const visitDirectory = async (directoryAbsolutePath, relativeDirectoryPath = '') => {
      const dirEntries = (await readdir(directoryAbsolutePath, { withFileTypes: true }))
        .filter((entry) => !isIgnoredVaultEntry(entry.name))
        .sort((left, right) => {
          if (left.isDirectory() && !right.isDirectory()) return -1;
          if (!left.isDirectory() && right.isDirectory()) return 1;
          return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
        });

      if (dirEntries.length === 0) {
        appendEntry();
        archive.append('', {
          name: relativeDirectoryPath ? `${rootName}/${relativeDirectoryPath}/` : `${rootName}/`,
        });
        return;
      }

      for (const entry of dirEntries) {
        const childAbsolutePath = join(directoryAbsolutePath, entry.name);
        const childRelativePath = relativeDirectoryPath
          ? `${relativeDirectoryPath}/${entry.name}`
          : entry.name;

        if (entry.isDirectory()) {
          await visitDirectory(childAbsolutePath, childRelativePath);
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        appendEntry();
        archive.file(childAbsolutePath, {
          name: `${rootName}/${childRelativePath}`,
        });
      }
    };

    await visitDirectory(rootAbsolutePath);
    await archive.finalize();
    await responsePromise;
  } catch (error) {
    archive.destroy(error);
    await responsePromise.catch(() => {});
    throw error;
  }
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

async function handleCommentOverview(req, res, _requestUrl, {
  vaultFileStore,
  workspaceMutationCoordinator,
}) {
  try {
    if (typeof vaultFileStore.readCommentOverview !== 'function') {
      jsonResponse(req, res, 503, { error: 'Comment overview is unavailable' });
      return;
    }

    const workspaceState = await workspaceMutationCoordinator.getWorkspaceStateSnapshot();
    const overview = await vaultFileStore.readCommentOverview({
      filePaths: workspaceState.filePaths,
    });
    jsonResponse(req, res, 200, { overview });
  } catch (error) {
    console.error('[api] Failed to read comment overview:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to read comment overview' });
  }
}

async function handleFileRead(req, res, requestUrl, { vaultFileStore }) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  try {
    const content = await vaultFileStore.readEditableVaultContent(filePath);
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

async function handleFileDownload(req, res, requestUrl, { config, vaultFileStore }) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  try {
    const download = await vaultFileStore.openDownloadFileStream(filePath, {
      maxBytes: config.maxDownloadFileBytes ?? DEFAULT_MAX_DOWNLOAD_FILE_BYTES,
    });
    if (!download) {
      jsonResponse(req, res, 404, { error: 'File not found' });
      return;
    }
    if (download.error) {
      jsonResponse(req, res, download.statusCode || 400, { error: download.error });
      return;
    }

    await sendStreamResponse(req, res, {
      headers: createDownloadHeaders(
        basename(String(download.path ?? 'download')),
        download.mimeType || 'application/octet-stream',
        { inline: getVaultFileKind(download.path) === 'pdf' },
      ),
      statusCode: 200,
      stream: download.stream,
    });
  } catch (error) {
    console.error('[api] Failed to download file:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to download file' });
  }
}

async function handleDirectoryDownload(req, res, requestUrl, { config, vaultFileStore }) {
  const directoryPath = requestUrl.searchParams.get('path');
  if (!directoryPath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return;
  }

  try {
    const result = await vaultFileStore.resolveDirectoryDownloadRoot(directoryPath);
    if (!result.ok) {
      jsonResponse(req, res, result.error === 'Directory not found' ? 404 : 400, { error: result.error });
      return;
    }
    const maxArchiveEntries = config.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES;
    const entryCount = await vaultFileStore.countDirectoryDownloadEntries(result.absolute, {
      maxEntries: maxArchiveEntries,
    });
    if (!entryCount.withinLimit) {
      jsonResponse(req, res, 413, { error: `Directory archive exceeds ${maxArchiveEntries} entries` });
      return;
    }

    await streamDirectoryArchive(req, res, {
      maxEntries: maxArchiveEntries,
      rootAbsolutePath: result.absolute,
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

async function handleAttachmentRead(req, res, requestUrl, { config, vaultFileStore }) {
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
    const attachment = await vaultFileStore.openImageAttachmentReadStream(filePath, {
      maxBytes: config.maxDownloadFileBytes ?? DEFAULT_MAX_DOWNLOAD_FILE_BYTES,
    });
    if (!attachment) {
      jsonResponse(req, res, 404, { error: 'Attachment not found' });
      return;
    }
    if (attachment.error) {
      jsonResponse(req, res, attachment.statusCode || 400, { error: attachment.error });
      return;
    }

    await sendStreamResponse(req, res, {
      headers: createAttachmentHeaders(attachment),
      statusCode: 200,
      stream: attachment.stream,
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

async function handleSearch(req, res, requestUrl, { searchService }) {
  if (!searchService?.search) {
    jsonResponse(req, res, 503, {
      error: 'Global text search is unavailable',
      ok: false,
      search: {
        available: false,
        backend: 'ripgrep',
      },
    });
    return;
  }

  const cancellation = createSearchCancellation(req, res);

  try {
    const result = await searchService.search({
      limit: requestUrl.searchParams.get('limit') || '',
      query: requestUrl.searchParams.get('q') || '',
      signal: cancellation.signal,
    });
    if (cancellation.signal.aborted || res.destroyed || res.writableEnded) {
      return;
    }

    jsonResponse(req, res, 200, result);
  } catch (error) {
    if (
      cancellation.signal.aborted
      || res.destroyed
      || res.writableEnded
    ) {
      return;
    }

    const statusCode = Number(error?.statusCode) || 500;
    console.error('[api] Failed to search vault:', error.message);
    jsonResponse(req, res, statusCode, {
      error: error.message || 'Failed to search vault',
      ok: false,
      search: error.search ?? searchService?.getClientConfig?.() ?? {
        available: false,
        backend: 'ripgrep',
      },
    });
  } finally {
    cancellation.cleanup();
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
    { method: 'GET', path: '/api/comments/overview', handler: handleCommentOverview },
    { method: 'GET', path: '/api/file', handler: handleFileRead },
    { method: 'GET', path: '/api/download/file', handler: handleFileDownload },
    { method: 'GET', path: '/api/download/directory', handler: handleDirectoryDownload },
    { method: 'GET', path: '/api/attachment', handler: handleAttachmentRead },
    { method: 'GET', path: '/api/backlinks', handler: handleBacklinks },
    { method: 'GET', path: '/api/search', handler: handleSearch },
  ].map((route) => ({
    ...route,
    handler: (req, res, requestUrl) => route.handler(req, res, requestUrl, context),
  }));
}

export function createVaultApiQueryHandler({
  baseQueryService = null,
  backlinkIndex,
  config = {},
  searchService = null,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  const context = {
    baseQueryService,
    backlinkIndex,
    config,
    searchService,
    vaultFileStore,
    workspaceMutationCoordinator,
  };
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
