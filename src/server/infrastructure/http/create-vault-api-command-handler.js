import { basename } from 'node:path';
import { isPdfFilePath } from '../../../domain/file-kind.js';
import { createRequestError } from './http-errors.js';
import { handleApiError, readRequestId } from './http-request-helpers.js';
import {
  createSafeAsciiFilename,
  encodeContentDispositionFilename,
  jsonResponse,
  sendResponse,
} from './http-response.js';
import {
  parseJsonBody,
  readBinaryRequestBody,
  REQUEST_BODY_LIMIT_BYTES,
} from './request-body.js';

const DOCX_EXPORT_REQUEST_LIMIT_BYTES = 33_554_432;
const DOCX_MIME_TYPE = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_SIGNATURE = Buffer.from('%PDF-');

function createDocxDownloadHeaders(filePath) {
  const fileName = basename(String(filePath ?? 'document')).replace(/\.[^.]+$/u, '') || 'document';
  const exportFileName = `${fileName}.docx`;
  return {
    'Cache-Control': 'no-store',
    'Content-Disposition': `attachment; filename="${createSafeAsciiFilename(exportFileName, 'document')}"; filename*=UTF-8''${encodeContentDispositionFilename(exportFileName)}`,
    'Content-Type': DOCX_MIME_TYPE,
    'X-Content-Type-Options': 'nosniff',
  };
}

function decodeHeaderMetadata(value, label = 'attachment') {
  const normalized = String(value ?? '').trim();
  if (!normalized) {
    return '';
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    throw createRequestError(400, `Invalid ${label} metadata header encoding`);
  }
}

async function handleExportDocx({ renderDocx }, req, res) {
  try {
    const body = await parseJsonBody(req, DOCX_EXPORT_REQUEST_LIMIT_BYTES);
    if (!body?.filePath || typeof body?.html !== 'string') {
      jsonResponse(req, res, 400, { error: 'Missing filePath or html' });
      return true;
    }

    if (typeof renderDocx !== 'function') {
      jsonResponse(req, res, 503, { error: 'DOCX export is unavailable' });
      return true;
    }

    const docxBuffer = await renderDocx({
      html: body.html,
      title: body.title || '',
    });

    sendResponse(req, res, {
      body: docxBuffer,
      headers: createDocxDownloadHeaders(body.filePath),
      statusCode: 200,
    });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to export DOCX:', 'Failed to export DOCX');
  }
  return true;
}

async function handleWriteFile({ workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.path || typeof body.content !== 'string') {
      jsonResponse(req, res, 400, { error: 'Missing path or content' });
      return true;
    }

    const result = await workspaceMutationCoordinator.writeEditableContent({
      content: body.content,
      path: body.path,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }

    jsonResponse(req, res, 200, { ok: true });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to write file:', 'Failed to write file');
  }
  return true;
}

