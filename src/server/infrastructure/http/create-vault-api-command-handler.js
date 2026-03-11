import {
  isExcalidrawFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';
import { getRequestErrorStatusCode } from './http-errors.js';
import { jsonResponse } from './http-response.js';
import { parseJsonBody } from './request-body.js';

function selectWriteOperation(vaultFileStore, filePath, content) {
  if (isExcalidrawFilePath(filePath)) {
    return vaultFileStore.writeExcalidrawFile(filePath, content);
  }

  if (isMermaidFilePath(filePath)) {
    return vaultFileStore.writeMermaidFile(filePath, content);
  }

  if (isPlantUmlFilePath(filePath)) {
    return vaultFileStore.writePlantUmlFile(filePath, content);
  }

  return vaultFileStore.writeMarkdownFile(filePath, content);
}

function handleVaultError(req, res, error, logMessage, fallbackMessage) {
  const statusCode = getRequestErrorStatusCode(error);
  if (statusCode) {
    jsonResponse(req, res, statusCode, { error: error.message });
    return true;
  }

  console.error(logMessage, error.message);
  jsonResponse(req, res, 500, { error: fallbackMessage });
  return true;
}

export function createVaultApiCommandHandler({
  backlinkIndex,
  roomRegistry = null,
  vaultFileStore,
}) {
  return async function handleVaultApiCommand(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/file' && req.method === 'PUT') {
      try {
        const body = await parseJsonBody(req);
        if (!body.path || typeof body.content !== 'string') {
          jsonResponse(req, res, 400, { error: 'Missing path or content' });
          return true;
        }

        const result = await selectWriteOperation(vaultFileStore, body.path, body.content);
        if (!result.ok) {
          jsonResponse(req, res, 400, { error: result.error });
          return true;
        }

        jsonResponse(req, res, 200, { ok: true });
      } catch (error) {
        handleVaultError(req, res, error, '[api] Failed to write file:', 'Failed to write file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/file' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.path) {
          jsonResponse(req, res, 400, { error: 'Missing path' });
          return true;
        }

        const result = await vaultFileStore.createFile(body.path, body.content || '');
        if (!result.ok) {
          jsonResponse(req, res, 409, { error: result.error });
          return true;
        }

        backlinkIndex?.onFileCreated(body.path, body.content || '');
        jsonResponse(req, res, 201, { ok: true, path: body.path });
      } catch (error) {
        handleVaultError(req, res, error, '[api] Failed to create file:', 'Failed to create file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/file' && req.method === 'DELETE') {
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing path parameter' });
        return true;
      }

      const activeRoom = roomRegistry?.get(filePath);
      try {
        activeRoom?.markDeleted?.();
        const result = await vaultFileStore.deleteFile(filePath);
        if (!result.ok) {
          activeRoom?.unmarkDeleted?.();
          jsonResponse(req, res, 400, { error: result.error });
          return true;
        }

        roomRegistry?.delete?.(filePath);
        backlinkIndex?.onFileDeleted(filePath);
        jsonResponse(req, res, 200, { ok: true });
      } catch (error) {
        activeRoom?.unmarkDeleted?.();
        console.error('[api] Failed to delete file:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to delete file' });
      }
      return true;
    }

    if (requestUrl.pathname === '/api/file' && req.method === 'PATCH') {
      try {
        const body = await parseJsonBody(req);
        if (!body.oldPath || !body.newPath) {
          jsonResponse(req, res, 400, { error: 'Missing oldPath or newPath' });
          return true;
        }

        const result = await vaultFileStore.renameFile(body.oldPath, body.newPath);
        if (!result.ok) {
          jsonResponse(req, res, 400, { error: result.error });
          return true;
        }

        roomRegistry?.rename(body.oldPath, body.newPath);
        backlinkIndex?.onFileRenamed(body.oldPath, body.newPath);
        jsonResponse(req, res, 200, { ok: true, path: body.newPath });
      } catch (error) {
        handleVaultError(req, res, error, '[api] Failed to rename file:', 'Failed to rename file');
      }
      return true;
    }

    if (requestUrl.pathname === '/api/directory' && req.method === 'POST') {
      try {
        const body = await parseJsonBody(req);
        if (!body.path) {
          jsonResponse(req, res, 400, { error: 'Missing path' });
          return true;
        }

        const result = await vaultFileStore.createDirectory(body.path);
        if (!result.ok) {
          jsonResponse(req, res, 400, { error: result.error });
          return true;
        }

        jsonResponse(req, res, 201, { ok: true });
      } catch (error) {
        handleVaultError(req, res, error, '[api] Failed to create directory:', 'Failed to create directory');
      }
      return true;
    }

    return false;
  };
}
