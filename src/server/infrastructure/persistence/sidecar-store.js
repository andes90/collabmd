import { dirname, relative, resolve } from 'node:path';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';

import { resolveVaultFilePath, sanitizeVaultPath, toVaultRelativePath } from './path-utils.js';
import { mapWithConcurrency } from '../../shared/async-utils.js';

const COMMENT_STORAGE_ROOT = '.collabmd/comments';
const YJS_SNAPSHOT_STORAGE_ROOT = '.collabmd/yjs';
const COMMENT_READ_CONCURRENCY = 8;

function resolveSidecarPath(vaultDir, filePath, storageRoot, extension) {
  const { absolute: absoluteVaultPath } = resolveVaultFilePath(vaultDir, filePath);
  if (!absoluteVaultPath) {
    return null;
  }

  const relativeVaultPath = toVaultRelativePath(vaultDir, absoluteVaultPath);
  return sanitizeVaultPath(vaultDir, `${storageRoot}/${relativeVaultPath}${extension}`, { allowIgnored: true });
}

async function renameIfPresent(sourcePath, targetPath) {
  if (!sourcePath || !targetPath) {
    return;
  }

  try {
    await stat(sourcePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await rename(sourcePath, targetPath);
  } catch (error) {
    if (error.code !== 'ENOENT') {
      throw error;
    }
  }
}

export class SidecarStore {
  constructor({ vaultDir }) {
    this.vaultDir = vaultDir;
  }

  getCommentThreadPath(filePath) {
    return resolveSidecarPath(this.vaultDir, filePath, COMMENT_STORAGE_ROOT, '.json');
  }

  getCommentStorageRootPath() {
    return sanitizeVaultPath(this.vaultDir, COMMENT_STORAGE_ROOT, { allowIgnored: true });
  }

  getSnapshotPath(filePath) {
    return resolveSidecarPath(this.vaultDir, filePath, YJS_SNAPSHOT_STORAGE_ROOT, '.bin');
  }

  async readCommentThreads(filePath) {
    const absolute = this.getCommentThreadPath(filePath);
    if (!absolute) {
      return [];
    }

    try {
      const raw = await readFile(absolute, 'utf-8');
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        return parsed;
      }

      return Array.isArray(parsed?.threads) ? parsed.threads : [];
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }

      throw error;
    }
  }

  async listCommentThreadEntries({ filePaths = null } = {}) {
    const allowedPaths = filePaths ? new Set(filePaths) : null;
    const rootPath = this.getCommentStorageRootPath();
    if (!rootPath) {
      return [];
    }
    let dirEntries;
    try {
      dirEntries = await readdir(rootPath, { recursive: true, withFileTypes: true });
    } catch (error) {
      if (error.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const commentFilePaths = [];
    for (const entry of dirEntries) {
      if (!entry.isFile() || !entry.name.endsWith('.json')) {
        continue;
      }
      const relativePath = relative(rootPath, resolve(entry.parentPath, entry.name)).replace(/\\/g, '/');
      const filePath = relativePath.slice(0, -'.json'.length);
      if (!allowedPaths || allowedPaths.has(filePath)) {
        commentFilePaths.push(filePath);
      }
    }
    commentFilePaths.sort((left, right) => left.localeCompare(right));
    const entries = (await mapWithConcurrency(
      commentFilePaths,
      COMMENT_READ_CONCURRENCY,
      async (filePath) => {
        const threads = await this.readCommentThreads(filePath);
        return threads.length > 0 ? { filePath, threads } : null;
      },
    )).filter(Boolean);
    return entries.sort((left, right) => left.filePath.localeCompare(right.filePath, undefined, { sensitivity: 'base' }));
  }

  async writeCommentThreads(filePath, threads = []) {
    const absolute = this.getCommentThreadPath(filePath);
    if (!absolute) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      if (!Array.isArray(threads) || threads.length === 0) {
        await rm(absolute, { force: true });
        return { ok: true };
      }

      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, `${JSON.stringify({
        threads,
        version: 1,
      }, null, 2)}\n`, { encoding: 'utf-8', mode: 0o600 });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async readSnapshot(filePath) {
    const absolute = this.getSnapshotPath(filePath);
    if (!absolute) {
      return null;
    }

    try {
      const content = await readFile(absolute);
      return new Uint8Array(content);
    } catch (error) {
      if (error.code === 'ENOENT') {
        return null;
      }

      throw error;
    }
  }

  async writeSnapshot(filePath, snapshot) {
    const absolute = this.getSnapshotPath(filePath);
    if (!absolute) {
      return { ok: false, error: 'Invalid file path' };
    }

    const tempPath = `${absolute}.collabmd-tmp-${randomUUID()}`;
    try {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(tempPath, Buffer.from(snapshot), { flag: 'wx', mode: 0o600 });
      await rename(tempPath, absolute);
      return { ok: true };
    } catch (error) {
      await rm(tempPath, { force: true }).catch(() => {});
      return { ok: false, error: error.message };
    }
  }

  async deleteSnapshot(filePath) {
    const absolute = this.getSnapshotPath(filePath);
    if (!absolute) {
      return { ok: false, error: 'Invalid file path' };
    }

    try {
      await rm(absolute, { force: true });
      return { ok: true };
    } catch (error) {
      return { ok: false, error: error.message };
    }
  }

  async deleteAllForFile(filePath) {
    const paths = [this.getCommentThreadPath(filePath), this.getSnapshotPath(filePath)];
    await Promise.all(paths.filter(Boolean).map(async (pathValue) => rm(pathValue, { force: true })));
  }

  async renameAllForFile(oldPath, newPath) {
    await renameIfPresent(this.getCommentThreadPath(oldPath), this.getCommentThreadPath(newPath));
    await renameIfPresent(this.getSnapshotPath(oldPath), this.getSnapshotPath(newPath));
  }
}
