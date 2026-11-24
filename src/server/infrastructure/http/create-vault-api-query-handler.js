import { ZipArchive } from 'archiver';
import { basename } from 'node:path';

import { getVaultFileKind, isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { parseJsonBody } from './request-body.js';
import {
  createDownloadHeaders,
  jsonResponse,
  sendResponse,
  sendStreamResponse,
} from './http-response.js';

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
  return createDownloadHeaders(
    basename(String(attachment?.path ?? 'attachment')),
    attachment.mimeType,
    {
      cacheControl: 'private, max-age=300, stale-while-revalidate=3600',
      inline: true,
      svgCsp: true,
    },
  );
}

async function streamDirectoryArchive(req, res, {
  entries = [],
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

  try {
    for (const entry of entries) {
      if (entry.kind === 'directory') {
        archive.append('', {
          name: entry.relativePath ? `${rootName}/${entry.relativePath}/` : `${rootName}/`,
        });
        continue;
      }

      archive.file(entry.absolutePath, {
        name: `${rootName}/${entry.relativePath}`,
      });
    }

    await archive.finalize();
    await responsePromise;
  } catch (error) {
    archive.destroy(error);
    await responsePromise.catch(() => {});
    throw error;
  }
}

// --- Route handlers ---

async function runBaseOperation(req, res, { baseQueryService }, {
  buildParams,
  errorMessage,
  method,
  send = (result) => jsonResponse(req, res, 200, { ok: true, result }),
}) {
  try {
    if (!baseQueryService?.[method]) {
      jsonResponse(req, res, 503, { error: 'Bases query service is unavailable' });
      return;
    }

    const body = await parseJsonBody(req);
    const result = await baseQueryService[method]({
      activeFilePath: body?.activeFilePath ?? '',
      basePath: body?.path ?? '',
      source: typeof body?.source === 'string' ? body.source : null,
      sourcePath: body?.sourcePath ?? '',
      view: body?.view ?? '',
      ...buildParams(body),
    });
    send(result, body);
  } catch (error) {
    console.error(`[api] ${errorMessage}:`, error.message);
    jsonResponse(req, res, 400, { error: error.message || errorMessage });
  }
}

const handleBaseQuery = (req, res, _u, ctx) => runBaseOperation(req, res, ctx, {
  buildParams: (body) => ({ search: body?.search ?? '' }),
  errorMessage: 'Failed to query base',
  method: 'query',
});

const handleBasePropertyValues = (req, res, _u, ctx) => runBaseOperation(req, res, ctx, {
  buildParams: (body) => ({ propertyId: body?.propertyId ?? '', query: body?.query ?? '' }),
  errorMessage: 'Failed to read base property values',
  method: 'propertyValues',
});

const handleBaseTransform = (req, res, _u, ctx) => runBaseOperation(req, res, ctx, {
  buildParams: (body) => ({ mutation: body?.mutation ?? null }),
  errorMessage: 'Failed to transform base',
  method: 'transform',
});

const handleBaseExport = (req, res, _u, ctx) => runBaseOperation(req, res, ctx, {
  buildParams: (body) => ({ includeCsv: true, search: body?.search ?? '' }),
  errorMessage: 'Failed to export base CSV',
  method: 'query',
  send: (result, body) => {
    const fileName = basename(String(body?.path || body?.sourcePath || 'base')).replace(/\.[^.]+$/u, '') || 'base';
    sendResponse(req, res, {
      body: result.csv,
      headers: createDownloadHeaders(`${fileName}.csv`, 'text/csv; charset=utf-8'),
      statusCode: 200,
    });
  },
});

async function handleFileTree(req, res, _requestUrl, { workspaceMutationCoordinator }) {
  try {
    const tree = workspaceMutationCoordinator.getWorkspaceTree();
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
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return;
    }
    const maxArchiveEntries = config.maxArchiveEntries ?? DEFAULT_MAX_ARCHIVE_ENTRIES;
    const collected = await vaultFileStore.collectDirectoryDownloadEntries(result.absolute, {
      maxEntries: maxArchiveEntries,
    });
    if (!collected.withinLimit) {
      jsonResponse(req, res, 413, { error: `Directory archive exceeds ${maxArchiveEntries} entries` });
      return;
    }

    await streamDirectoryArchive(req, res, {
      entries: collected.entries,
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

async function handleVaultList(req, res, _requestUrl, { config }) {
  // ponytail: ids only — absolute vault dirs are operator internals
  const vaults = (config?.vaults ?? []).map(({ id, name }) => ({ id, name: name || id }));
  jsonResponse(req, res, 200, { activeVault: vaults[0]?.id ?? null, vaults });
}

// --- Route table ---

function createRouteTable(context) {
  return [
    { method: 'POST', path: '/api/base/query', handler: handleBaseQuery },
    { method: 'POST', path: '/api/base/property-values', handler: handleBasePropertyValues },
    { method: 'POST', path: '/api/base/transform', handler: handleBaseTransform },
    { method: 'POST', path: '/api/base/export', handler: handleBaseExport },
    { method: 'GET', path: '/api/vaults', handler: handleVaultList },
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