async function handleUploadAttachment({ workspaceMutationCoordinator }, req, res) {
  try {
    const sourceDocumentPath = decodeHeaderMetadata(req.headers['x-collabmd-source-path']);
    const originalFileName = decodeHeaderMetadata(req.headers['x-collabmd-file-name']);
    const mimeType = String(req.headers['content-type'] || '').trim();

    if (!sourceDocumentPath) {
      jsonResponse(req, res, 400, { error: 'Missing source document path' });
      return true;
    }

    const content = await readBinaryRequestBody(req);
    const result = await workspaceMutationCoordinator.uploadAttachment({
      content,
      mimeType,
      originalFileName,
      requestId: readRequestId(req),
      sourceDocumentPath,
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }

    jsonResponse(req, res, 201, {
      markdown: result.markdownSnippet,
      ok: true,
      path: result.path,
    });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to upload attachment:', 'Failed to upload attachment');
  }
  return true;
}

async function handleUploadFile({ maxPdfUploadBytes, workspaceMutationCoordinator }, req, res) {
  try {
    const filePath = decodeHeaderMetadata(req.headers['x-collabmd-file-path'], 'file upload');
    if (!filePath) {
      jsonResponse(req, res, 400, { error: 'Missing file path' });
      return true;
    }

    if (typeof workspaceMutationCoordinator?.createFile !== 'function') {
      jsonResponse(req, res, 503, { error: 'File upload is unavailable' });
      return true;
    }

    const isPdfUpload = isPdfFilePath(filePath);
    if (isPdfUpload) {
      const contentType = String(req.headers['content-type'] || '')
        .split(';', 1)[0]
        .trim()
        .toLowerCase();
      if (contentType !== 'application/pdf') {
        jsonResponse(req, res, 400, { error: 'PDF uploads must use application/pdf' });
        return true;
      }
    }

    const maxUploadBytes = isPdfUpload ? maxPdfUploadBytes : REQUEST_BODY_LIMIT_BYTES;
    const content = await readBinaryRequestBody(req, maxUploadBytes);
    if (isPdfUpload && !content.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
      jsonResponse(req, res, 400, { error: 'Invalid PDF file' });
      return true;
    }

    const result = await workspaceMutationCoordinator.createFile({
      content,
      path: filePath,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }

    jsonResponse(req, res, 201, { ok: true, path: filePath });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to upload file:', 'Failed to upload file');
  }
  return true;
}

async function handleCreateFile({ workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.path) {
      jsonResponse(req, res, 400, { error: 'Missing path' });
      return true;
    }

    const result = await workspaceMutationCoordinator.createFile({
      content: body.content || '',
      path: body.path,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }
    jsonResponse(req, res, 201, { ok: true, path: body.path });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to create file:', 'Failed to create file');
  }
  return true;
}

async function handleDeleteFile({ workspaceMutationCoordinator }, req, res, requestUrl) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return true;
  }

  try {
    const result = await workspaceMutationCoordinator.deleteFile({
      path: filePath,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }
    jsonResponse(req, res, 200, { ok: true });
  } catch (error) {
    console.error('[api] Failed to delete file:', error.message);
    jsonResponse(req, res, 500, { error: 'Failed to delete file' });
  }
  return true;
}

async function handleRenameFile({ workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.oldPath || !body.newPath) {
      jsonResponse(req, res, 400, { error: 'Missing oldPath or newPath' });
      return true;
    }

    const result = await workspaceMutationCoordinator.renameFile({
      newPath: body.newPath,
      oldPath: body.oldPath,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }
    jsonResponse(req, res, 200, { ok: true, path: body.newPath });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to rename file:', 'Failed to rename file');
  }
  return true;
}

async function handleCreateDirectory({ workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.path) {
      jsonResponse(req, res, 400, { error: 'Missing path' });
      return true;
    }

    const result = await workspaceMutationCoordinator.createDirectory({
      path: body.path,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }

    jsonResponse(req, res, 201, { ok: true });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to create directory:', 'Failed to create directory');
  }
  return true;
}

async function handleRenameDirectory({ workspaceMutationCoordinator }, req, res) {
  try {
    const body = await parseJsonBody(req);
    if (!body.oldPath || !body.newPath) {
      jsonResponse(req, res, 400, { error: 'Missing oldPath or newPath' });
      return true;
    }

    const result = await workspaceMutationCoordinator.renameDirectory({
      newPath: body.newPath,
      oldPath: body.oldPath,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }

    jsonResponse(req, res, 200, { ok: true, path: body.newPath });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to rename directory:', 'Failed to rename directory');
  }
  return true;
}

async function handleDeleteDirectory({ workspaceMutationCoordinator }, req, res, requestUrl) {
  const dirPath = requestUrl.searchParams.get('path');
  const recursive = requestUrl.searchParams.get('recursive') === '1';
  if (!dirPath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return true;
  }

  try {
    const result = await workspaceMutationCoordinator.deleteDirectory({
      path: dirPath,
      recursive,
      requestId: readRequestId(req),
    });
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }

    jsonResponse(req, res, 200, { ok: true });
  } catch (error) {
    handleApiError(req, res, error, '[api] Failed to delete directory:', 'Failed to delete directory');
  }
  return true;
}

const ROUTE_TABLE = [
  { method: 'POST', path: '/api/export/docx', handler: handleExportDocx },
  { method: 'PUT', path: '/api/file', handler: handleWriteFile },
  { method: 'POST', path: '/api/attachments', handler: handleUploadAttachment },
  { method: 'POST', path: '/api/file/upload', handler: handleUploadFile },
  { method: 'POST', path: '/api/file', handler: handleCreateFile },
  { method: 'DELETE', path: '/api/file', handler: handleDeleteFile },
  { method: 'PATCH', path: '/api/file', handler: handleRenameFile },
  { method: 'POST', path: '/api/directory', handler: handleCreateDirectory },
  { method: 'PATCH', path: '/api/directory', handler: handleRenameDirectory },
  { method: 'DELETE', path: '/api/directory', handler: handleDeleteDirectory },
];

export function createVaultApiCommandHandler({
  maxPdfUploadBytes = REQUEST_BODY_LIMIT_BYTES,
  renderDocx = null,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  const context = {
    maxPdfUploadBytes,
    renderDocx,
    vaultFileStore,
    workspaceMutationCoordinator,
  };

  return async function handleVaultApiCommand(req, res, requestUrl) {
    for (const route of ROUTE_TABLE) {
      if (requestUrl.pathname === route.path && req.method === route.method) {
        return route.handler(context, req, res, requestUrl);
      }
    }
    return false;
  };
}
