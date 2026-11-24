import { createReadStream } from 'fs';
import { chmod, copyFile, link, lstat, mkdir, mkdtemp, readFile, readdir, rename, rm, rmdir, stat, unlink, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'path';
import sharp from 'sharp';

import {
  getVaultFileKind,
  isImageAttachmentFilePath,
  isMarkdownFilePath,
  isVaultFilePath,
  supportsCommentsForFilePath,
} from '../../../domain/file-kind.js';
import { parseCanvasJson } from '../../../domain/canvas-room-codec.js';
import { normalizeEditableText } from '../../../domain/editable-text.js';
import { replacePathPrefix } from '../../../domain/vault-paths.js';
import { createCommentOverview } from '../../domain/comment-overview.js';
import { scanWorkspaceState as scanWorkspaceStateFromAdapter } from '../../domain/workspace-state.js';
import {
  INVALID_VAULT_FILE_PATH_ERROR,
  isIgnoredVaultEntry,
  resolveVaultDirectoryPath,
  resolveVaultDirectoryRenamePaths,
  resolveVaultFilePath,
  resolveVaultRenamePaths,
  sanitizeVaultPath,
  toVaultRelativePath,
} from './path-utils.js';
import { SidecarStore } from './sidecar-store.js';
import { createWorkspaceStateFileSystemAdapter } from '../workspace/workspace-state-file-system-adapter.js';
import { IMAGE_EXTENSION_TO_MIME_TYPE } from '../../shared/image-mime.js';

const EDITABLE_VAULT_CONTENT_PATH_ERRORS = {
  base: 'Invalid file path — must end in .base',
  canvas: 'Invalid file path — must end in .canvas',
  drawio: 'Invalid file path — must end in .drawio',
  excalidraw: 'Invalid file path — must end in .excalidraw',
  html: 'Invalid file path — must end in .html or .htm',
  markdown: 'Invalid file path',
  mermaid: 'Invalid file path — must end in .mmd or .mermaid',
  plantuml: 'Invalid file path — must end in .puml or .plantuml',
  structurizr: 'Invalid file path — must end in .dsl',
};

function getContentValidationError(filePath, content) {
  if (getVaultFileKind(filePath) !== 'canvas') return null;
  try {
    const text = content instanceof Uint8Array
      ? new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(content)
      : content;
    parseCanvasJson(text);
    return null;
  } catch {
    return 'Invalid JSON Canvas 1.0 document';
  }
}

function getEditableVaultContentKind(filePath) {
  const kind = getVaultFileKind(filePath);
  return EDITABLE_VAULT_CONTENT_PATH_ERRORS[kind]
    ? { invalidPathError: EDITABLE_VAULT_CONTENT_PATH_ERRORS[kind], kind }
    : null;
}

const MIME_TYPE_TO_IMAGE_EXTENSION = Object.freeze({
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
});
const MAX_RASTER_ATTACHMENT_PIXELS = 40_000_000;
const RASTER_IMAGE_MIME_TYPES_TO_CONVERT = new Set(['image/jpeg', 'image/png']);
const RASTER_IMAGE_EXTENSIONS_TO_CONVERT = new Set(['.jpeg', '.jpg', '.png']);
const TEXT_FILE_MIME_TYPES = Object.freeze({
  base: 'text/yaml; charset=utf-8',
  canvas: 'application/json; charset=utf-8',
  drawio: 'application/xml; charset=utf-8',
  excalidraw: 'application/json; charset=utf-8',
  html: 'text/html; charset=utf-8',
  markdown: 'text/markdown; charset=utf-8',
  mermaid: 'text/plain; charset=utf-8',
  pdf: 'application/pdf',
  plantuml: 'text/plain; charset=utf-8',
  structurizr: 'text/plain; charset=utf-8',
});

function createCommentThreadsPayload(threads = []) {
  return `${JSON.stringify({
    threads,
    version: 1,
  }, null, 2)}\n`;
}

class VaultContentChanged extends Error {
  constructor(currentContent) {
    super('Vault content changed before save');
    this.currentContent = currentContent;
  }
}

async function moveFileWithoutReplacing(source, destination) {
  try {
    await link(source, destination);
  } catch (error) {
    if (!['EPERM', 'ENOTSUP', 'EOPNOTSUPP'].includes(error.code)) throw error;
    // Some mounted vaults do not support hard links. Reserve the destination
    // exclusively before using the filesystem's ordinary rename operation.
    await writeFile(destination, '', { flag: 'wx', mode: 0o600 });
    try {
      await rename(source, destination);
    } catch (renameError) {
      await unlink(destination);
      throw renameError;
    }
    return;
  }
  try {
    await unlink(source);
  } catch (error) {
    await unlink(destination);
    throw error;
  }
}

function collectAncestorDirectoryPaths(pathValue) {
  const normalizedPath = String(pathValue ?? '').replace(/\\/g, '/').trim();
  if (!normalizedPath) {
    return [];
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const ancestors = [];
  let currentPath = '';
  for (let index = 0; index < Math.max(segments.length - 1, 0); index += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
    ancestors.push(currentPath);
  }

  return ancestors;
}

function expandManagedPaths(paths = []) {
  const expandedPaths = new Set();

  paths.filter(Boolean).forEach((pathValue) => {
    const normalizedPath = String(pathValue ?? '').replace(/\\/g, '/').trim();
    if (!normalizedPath) {
      return;
    }

    expandedPaths.add(normalizedPath);
    collectAncestorDirectoryPaths(normalizedPath).forEach((ancestorPath) => {
      expandedPaths.add(ancestorPath);
    });
  });

  return sortWorkspacePaths(Array.from(expandedPaths));
}

function sortWorkspacePaths(paths = []) {
  return [...paths].sort((left, right) => {
    const depthDelta = left.split('/').length - right.split('/').length;
    return depthDelta !== 0
      ? depthDelta
      : left.localeCompare(right, undefined, { sensitivity: 'base' });
  });
}

function sortDirectoryEntries(entries = []) {
  return [...entries].sort((left, right) => {
    if (left.isDirectory() && !right.isDirectory()) return -1;
    if (!left.isDirectory() && right.isDirectory()) return 1;
    return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
  });
}

function normalizeAttachmentMimeType(value) {
  return String(value ?? '').split(';')[0].trim().toLowerCase();
}

function sanitizeAttachmentStem(value, fallback = 'image') {
  const normalized = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return normalized || fallback;
}

function padAttachmentTimestamp(value) {
  return String(value).padStart(2, '0');
}

function createAttachmentTimestamp(date = new Date()) {
  return [
    date.getFullYear(),
    padAttachmentTimestamp(date.getMonth() + 1),
    padAttachmentTimestamp(date.getDate()),
  ].join('')
    + '-'
    + [
      padAttachmentTimestamp(date.getHours()),
      padAttachmentTimestamp(date.getMinutes()),
      padAttachmentTimestamp(date.getSeconds()),
    ].join('');
}

function createDocumentAttachmentDirectoryPath() {
  return 'assets';
}

function createAttachmentAltText(originalFileName = '') {
  const stem = basename(String(originalFileName ?? ''), extname(String(originalFileName ?? '')))
    .replace(/[_-]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return stem || 'Image';
}

function escapeMarkdownText(value = '') {
  return String(value)
    .replace(/\\/g, '\\\\')
    .replace(/\[/g, '\\[')
    .replace(/\]/g, '\\]')
    .replace(/\r?\n/g, ' ');
}

function encodeMarkdownPath(pathValue = '') {
  return String(pathValue)
    .split('/')
    .map((segment) => encodeURIComponent(segment))
    .join('/');
}

function resolveAttachmentExtension({ mimeType, originalFileName }) {
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType);
  const extensionFromName = extname(String(originalFileName ?? '')).toLowerCase();
  if (extensionFromName && IMAGE_EXTENSION_TO_MIME_TYPE[extensionFromName]) {
    const expectedMimeType = IMAGE_EXTENSION_TO_MIME_TYPE[extensionFromName];
    if (!normalizedMimeType || expectedMimeType === normalizedMimeType) {
      return extensionFromName;
    }
  }

  return MIME_TYPE_TO_IMAGE_EXTENSION[normalizedMimeType] ?? '';
}

async function prepareImageAttachmentForStorage({
  content,
  mimeType,
  originalFileName,
}) {
  const normalizedMimeType = normalizeAttachmentMimeType(mimeType);
  const extension = resolveAttachmentExtension({
    mimeType: normalizedMimeType,
    originalFileName,
  });

  if (!extension) {
    return { ok: false, error: 'Unsupported image type' };
  }

  const shouldConvertToWebp = RASTER_IMAGE_MIME_TYPES_TO_CONVERT.has(normalizedMimeType)
    || (!normalizedMimeType && RASTER_IMAGE_EXTENSIONS_TO_CONVERT.has(extension));
  if (!shouldConvertToWebp) {
    return {
      content,
      extension,
      ok: true,
    };
  }

  try {
    const image = sharp(content, {
      failOn: 'error',
      limitInputPixels: MAX_RASTER_ATTACHMENT_PIXELS,
    });
    const metadata = await image.metadata();
    const pixelCount = Number(metadata.width || 0) * Number(metadata.height || 0);
    if (!metadata.width || !metadata.height || pixelCount > MAX_RASTER_ATTACHMENT_PIXELS) {
      return { ok: false, error: 'Image dimensions exceed limit' };
    }

    return {
      content: await image
        .rotate()
        .webp()
        .toBuffer(),
      extension: '.webp',
      ok: true,
    };
  } catch (error) {
    if (String(error?.message || '').includes('pixel limit')) {
      return { ok: false, error: 'Image dimensions exceed limit' };
    }

    return { ok: false, error: 'Failed to convert image to WebP' };
  }
}

function createAttachmentMarkdownSnippet({ altText, documentPath, storedPath }) {
  const relativePath = relative(dirname(documentPath), storedPath).replace(/\\/g, '/');
  const encodedRelativePath = encodeMarkdownPath(relativePath || basename(storedPath));
  return `![${escapeMarkdownText(altText)}](${encodedRelativePath})`;
}

function getDownloadMimeType(filePath) {
  const fileKind = getVaultFileKind(filePath);
  if (fileKind === 'image') {
    return IMAGE_EXTENSION_TO_MIME_TYPE[extname(String(filePath ?? '')).toLowerCase()] || 'application/octet-stream';
  }

  return TEXT_FILE_MIME_TYPES[fileKind] || 'application/octet-stream';
}

export class VaultFileStore {
  constructor({ vaultDir }) {
    this.vaultDir = resolve(vaultDir);
    this.sidecarStore = new SidecarStore({ vaultDir: this.vaultDir });
    this.managedWriteTracker = null;
  }

  setManagedWriteTracker(tracker) {
    this.managedWriteTracker = tracker ?? null;
  }

  async runManagedWrite(paths, operation, expectedContent) {
    if (!this.managedWriteTracker?.runManagedWrite) {
      return operation();
    }

    return this.managedWriteTracker.runManagedWrite(paths, operation, expectedContent);
  }

  resolveContentPath(filePath, { requireVaultFile = true } = {}) {
    if (!requireVaultFile) {
      return sanitizeVaultPath(this.vaultDir, filePath);
    }

    return resolveVaultFilePath(this.vaultDir, filePath).absolute;
  }

  resolveAdapter(filePath) {
    const absolute = this.resolveContentPath(filePath);
    if (!absolute) {
      return null;
    }

    const adapter = getEditableVaultContentKind(filePath);
    if (!adapter) {
      return null;
    }

    return { absolute, adapter };
  }

  async readContentFile(filePath, expectedKind = null) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved || (expectedKind && resolved.adapter.kind !== expectedKind)) {
      return null;
    }

    try {
      return await readFile(resolved.absolute, 'utf-8');
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async readEditableVaultContent(filePath) {
    return this.readContentFile(filePath);
  }

  async writeEditableVaultContent(filePath, content, { expectedContent, invalidateCollaborationSnapshot = true } = {}) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved) {
      return {
        ok: false,
        error: getEditableVaultContentKind(filePath)?.invalidPathError ?? INVALID_VAULT_FILE_PATH_ERROR,
        statusCode: 400,
      };
    }

    const validationError = getContentValidationError(filePath, content);
    if (validationError) return { ok: false, error: validationError, statusCode: 400 };

    try {
      await this.runManagedWrite([filePath], async () => {
        if (expectedContent === undefined) {
          await mkdir(dirname(resolved.absolute), { recursive: true });
          await writeFile(resolved.absolute, content, 'utf-8');
        } else {
          const tempPath = join(dirname(resolved.absolute), `.collabmd-tmp-${globalThis.crypto.randomUUID()}`);
          try {
            const previous = await stat(resolved.absolute, { throwIfNoEntry: false });
            if (!previous?.isFile()) throw new VaultContentChanged(null);
            await writeFile(tempPath, content, { encoding: 'utf-8', flag: 'wx', mode: previous.mode & 0o777 });
            await chmod(tempPath, previous.mode & 0o777);
            const current = await this.readEditableVaultContent(filePath);
            if (current !== expectedContent) throw new VaultContentChanged(current);
            await rename(tempPath, resolved.absolute);
          } finally {
            await rm(tempPath, { force: true }).catch(() => {});
          }
        }
        if (invalidateCollaborationSnapshot) {
          await this.deleteCollaborationSnapshot(filePath);
        }
      }, String(content));
      return { ok: true };
    } catch (error) {
      if (error instanceof VaultContentChanged) return { ok: false, diskChanged: true, statusCode: 409 };
      return { ok: false, error: 'Could not update vault content', statusCode: 500 };
    }
  }

  async readMarkdownFile(filePath) {
    return this.readContentFile(filePath, 'markdown');
  }

  async readBaseFile(filePath) {
    return this.readContentFile(filePath, 'base');
  }

  async readImageAttachmentFile(filePath) {
    const absolute = this.resolveContentPath(filePath, { requireVaultFile: false });
    if (!absolute || !isImageAttachmentFilePath(filePath)) {
      return null;
    }

    try {
      const content = await readFile(absolute);
      return {
        content,
        mimeType: IMAGE_EXTENSION_TO_MIME_TYPE[extname(filePath).toLowerCase()] || 'application/octet-stream',
        path: filePath,
      };
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async openFileReadStream(filePath, { maxBytes = Infinity, mimeType, tooLargeError } = {}) {
    const absolute = this.resolveContentPath(filePath, { requireVaultFile: false });
    if (!absolute) return null;

    try {
      const info = await stat(absolute);
      if (!info.isFile()) return null;
      if (Number(info.size || 0) > maxBytes) {
        return { error: tooLargeError, statusCode: 413 };
      }

      return {
        mimeType,
        path: filePath,
        size: Number(info.size || 0),
        stream: createReadStream(absolute),
      };
    } catch (error) {
      if (error.code === 'ENOENT') return null;
      throw error;
    }
  }

  async openImageAttachmentReadStream(filePath, { maxBytes = Infinity } = {}) {
    if (!isImageAttachmentFilePath(filePath)) return null;
    return this.openFileReadStream(filePath, {
      maxBytes,
      mimeType: IMAGE_EXTENSION_TO_MIME_TYPE[extname(filePath).toLowerCase()] || 'application/octet-stream',
      tooLargeError: 'Attachment is too large',
    });
  }

  async writeImageAttachmentForDocument(sourceDocumentPath, {
    content,
    mimeType,
    originalFileName = '',
    now = new Date(),
  } = {}) {
    if (!Buffer.isBuffer(content) || content.byteLength === 0) {
      return { ok: false, error: 'Missing attachment content', statusCode: 400 };
    }

    if (!isMarkdownFilePath(sourceDocumentPath)) {
      return { ok: false, error: 'Source document must be a markdown file', statusCode: 400 };
    }

    const preparedAttachment = await prepareImageAttachmentForStorage({
      content,
      mimeType,
      originalFileName,
    });
    if (!preparedAttachment.ok) {
      return { ok: false, error: preparedAttachment.error, statusCode: 400 };
    }

    const stemSource = basename(String(originalFileName ?? ''), extname(String(originalFileName ?? '')));
    const attachmentStem = sanitizeAttachmentStem(stemSource, 'image');
    const attachmentDirPath = createDocumentAttachmentDirectoryPath();
    const timestamp = createAttachmentTimestamp(now);
    const baseFileName = `${attachmentStem}-${timestamp}`;
    let storedPath;
    for (let collisionIndex = 0; ; collisionIndex += 1) {
      const suffix = collisionIndex > 0 ? `-${collisionIndex + 1}` : '';
      storedPath = `${attachmentDirPath}/${baseFileName}${suffix}${preparedAttachment.extension}`;
      const absolutePath = this.resolveContentPath(storedPath);
      if (!absolutePath || !isImageAttachmentFilePath(storedPath)) {
        return { ok: false, error: INVALID_VAULT_FILE_PATH_ERROR, statusCode: 400 };
      }
      try {
        await mkdir(dirname(absolutePath), { recursive: true });
      } catch {
        return { ok: false, error: 'Could not prepare the attachment directory', statusCode: 500 };
      }
      try {
        await this.runManagedWrite([storedPath], () => writeFile(absolutePath, preparedAttachment.content, { flag: 'wx' }));
        break;
      } catch (error) {
        if (error.code !== 'EEXIST') {
          return { ok: false, error: 'Could not write image attachment', statusCode: 500 };
        }
      }
    }

    const altText = createAttachmentAltText(originalFileName);
    return {
      ok: true,
      altText,
      markdownSnippet: createAttachmentMarkdownSnippet({
        altText,
        documentPath: sourceDocumentPath,
        storedPath,
      }),
      path: storedPath,
    };
  }

  async openDownloadFileStream(filePath, { maxBytes = Infinity } = {}) {
    const normalizedPath = String(filePath ?? '').replace(/\\/g, '/').trim();
    if (!normalizedPath || !isVaultFilePath(normalizedPath)) {
      return null;
    }

    if (isImageAttachmentFilePath(normalizedPath)) {
      return this.openImageAttachmentReadStream(normalizedPath, { maxBytes });
    }

    return this.openFileReadStream(normalizedPath, {
      maxBytes,
      mimeType: getDownloadMimeType(normalizedPath),
      tooLargeError: 'File is too large to download',
    });
  }

  async persistCollaborationState(filePath, {
    commentThreads = [],
    content = '',
    expectedContent,
    expectedText,
    includeContent = true,
    snapshot = null,
  } = {}) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved) {
      return {
        ok: false,
        error: getEditableVaultContentKind(filePath)?.invalidPathError ?? INVALID_VAULT_FILE_PATH_ERROR,
        statusCode: 400,
      };
    }

    const validationError = includeContent && getContentValidationError(filePath, content);
    if (validationError) return { ok: false, error: validationError, statusCode: 400 };

    const commentPath = this.sidecarStore.getCommentThreadPath(filePath);
    const snapshotPath = this.sidecarStore.getSnapshotPath(filePath);
    if (!commentPath || !snapshotPath) {
      return { ok: false, error: 'Invalid collaboration state path' };
    }

    const operations = [
      {
        kind: Array.isArray(commentThreads) && commentThreads.length > 0 ? 'write' : 'delete',
        targetPath: commentPath,
        value: createCommentThreadsPayload(commentThreads),
        writeOptions: { encoding: 'utf-8', mode: 0o600 },
      },
      {
        kind: snapshot ? 'write' : 'delete',
        targetPath: snapshotPath,
        value: snapshot ? Buffer.from(snapshot) : null,
        writeOptions: { mode: 0o600 },
      },
      includeContent ? {
        kind: 'write',
        targetPath: resolved.absolute,
        value: content,
        writeOptions: 'utf-8',
      } : null,
    ].filter((operation) => operation?.targetPath);

    const stagingRoot = sanitizeVaultPath(this.vaultDir, '.collabmd/.tmp', { allowIgnored: true });
    if (!stagingRoot) return { ok: false, error: 'Invalid collaboration staging path' };

    try {
      const persist = async () => {
        await mkdir(stagingRoot, { recursive: true });
        const stagingDir = await mkdtemp(join(stagingRoot, 'transaction-'));
        const committedOperations = [];
        try {
          for (const [index, operation] of operations.entries()) {
            if (operation.kind !== 'write') continue;
            operation.tempPath = join(stagingDir, `write-${index}`);
            await mkdir(dirname(operation.targetPath), { recursive: true });
            await writeFile(operation.tempPath, operation.value, operation.writeOptions);
          }
          for (const [index, operation] of operations.entries()) {
            const previous = await stat(operation.targetPath, { throwIfNoEntry: false });
            const backupPath = previous ? join(stagingDir, `backup-${index}`) : null;
            if (operation.kind === 'write') {
              if (backupPath) {
                await copyFile(operation.targetPath, backupPath);
                if (operation.targetPath === resolved.absolute) {
                  await chmod(operation.tempPath, previous.mode & 0o777);
                }
              }
              if (operation.targetPath === resolved.absolute && (expectedText !== undefined || expectedContent !== undefined)) {
                const currentContent = await this.readEditableVaultContent(filePath);
                const matches = expectedContent !== undefined
                  ? currentContent === expectedContent
                  : currentContent !== null && normalizeEditableText(currentContent) === expectedText;
                if (!matches) {
                  throw new VaultContentChanged(currentContent);
                }
              }
              await rename(operation.tempPath, operation.targetPath);
            } else if (backupPath) {
              await rename(operation.targetPath, backupPath);
            }
            committedOperations.push({ backupPath, targetPath: operation.targetPath, kind: operation.kind });
          }
        } catch (error) {
          for (const operation of committedOperations.reverse()) {
            if (operation.backupPath) await rename(operation.backupPath, operation.targetPath);
            else if (operation.kind === 'write') await rm(operation.targetPath, { force: true });
          }
          await rm(stagingDir, { force: true, recursive: true }).catch(() => {});
          throw error;
        }
        await rm(stagingDir, { force: true, recursive: true }).catch(() => {});
      };
      await (includeContent ? this.runManagedWrite([filePath], persist, content) : persist());
      return { ok: true };
    } catch (error) {
      if (error instanceof VaultContentChanged) return { ok: false, diskChanged: true, currentContent: error.currentContent };
      return { ok: false, error: error.message };
    }
  }

  async readCommentThreads(filePath) {
    return this.sidecarStore.readCommentThreads(filePath);
  }

  async readCommentOverview({ filePaths }) {
    const commentSupportedFilePaths = filePaths.filter((filePath) => (
      supportsCommentsForFilePath(filePath)
    ));
    const entries = await this.sidecarStore.listCommentThreadEntries({
      filePaths: commentSupportedFilePaths,
    });
    return createCommentOverview(entries);
  }

  async writeCommentThreads(filePath, threads = []) {
    return this.sidecarStore.writeCommentThreads(filePath, threads);
  }

  async readCollaborationSnapshot(filePath) {
    return this.sidecarStore.readSnapshot(filePath);
  }

  async writeCollaborationSnapshot(filePath, snapshot) {
    return this.sidecarStore.writeSnapshot(filePath, snapshot);
  }

  async deleteCollaborationSnapshot(filePath) {
    return this.sidecarStore.deleteSnapshot(filePath);
  }

  async createFile(filePath, content = '') {
    const { absolute, error } = resolveVaultFilePath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error, statusCode: 400 };
    }

    const validationError = getContentValidationError(filePath, content);
    if (validationError) return { ok: false, error: validationError, statusCode: 400 };

    try {
      await this.runManagedWrite([filePath], async () => {
        await mkdir(dirname(absolute), { recursive: true });
        await writeFile(absolute, content, { encoding: 'utf-8', flag: 'wx' });
        await this.deleteCollaborationSnapshot(filePath);
      }, getEditableVaultContentKind(filePath) ? content.toString() : undefined);
    } catch (error) {
      if (error.code === 'EEXIST') return { ok: false, error: 'File already exists', statusCode: 409 };
      throw error;
    }
    return { ok: true };
  }

  async listWorkspacePathsUnder(pathValue, { rejectUnlisted = false } = {}) {
    const normalizedRoot = String(pathValue ?? '').replace(/\\/g, '/').trim();
    if (!normalizedRoot) {
      return [];
    }

    const { absolute } = resolveVaultDirectoryPath(this.vaultDir, normalizedRoot);
    if (!absolute) {
      return [];
    }

    try {
      const info = await stat(absolute);
      if (!info.isDirectory()) {
        return [];
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }

    const paths = [normalizedRoot];
    const visitDirectory = async (directoryPath) => {
      const dirEntries = await readdir(directoryPath, { withFileTypes: true });
      const sortedEntries = dirEntries.sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

      for (const entry of sortedEntries) {
        const isListed = !isIgnoredVaultEntry(entry.name) && !entry.name.includes('\\')
          && (entry.isDirectory() || (entry.isFile() && isVaultFilePath(entry.name)));
        if (!isListed) {
          if (rejectUnlisted) {
            const error = new Error('Folder contains entries that are hidden from the vault explorer');
            error.code = 'UNLISTED_ENTRIES';
            throw error;
          }
          continue;
        }

        const childAbsolutePath = join(directoryPath, entry.name);
        const relativePath = toVaultRelativePath(this.vaultDir, childAbsolutePath).replace(/\\/g, '/');
        if (entry.isDirectory()) {
          paths.push(relativePath);
          await visitDirectory(childAbsolutePath);
          continue;
        }

        if (isVaultFilePath(entry.name)) {
          paths.push(relativePath);
        }
      }
    };

    await visitDirectory(absolute);
    return sortWorkspacePaths(paths);
  }

  async resolveDirectoryDownloadRoot(dirPath) {
    const normalizedPath = String(dirPath ?? '').replace(/\\/g, '/').trim();
    const { absolute, error } = resolveVaultDirectoryPath(this.vaultDir, normalizedPath);
    if (!absolute) {
      return { ok: false, error, statusCode: 400 };
    }

    try {
      const info = await stat(absolute);
      if (!info.isDirectory()) {
        return { ok: false, error: 'Directory not found', statusCode: 404 };
      }
    } catch (statError) {
      if (statError.code === 'ENOENT' || statError.code === 'ENOTDIR') {
        return { ok: false, error: 'Directory not found', statusCode: 404 };
      }

      throw statError;
    }

    return {
      absolute,
      ok: true,
      rootName: basename(normalizedPath),
    };
  }

  async collectDirectoryDownloadEntries(directoryAbsolutePath, { maxEntries = Infinity } = {}) {
    const entries = [];
    let count = 0;
    const visitDirectory = async (currentDirectoryPath, relativeDirectoryPath = '') => {
      const dirEntries = sortDirectoryEntries(await readdir(currentDirectoryPath, { withFileTypes: true }))
        .filter((entry) => !isIgnoredVaultEntry(entry.name));

      if (dirEntries.length === 0) {
        count += 1;
        if (count > maxEntries) {
          return false;
        }

        entries.push({ kind: 'directory', relativePath: relativeDirectoryPath });
        return true;
      }

      for (const entry of dirEntries) {
        const childAbsolutePath = join(currentDirectoryPath, entry.name);
        const childRelativePath = relativeDirectoryPath ? `${relativeDirectoryPath}/${entry.name}` : entry.name;
        if (entry.isDirectory()) {
          const withinLimit = await visitDirectory(childAbsolutePath, childRelativePath);
          if (!withinLimit) {
            return false;
          }
          continue;
        }

        if (entry.isFile()) {
          count += 1;
          if (count > maxEntries) {
            return false;
          }

          entries.push({
            absolutePath: childAbsolutePath,
            kind: 'file',
            relativePath: childRelativePath,
          });
        }
      }

      return true;
    };

    const withinLimit = await visitDirectory(directoryAbsolutePath);
    return {
      entries,
      withinLimit,
    };
  }

  async deleteFile(filePath) {
    const { absolute, error } = resolveVaultFilePath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error, statusCode: 400 };
    }

    try {
      await this.runManagedWrite(expandManagedPaths([filePath]), async () => {
        await rm(absolute, { force: true });
        await this.sidecarStore.deleteAllForFile(filePath);
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not update vault content', statusCode: 500 };
    }
  }

  async renameFile(oldPath, newPath) {
    const { absoluteNew, absoluteOld, error } = resolveVaultRenamePaths(this.vaultDir, oldPath, newPath);
    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error, statusCode: 400 };
    }

    try {
      if (!(await stat(absoluteOld)).isFile()) {
        return { ok: false, error: 'Path is not a file', statusCode: 400 };
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return { ok: false, error: 'File not found', statusCode: 404 };
      }
      throw error;
    }

    if (absoluteOld === absoluteNew) {
      return { ok: true };
    }

    try {
      await this.runManagedWrite(expandManagedPaths([oldPath, newPath]), async () => {
        await mkdir(dirname(absoluteNew), { recursive: true });
        await moveFileWithoutReplacing(absoluteOld, absoluteNew);
        await this.sidecarStore.renameAllForFile(oldPath, newPath);
      });
      return { ok: true };
    } catch (error) {
      if (error.code === 'EEXIST') return { ok: false, error: 'Target path already exists', statusCode: 409 };
      return { ok: false, error: 'Could not update vault content', statusCode: 500 };
    }
  }

  async createDirectory(dirPath) {
    const { absolute, error } = resolveVaultDirectoryPath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error, statusCode: 400 };
    }

    try {
      await this.runManagedWrite([dirPath], () => mkdir(absolute, { recursive: true }));
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not update vault content', statusCode: 500 };
    }
  }

  async renameDirectory(oldPath, newPath) {
    const { absoluteNew, absoluteOld, error } = resolveVaultDirectoryRenamePaths(this.vaultDir, oldPath, newPath);
    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error, statusCode: 400 };
    }

    try {
      if (!(await stat(absoluteOld)).isDirectory()) {
        return { ok: false, error: 'Path is not a directory', statusCode: 400 };
      }
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'ENOTDIR') {
        return { ok: false, error: 'Directory not found', statusCode: 404 };
      }
      throw error;
    }

    if (absoluteOld === absoluteNew) {
      return { ok: true };
    }

    if (await stat(absoluteNew, { throwIfNoEntry: false })) {
      return { ok: false, error: 'Target path already exists', statusCode: 409 };
    }

    const managedPaths = await this.listWorkspacePathsUnder(oldPath);
    const nextManagedPaths = managedPaths.map((pathValue) => replacePathPrefix(pathValue, oldPath, newPath));

    try {
      await this.runManagedWrite(expandManagedPaths([oldPath, newPath, ...managedPaths, ...nextManagedPaths]), async () => {
        await mkdir(dirname(absoluteNew), { recursive: true });
        await rename(absoluteOld, absoluteNew);
        await Promise.all(
          managedPaths.map((pathValue, index) => this.sidecarStore.renameAllForFile(pathValue, nextManagedPaths[index])),
        );
      });
      return { ok: true };
    } catch {
      return { ok: false, error: 'Could not rename directory', statusCode: 500 };
    }
  }

  async deleteDirectory(dirPath, { recursive = false } = {}) {
    const { absolute, error } = resolveVaultDirectoryPath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error, statusCode: 400 };
    }

    try {
      const info = await stat(absolute);
      if (!info.isDirectory()) {
        return { ok: false, error: 'Path is not a directory', statusCode: 400 };
      }
    } catch (statError) {
      if (statError.code === 'ENOENT') {
        return { ok: true };
      }

      return { ok: false, error: 'Could not inspect directory', statusCode: 500 };
    }

    try {
      const managedPaths = await this.listWorkspacePathsUnder(dirPath, { rejectUnlisted: recursive });
      if (!recursive) {
        const contents = await readdir(absolute);
        if (contents.length > 0) {
          return { ok: false, error: 'Directory is not empty', statusCode: 409 };
        }
      }

      await this.runManagedWrite(expandManagedPaths([dirPath, ...managedPaths]), async () => {
        if (recursive) {
          for (const filePath of [...managedPaths].reverse()) {
            const target = sanitizeVaultPath(this.vaultDir, filePath, { preservePath: true });
            if (!target) throw new Error('Folder contents changed');
            const info = await lstat(target, { throwIfNoEntry: false });
            if (info?.isDirectory()) await rmdir(target);
            else if (info?.isFile()) await unlink(target);
            else if (info) {
              const error = new Error('Folder contents changed. Review the folder and try again.');
              error.code = 'UNLISTED_ENTRIES';
              throw error;
            }
          }
        } else {
          await rmdir(absolute);
        }
        await Promise.all(
          managedPaths.map((pathValue) => this.sidecarStore.deleteAllForFile(pathValue)),
        );
      });
      return { ok: true };
    } catch (deleteError) {
      if (deleteError.code === 'UNLISTED_ENTRIES') {
        return { ok: false, error: deleteError.message, statusCode: 409 };
      }
      if (deleteError.code === 'ENOTEMPTY' || deleteError.code === 'EEXIST') {
        return { ok: false, error: 'Directory is not empty', statusCode: 409 };
      }
      return { ok: false, error: 'Could not delete directory', statusCode: 500 };
    }
  }

  async reconcileSidecars({
    deletedPaths = [],
    renamedPaths = [],
  } = {}) {
    await Promise.allSettled([
      ...Array.from(new Set((deletedPaths ?? []).filter(Boolean)), (filePath) => this.sidecarStore.deleteAllForFile(filePath)),
      ...Array.from(
        new Map(
          (renamedPaths ?? [])
            .filter((entry) => entry?.oldPath && entry?.newPath && entry.oldPath !== entry.newPath)
            .map((entry) => [`${entry.oldPath}:${entry.newPath}`, entry]),
        ).values(),
        (entry) => this.sidecarStore.renameAllForFile(entry.oldPath, entry.newPath),
      ),
    ]);
  }

  async reconcileCollaborationSnapshots({
    changedPaths = [],
    deletedPaths = [],
  } = {}) {
    const affectedPaths = new Set([
      ...(changedPaths ?? []).filter(Boolean),
      ...(deletedPaths ?? []).filter(Boolean),
    ]);

    await Promise.allSettled(
      Array.from(affectedPaths, (filePath) => this.deleteCollaborationSnapshot(filePath)),
    );
  }

  async scanWorkspaceState() {
    return scanWorkspaceStateFromAdapter(createWorkspaceStateFileSystemAdapter({
      vaultDir: this.vaultDir,
    }));
  }
}
