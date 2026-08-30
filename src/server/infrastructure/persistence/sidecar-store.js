import { dirname, join, resolve } from 'path';
import { mkdir, readFile, readdir, rename, rm, stat, writeFile } from 'fs/promises';

import { resolveVaultFilePath, toVaultRelativePath } from './path-utils.js';
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
  return resolve(vaultDir, storageRoot, `${relativeVaultPath}${extension}`);
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
    return resolve(this.vaultDir, COMMENT_STORAGE_ROOT);
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
    const commentFilePaths = [];

    const visitDirectory = async (absoluteDirectoryPath, relativeDirectoryPath = '') => {
      let dirEntries;
      try {
        dirEntries = await readdir(absoluteDirectoryPath, { withFileTypes: true });
      } catch (error) {
        if (error.code === 'ENOENT') {
          return;
        }
        throw error;
      }

      for (const entry of dirEntries.sort((left, right) => left.name.localeCompare(right.name))) {
        const relativePath = relativeDirectoryPath
          ? `${relativeDirectoryPath}/${entry.name}`
          : entry.name;
        const absolutePath = join(absoluteDirectoryPath, entry.name);

        if (entry.isDirectory()) {
          await visitDirectory(absolutePath, relativePath);
          continue;
        }

        if (!entry.isFile() || !relativePath.endsWith('.json')) {
          continue;
        }

        const filePath = relativePath.slice(0, -'.json'.length);
        if (allowedPaths && !allowedPaths.has(filePath)) {
          continue;
        }

        commentFilePaths.push(filePath);
      }
    };

    await visitDirectory(rootPath);
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
      }, null, 2)}\n`, 'utf-8');
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

    try {
      await mkdir(dirname(absolute), { recursive: true });
      await writeFile(absolute, Buffer.from(snapshot));
      return { ok: true };
    } catch (error) {
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
