import { basename } from 'node:path';
import { isPdfFilePath } from '../../../domain/file-kind.js';
import { createRequestError } from '../../shared/http-errors.js';
import { handleApiError, readRequestId } from './http-request-helpers.js';
import {
  createDownloadHeaders,
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
  return createDownloadHeaders(`${fileName}.docx`, DOCX_MIME_TYPE, { fallback: 'document' });
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

async function runVaultMutation(req, res, {
  errorMessage,
  execute,
  successBody = () => ({ ok: true }),
  successStatus = 200,
}) {
  try {
    const result = await execute();
    if (!result) return true;
    if (!result.ok) {
      jsonResponse(req, res, result.statusCode ?? 400, { error: result.error });
      return true;
    }
    jsonResponse(req, res, successStatus, successBody(result));
  } catch (error) {
    handleApiError(req, res, error, `[api] ${errorMessage}:`, errorMessage);
  }
  return true;
}

async function handleWriteFile({ workspaceMutationCoordinator }, req, res) {
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to write file',
    execute: async () => {
      const body = await parseJsonBody(req);
      if (!body.path || typeof body.content !== 'string') {
        jsonResponse(req, res, 400, { error: 'Missing path or content' });
        return null;
      }
      return workspaceMutationCoordinator.writeEditableContent({
        content: body.content,
        path: body.path,
        requestId: readRequestId(req),
      });
    },
  });
}

async function handleUploadAttachment({ workspaceMutationCoordinator }, req, res) {
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to upload attachment',
    execute: async () => {
      const sourceDocumentPath = decodeHeaderMetadata(req.headers['x-collabmd-source-path']);
      const originalFileName = decodeHeaderMetadata(req.headers['x-collabmd-file-name']);
      const mimeType = String(req.headers['content-type'] || '').trim();
      if (!sourceDocumentPath) {
        jsonResponse(req, res, 400, { error: 'Missing source document path' });
        return null;
      }
      return workspaceMutationCoordinator.uploadAttachment({
        content: await readBinaryRequestBody(req),
        mimeType,
        originalFileName,
        requestId: readRequestId(req),
        sourceDocumentPath,
      });
    },
    successBody: (result) => ({ markdown: result.markdownSnippet, ok: true, path: result.path }),
    successStatus: 201,
  });
}

async function handleUploadFile({ maxPdfUploadBytes, workspaceMutationCoordinator }, req, res) {
  let uploadedPath = '';
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to upload file',
    execute: async () => {
      const filePath = decodeHeaderMetadata(req.headers['x-collabmd-file-path'], 'file upload');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing file path' });
        return null;
      }
      if (typeof workspaceMutationCoordinator?.createFile !== 'function') {
        jsonResponse(req, res, 503, { error: 'File upload is unavailable' });
        return null;
      }
      const isPdfUpload = isPdfFilePath(filePath);
      if (isPdfUpload) {
        const contentType = String(req.headers['content-type'] || '').split(';', 1)[0].trim().toLowerCase();
        if (contentType !== 'application/pdf') {
          jsonResponse(req, res, 400, { error: 'PDF uploads must use application/pdf' });
          return null;
        }
      }
      const content = await readBinaryRequestBody(req, isPdfUpload ? maxPdfUploadBytes : REQUEST_BODY_LIMIT_BYTES);
      if (isPdfUpload && !content.subarray(0, PDF_SIGNATURE.length).equals(PDF_SIGNATURE)) {
        jsonResponse(req, res, 400, { error: 'Invalid PDF file' });
        return null;
      }
      uploadedPath = filePath;
      return workspaceMutationCoordinator.createFile({
        content,
        path: filePath,
        requestId: readRequestId(req),
      });
    },
    successBody: () => ({ ok: true, path: uploadedPath }),
    successStatus: 201,
  });
}

async function handleCreateFile({ workspaceMutationCoordinator }, req, res) {
  let createdPath = '';
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to create file',
    execute: async () => {
      const body = await parseJsonBody(req);
      if (!body.path) {
        jsonResponse(req, res, 400, { error: 'Missing path' });
        return null;
      }
      createdPath = body.path;
      return workspaceMutationCoordinator.createFile({
        content: body.content || '',
        path: body.path,
        requestId: readRequestId(req),
      });
    },
    successBody: () => ({ ok: true, path: createdPath }),
    successStatus: 201,
  });
}

async function handleDeleteFile({ workspaceMutationCoordinator }, req, res, requestUrl) {
  const filePath = requestUrl.searchParams.get('path');
  if (!filePath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return true;
  }
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to delete file',
    execute: () => workspaceMutationCoordinator.deleteFile({ path: filePath, requestId: readRequestId(req) }),
  });
}

async function handleRename(methodName, errorMessage, { workspaceMutationCoordinator }, req, res) {
  let newPath = '';
  return runVaultMutation(req, res, {
    errorMessage,
    execute: async () => {
      const body = await parseJsonBody(req);
      if (!body.oldPath || !body.newPath) {
        jsonResponse(req, res, 400, { error: 'Missing oldPath or newPath' });
        return null;
      }
      newPath = body.newPath;
      return workspaceMutationCoordinator[methodName]({
        newPath: body.newPath,
        oldPath: body.oldPath,
        requestId: readRequestId(req),
      });
    },
    successBody: () => ({ ok: true, path: newPath }),
  });
}

async function handleCreateDirectory({ workspaceMutationCoordinator }, req, res) {
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to create directory',
    execute: async () => {
      const body = await parseJsonBody(req);
      if (!body.path) {
        jsonResponse(req, res, 400, { error: 'Missing path' });
        return null;
      }
      return workspaceMutationCoordinator.createDirectory({ path: body.path, requestId: readRequestId(req) });
    },
    successStatus: 201,
  });
}

async function handleDeleteDirectory({ workspaceMutationCoordinator }, req, res, requestUrl) {
  const dirPath = requestUrl.searchParams.get('path');
  if (!dirPath) {
    jsonResponse(req, res, 400, { error: 'Missing path parameter' });
    return true;
  }
  return runVaultMutation(req, res, {
    errorMessage: 'Failed to delete directory',
    execute: () => workspaceMutationCoordinator.deleteDirectory({
      path: dirPath,
      recursive: requestUrl.searchParams.get('recursive') === '1',
      requestId: readRequestId(req),
    }),
  });
}

const ROUTE_TABLE = [
  { method: 'POST', path: '/api/export/docx', handler: handleExportDocx },
  { method: 'PUT', path: '/api/file', handler: handleWriteFile },
  { method: 'POST', path: '/api/attachments', handler: handleUploadAttachment },
  { method: 'POST', path: '/api/file/upload', handler: handleUploadFile },
  { method: 'POST', path: '/api/file', handler: handleCreateFile },
  { method: 'DELETE', path: '/api/file', handler: handleDeleteFile },
  { method: 'PATCH', path: '/api/file', handler: (ctx, req, res) => handleRename('renameFile', 'Failed to rename file', ctx, req, res) },
  { method: 'POST', path: '/api/directory', handler: handleCreateDirectory },
  { method: 'PATCH', path: '/api/directory', handler: (ctx, req, res) => handleRename('renameDirectory', 'Failed to rename directory', ctx, req, res) },
  { method: 'DELETE', path: '/api/directory', handler: handleDeleteDirectory },
];

export function createVaultApiCommandHandler({
  maxPdfUploadBytes = REQUEST_BODY_LIMIT_BYTES,
  renderDocx = null,
  workspaceMutationCoordinator = null,
}) {
  const context = {
    maxPdfUploadBytes,
    renderDocx,
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
