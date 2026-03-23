import { basename } from 'node:path';

import {
  isDrawioFilePath,
  isExcalidrawFilePath,
  isImageAttachmentFilePath,
  isMermaidFilePath,
  isPlantUmlFilePath,
} from '../../../domain/file-kind.js';
import { jsonResponse, sendResponse } from './http-response.js';

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

function selectReadOperation(vaultFileStore, filePath) {
  if (isExcalidrawFilePath(filePath)) {
    return vaultFileStore.readExcalidrawFile(filePath);
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

export function createVaultApiQueryHandler({
  backlinkIndex,
  vaultFileStore,
  workspaceMutationCoordinator = null,
}) {
  return async function handleVaultApiQuery(req, res, requestUrl) {
    if (requestUrl.pathname === '/api/files' && req.method === 'GET') {
      try {
        const tree = workspaceMutationCoordinator?.getWorkspaceTree?.() ?? await vaultFileStore.tree();
        jsonResponse(req, res, 200, { tree });
      } catch (error) {
        console.error('[api] Failed to read file tree:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to read file tree' });
      }
      return true;
    }

    if (requestUrl.pathname === '/api/file' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing path parameter' });
        return true;
      }

      try {
        const content = await selectReadOperation(vaultFileStore, filePath);
        if (content === null) {
          jsonResponse(req, res, 404, { error: 'File not found' });
          return true;
        }

        jsonResponse(req, res, 200, { path: filePath, content });
      } catch (error) {
        console.error('[api] Failed to read file:', error.message);
        jsonResponse(req, res, 500, { error: 'Failed to read file' });
      }
      return true;
    }

    if (requestUrl.pathname === '/api/attachment' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('path');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing path parameter' });
        return true;
      }

      if (!isImageAttachmentFilePath(filePath)) {
        jsonResponse(req, res, 400, { error: 'Unsupported attachment path' });
        return true;
      }

      try {
        const attachment = await vaultFileStore.readImageAttachmentFile(filePath);
        if (!attachment) {
          jsonResponse(req, res, 404, { error: 'Attachment not found' });
          return true;
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
      return true;
    }

    if (requestUrl.pathname === '/api/backlinks' && req.method === 'GET') {
      const filePath = requestUrl.searchParams.get('file');
      if (!filePath) {
        jsonResponse(req, res, 400, { error: 'Missing file parameter' });
        return true;
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
      return true;
    }

    return false;
  };
}
