import { mkdir, readFile, readdir, rename, rm, rmdir, stat, writeFile } from 'fs/promises';
import { basename, dirname, extname, join, relative, resolve } from 'path';

import {
  getVaultTreeNodeType,
  isImageAttachmentFilePath,
  isMarkdownFilePath,
  isVaultFilePath,
} from '../../../domain/file-kind.js';
import { getVaultContentAdapter } from './vault-content-adapter.js';
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

const IMAGE_EXTENSION_TO_MIME_TYPE = Object.freeze({
  '.gif': 'image/gif',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
});

const MIME_TYPE_TO_IMAGE_EXTENSION = Object.freeze({
  'image/gif': '.gif',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/svg+xml': '.svg',
  'image/webp': '.webp',
});

function createTransactionalPath(targetPath, label) {
  return `${targetPath}.collabmd-${label}-${process.pid}-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function createCommentThreadsPayload(threads = []) {
  return `${JSON.stringify({
    threads,
    version: 1,
  }, null, 2)}\n`;
}

async function pathExists(pathValue) {
  try {
    await stat(pathValue);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') {
      return false;
    }

    throw error;
  }
}

function createWorkspaceEntry(relativePath, type) {
  return {
    fileKind: type === 'directory' ? null : getVaultTreeNodeType(relativePath),
    name: basename(relativePath),
    nodeType: type,
    parentPath: dirname(relativePath).replace(/\\/g, '/') === '.'
      ? ''
      : dirname(relativePath).replace(/\\/g, '/'),
    path: relativePath,
    type: type === 'directory' ? 'directory' : getVaultTreeNodeType(relativePath),
  };
}

function replacePathPrefix(pathValue, oldPrefix, newPrefix) {
  if (pathValue === oldPrefix) {
    return newPrefix;
  }

  return `${newPrefix}${pathValue.slice(oldPrefix.length)}`;
}

function sortWorkspacePaths(paths = [], direction = 'asc') {
  const factor = direction === 'desc' ? -1 : 1;
  return [...paths].sort((left, right) => {
    const depthDelta = left.split('/').length - right.split('/').length;
    if (depthDelta !== 0) {
      return depthDelta * factor;
    }

    return left.localeCompare(right, undefined, { sensitivity: 'base' }) * factor;
  });
}

async function cleanupPaths(paths = []) {
  await Promise.allSettled(paths.filter(Boolean).map((pathValue) => rm(pathValue, { force: true })));
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

function createDocumentAttachmentDirectoryPath(documentPath) {
  const normalizedPath = String(documentPath ?? '').replace(/\\/g, '/');
  const documentDir = dirname(normalizedPath).replace(/\\/g, '/');
  const documentStem = basename(normalizedPath, extname(normalizedPath));
  return documentDir === '.'
    ? `${documentStem}.assets`
    : `${documentDir}/${documentStem}.assets`;
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

function createAttachmentMarkdownSnippet({ altText, documentPath, storedPath }) {
  const relativePath = relative(dirname(documentPath), storedPath).replace(/\\/g, '/');
  const encodedRelativePath = encodeMarkdownPath(relativePath || basename(storedPath));
  return `![${escapeMarkdownText(altText)}](${encodedRelativePath})`;
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

  async runManagedWrite(paths, operation) {
    if (!this.managedWriteTracker?.runManagedWrite) {
      return operation();
    }

    return this.managedWriteTracker.runManagedWrite(paths, operation);
  }

  async tree() {
    return this.readDirectory(this.vaultDir);
  }

  async readDirectory(dirPath) {
    const entries = [];

    let dirEntries;
    try {
      dirEntries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return entries;
    }

    const sorted = dirEntries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1;
      if (!a.isDirectory() && b.isDirectory()) return 1;
      return a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
    });

    for (const entry of sorted) {
      if (isIgnoredVaultEntry(entry.name)) {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      const relativePath = toVaultRelativePath(this.vaultDir, fullPath);

      if (entry.isDirectory()) {
        entries.push({
          children: await this.readDirectory(fullPath),
          name: entry.name,
          path: relativePath,
          type: 'directory',
        });
        continue;
      }

      if (isVaultFilePath(entry.name)) {
        entries.push({
          name: entry.name,
          path: relativePath,
          type: getVaultTreeNodeType(entry.name),
        });
      }
    }

    return entries;
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

    const adapter = getVaultContentAdapter(absolute);
    if (!adapter) {
      return null;
    }

    return { absolute, adapter };
  }

  async readContentFile(filePath, expectedKind) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved || resolved.adapter.kind !== expectedKind) {
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

  async writeContentFile(filePath, content, expectedKind, { invalidateCollaborationSnapshot = true } = {}) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved || resolved.adapter.kind !== expectedKind) {
      return {
        ok: false,
        error: resolved?.adapter?.invalidPathError ?? getVaultContentAdapter(filePath)?.invalidPathError ?? INVALID_VAULT_FILE_PATH_ERROR,
      };
    }

    try {
      await this.runManagedWrite([filePath], async () => {
        await mkdir(dirname(resolved.absolute), { recursive: true });
        await writeFile(resolved.absolute, content, 'utf-8');
        if (invalidateCollaborationSnapshot) {
          await this.deleteCollaborationSnapshot(filePath);
        }
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async readMarkdownFile(filePath) {
    return this.readContentFile(filePath, 'markdown');
  }

  async readExcalidrawFile(filePath) {
    return this.readContentFile(filePath, 'excalidraw');
  }

  async readDrawioFile(filePath) {
    return this.readContentFile(filePath, 'drawio');
  }

  async readMermaidFile(filePath) {
    return this.readContentFile(filePath, 'mermaid');
  }

  async readPlantUmlFile(filePath) {
    return this.readContentFile(filePath, 'plantuml');
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

  async writeMarkdownFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'markdown', options);
  }

  async writeExcalidrawFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'excalidraw', options);
  }

  async writeDrawioFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'drawio', options);
  }

  async writeMermaidFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'mermaid', options);
  }

  async writePlantUmlFile(filePath, content, options = {}) {
    return this.writeContentFile(filePath, content, 'plantuml', options);
  }

  async writeImageAttachmentForDocument(sourceDocumentPath, {
    content,
    mimeType,
    originalFileName = '',
    now = new Date(),
  } = {}) {
    if (!Buffer.isBuffer(content) || content.byteLength === 0) {
      return { ok: false, error: 'Missing attachment content' };
    }

    if (!isMarkdownFilePath(sourceDocumentPath)) {
      return { ok: false, error: 'Source document must be a markdown file' };
    }

    const extension = resolveAttachmentExtension({ mimeType, originalFileName });
    if (!extension) {
      return { ok: false, error: 'Unsupported image type' };
    }

    const stemSource = basename(String(originalFileName ?? ''), extname(String(originalFileName ?? '')));
    const attachmentStem = sanitizeAttachmentStem(stemSource, 'image');
    const attachmentDirPath = createDocumentAttachmentDirectoryPath(sourceDocumentPath);
    const timestamp = createAttachmentTimestamp(now);
    const baseFileName = `${attachmentStem}-${timestamp}`;
    let collisionIndex = 0;
    let storedPath = '';
    let absolutePath = '';

    do {
      const suffix = collisionIndex > 0 ? `-${collisionIndex + 1}` : '';
      storedPath = `${attachmentDirPath}/${baseFileName}${suffix}${extension}`;
      absolutePath = this.resolveContentPath(storedPath, { requireVaultFile: false });
      collisionIndex += 1;
    } while (absolutePath && await pathExists(absolutePath));

    if (!absolutePath || !isImageAttachmentFilePath(storedPath)) {
      return { ok: false, error: INVALID_VAULT_FILE_PATH_ERROR };
    }

    try {
      await this.runManagedWrite([storedPath], async () => {
        await mkdir(dirname(absolutePath), { recursive: true });
        await writeFile(absolutePath, content);
      });
    } catch (error) {
      return { ok: false, error: error.message };
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

  async persistCollaborationState(filePath, {
    commentThreads = [],
    content = '',
    snapshot = null,
  } = {}) {
    const resolved = this.resolveAdapter(filePath);
    if (!resolved) {
      return {
        ok: false,
        error: getVaultContentAdapter(filePath)?.invalidPathError ?? INVALID_VAULT_FILE_PATH_ERROR,
      };
    }

    const operations = [
      {
        kind: Array.isArray(commentThreads) && commentThreads.length > 0 ? 'write' : 'delete',
        targetPath: this.sidecarStore.getCommentThreadPath(filePath),
        value: createCommentThreadsPayload(commentThreads),
        writeOptions: 'utf-8',
      },
      {
        kind: snapshot ? 'write' : 'delete',
        targetPath: this.sidecarStore.getSnapshotPath(filePath),
        value: snapshot ? Buffer.from(snapshot) : null,
      },
      {
        kind: 'write',
        targetPath: resolved.absolute,
        value: content,
        writeOptions: 'utf-8',
      },
    ].filter((operation) => operation.targetPath);

    const stagedWrites = [];
    const committedOperations = [];

    try {
      await this.runManagedWrite([filePath], async () => {
        for (const operation of operations) {
          if (operation.kind !== 'write') {
            continue;
          }

          const tempPath = createTransactionalPath(operation.targetPath, 'tmp');
          await mkdir(dirname(operation.targetPath), { recursive: true });
          await writeFile(tempPath, operation.value, operation.writeOptions);
          operation.tempPath = tempPath;
          stagedWrites.push(tempPath);
        }

        for (const operation of operations) {
          const hadExistingTarget = await pathExists(operation.targetPath);
          const backupPath = hadExistingTarget
            ? createTransactionalPath(operation.targetPath, 'bak')
            : null;

          if (backupPath) {
            await rename(operation.targetPath, backupPath);
          }

          try {
            if (operation.kind === 'write') {
              await rename(operation.tempPath, operation.targetPath);
              const stagedIndex = stagedWrites.indexOf(operation.tempPath);
              if (stagedIndex >= 0) {
                stagedWrites.splice(stagedIndex, 1);
              }
            }
          } catch (error) {
            if (backupPath) {
              await rename(backupPath, operation.targetPath);
            }
            throw error;
          }

          committedOperations.push({
            backupPath,
            kind: operation.kind,
            targetPath: operation.targetPath,
          });
        }
      });

      await cleanupPaths(committedOperations.map((operation) => operation.backupPath));
      return { ok: true };
    } catch (error) {
      for (const operation of committedOperations.reverse()) {
        if (operation.kind === 'write') {
          await rm(operation.targetPath, { force: true });
        }

        if (operation.backupPath) {
          await rename(operation.backupPath, operation.targetPath);
        }
      }

      await cleanupPaths(stagedWrites);
      await cleanupPaths(committedOperations.map((operation) => operation.backupPath));
      return { ok: false, error: error.message };
    }
  }

  async readCommentThreads(filePath) {
    return this.sidecarStore.readCommentThreads(filePath);
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
      return { ok: false, error };
    }

    try {
      await stat(absolute);
      return { ok: false, error: 'File already exists' };
    } catch (error) {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    }

    await this.runManagedWrite([filePath], async () => {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, content, 'utf-8');
      await this.deleteCollaborationSnapshot(filePath);
    });
    return { ok: true };
  }

  async listWorkspacePathsUnder(pathValue) {
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
        if (isIgnoredVaultEntry(entry.name)) {
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

  async deleteFile(filePath) {
    const { absolute, error } = resolveVaultFilePath(this.vaultDir, filePath);
    if (!absolute) {
      return { ok: false, error };
    }

    try {
      await this.runManagedWrite([filePath], async () => {
        await rm(absolute, { force: true });
        await this.sidecarStore.deleteAllForFile(filePath);
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async renameFile(oldPath, newPath) {
    const { absoluteNew, absoluteOld, error } = resolveVaultRenamePaths(this.vaultDir, oldPath, newPath);
    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error };
    }

    if (absoluteOld === absoluteNew) {
      return { ok: true };
    }

    if (await pathExists(absoluteNew)) {
      return { ok: false, error: 'Target path already exists' };
    }

    try {
      await this.runManagedWrite([oldPath, newPath], async () => {
        await mkdir(dirname(absoluteNew), { recursive: true });
        await rename(absoluteOld, absoluteNew);
        await this.sidecarStore.renameAllForFile(oldPath, newPath);
      });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async createDirectory(dirPath) {
    const { absolute, error } = resolveVaultDirectoryPath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error };
    }

    try {
      await this.runManagedWrite([dirPath], () => mkdir(absolute, { recursive: true }));
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async renameDirectory(oldPath, newPath) {
    const { absoluteNew, absoluteOld, error } = resolveVaultDirectoryRenamePaths(this.vaultDir, oldPath, newPath);
    if (!absoluteOld || !absoluteNew) {
      return { ok: false, error };
    }

    if (absoluteOld === absoluteNew) {
      return { ok: true };
    }

    if (await pathExists(absoluteNew)) {
      return { ok: false, error: 'Target path already exists' };
    }

    const managedPaths = await this.listWorkspacePathsUnder(oldPath);
    const nextManagedPaths = managedPaths.map((pathValue) => replacePathPrefix(pathValue, oldPath, newPath));

    try {
      await this.runManagedWrite([oldPath, newPath, ...managedPaths, ...nextManagedPaths], async () => {
        await mkdir(dirname(absoluteNew), { recursive: true });
        await rename(absoluteOld, absoluteNew);
        await Promise.all(
          managedPaths.map((pathValue, index) => this.sidecarStore.renameAllForFile(pathValue, nextManagedPaths[index])),
        );
      });
      return { ok: true };
    } catch (renameError) {
      return { ok: false, error: renameError.message };
    }
  }

  async deleteDirectory(dirPath, { recursive = false } = {}) {
    const { absolute, error } = resolveVaultDirectoryPath(this.vaultDir, dirPath);
    if (!absolute) {
      return { ok: false, error };
    }

    const managedPaths = await this.listWorkspacePathsUnder(dirPath);

    try {
      const info = await stat(absolute);
      if (!info.isDirectory()) {
        return { ok: false, error: 'Path is not a directory' };
      }
    } catch (statError) {
      if (statError.code === 'ENOENT') {
        return { ok: true };
      }

      return { ok: false, error: statError.message };
    }

    try {
      if (!recursive) {
        const contents = await readdir(absolute);
        if (contents.length > 0) {
          return { ok: false, error: 'Directory is not empty' };
        }
      }

      await this.runManagedWrite([dirPath, ...managedPaths], async () => {
        if (recursive) {
          await rm(absolute, { force: true, recursive: true });
        } else {
          await rmdir(absolute);
        }
        await Promise.all(
          managedPaths.map((pathValue) => this.sidecarStore.deleteAllForFile(pathValue)),
        );
      });
      return { ok: true };
    } catch (deleteError) {
      return { ok: false, error: deleteError.message };
    }
  }

  async countVaultFiles() {
    return this.countFilesInDir(this.vaultDir);
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

  async countFilesInDir(dirPath) {
    let count = 0;

    let entries;
    try {
      entries = await readdir(dirPath, { withFileTypes: true });
    } catch {
      return 0;
    }

    for (const entry of entries) {
      if (isIgnoredVaultEntry(entry.name)) {
        continue;
      }

      const fullPath = join(dirPath, entry.name);
      if (entry.isDirectory()) {
        count += await this.countFilesInDir(fullPath);
      } else if (isVaultFilePath(entry.name)) {
        count += 1;
      }
    }

    return count;
  }

  resolveWikiLink(linkTarget) {
    const normalized = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
    const absolute = this.resolveContentPath(normalized, { requireVaultFile: false });
    if (!absolute) {
      return null;
    }

    return toVaultRelativePath(this.vaultDir, absolute);
  }

  async scanWorkspaceState() {
    const entries = new Map();
    const metadata = new Map();

    const visitDirectory = async (dirPath) => {
      let dirEntries;
      try {
        dirEntries = await readdir(dirPath, { withFileTypes: true });
      } catch {
        return;
      }

      const sorted = dirEntries.sort((left, right) => {
        if (left.isDirectory() && !right.isDirectory()) return -1;
        if (!left.isDirectory() && right.isDirectory()) return 1;
        return left.name.localeCompare(right.name, undefined, { sensitivity: 'base' });
      });

      for (const entry of sorted) {
        if (isIgnoredVaultEntry(entry.name)) {
          continue;
        }

        const fullPath = join(dirPath, entry.name);
        const relativePath = toVaultRelativePath(this.vaultDir, fullPath).replace(/\\/g, '/');

        if (entry.isDirectory()) {
          entries.set(relativePath, createWorkspaceEntry(relativePath, 'directory'));
          try {
            const info = await stat(fullPath);
            metadata.set(relativePath, {
              inode: Number(info.ino || 0),
              mtimeMs: Number(info.mtimeMs || 0),
              path: relativePath,
              size: 0,
              type: 'directory',
            });
          } catch {
            // Ignore transient directories that disappear during scans.
          }
          await visitDirectory(fullPath);
          continue;
        }

        if (!isVaultFilePath(entry.name)) {
          continue;
        }

        entries.set(relativePath, createWorkspaceEntry(relativePath, 'file'));
        try {
          const info = await stat(fullPath);
          metadata.set(relativePath, {
            inode: Number(info.ino || 0),
            mtimeMs: Number(info.mtimeMs || 0),
            path: relativePath,
            size: Number(info.size || 0),
            type: 'file',
          });
        } catch {
          // Ignore transient files that disappear during scans.
        }
      }
    };

    await visitDirectory(this.vaultDir);

    return {
      entries,
      metadata,
      scannedAt: Date.now(),
    };
  }
}
