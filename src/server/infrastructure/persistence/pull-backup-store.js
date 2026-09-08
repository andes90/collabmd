import { copyFile, mkdir, readFile, readdir, stat, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { ensureCollabMetadataGitExclude } from '../git/local-exclude.js';
import { sanitizeVaultPath } from './path-utils.js';

const PULL_BACKUP_STORAGE_ROOT = '.collabmd/pull-backups';
const BACKUP_METADATA_PREFIX = '<!-- collabmd-pull-backup ';
const BACKUP_METADATA_SUFFIX = ' -->';

function normalizeRelativePath(pathValue = '') {
  return String(pathValue).replace(/\\/g, '/');
}

function createBackupId(headRef = null, createdAt = new Date().toISOString()) {
  const timestamp = normalizeRelativePath(createdAt)
    .replace(/[^0-9T]/g, '')
    .replace('T', '-')
    .replace(/Z$/u, '');
  const shortHead = String(headRef ?? 'workspace').trim().slice(0, 7) || 'workspace';
  return `${timestamp}-${shortHead}`;
}

function formatBackupMetadata(metadata = {}) {
  return `${BACKUP_METADATA_PREFIX}${JSON.stringify(metadata)}${BACKUP_METADATA_SUFFIX}`;
}

function parseBackupMetadata(content = '') {
  const firstLine = String(content).split(/\r?\n/u)[0] ?? '';
  if (!firstLine.startsWith(BACKUP_METADATA_PREFIX) || !firstLine.endsWith(BACKUP_METADATA_SUFFIX)) {
    return null;
  }

  try {
    return JSON.parse(firstLine.slice(BACKUP_METADATA_PREFIX.length, -BACKUP_METADATA_SUFFIX.length));
  } catch {
    return null;
  }
}

function formatSummary({
  backupEntries = [],
  backupId,
  branch = null,
  createdAt,
  fileCount = 0,
  headRef = null,
  targetRef = null,
} = {}) {
  const metadata = formatBackupMetadata({
    backupId,
    branch,
    createdAt,
    fileCount,
    headRef,
    targetRef,
  });
  const entryLines = backupEntries.length === 0
    ? ['No overlapping files could be copied from the worktree.']
    : backupEntries.flatMap((entry) => {
      const lines = [`- Original path: \`${entry.path}\``];
      if (entry.backupPath) {
        lines.push(`  Saved copy: \`${entry.backupPath}\``);
      } else {
        lines.push('  Saved copy: none (the file no longer existed in the worktree at backup time)');
      }
      if (entry.stagedPatchPath) {
        lines.push(`  Staged patch: \`${entry.stagedPatchPath}\``);
      }
      if (entry.worktreePatchPath) {
        lines.push(`  Worktree patch: \`${entry.worktreePatchPath}\``);
      }
      return lines;
    });

  return [
    metadata,
    '# Pull Backup',
    '',
    `Created: \`${createdAt}\``,
    `Branch: \`${branch || 'HEAD'}\``,
    `Base ref: \`${headRef || 'none'}\``,
    `Pulled to: \`${targetRef || 'none'}\``,
    `Files backed up: \`${fileCount}\``,
    '',
    'This backup was created because local dirty changes overlapped with incoming remote updates.',
    'The working tree was updated to the remote version so the latest upstream content is visible immediately.',
    '',
    '## Saved Files',
    '',
    ...entryLines,
    '',
    '## Recovery',
    '',
    'Compare the current file content against the saved copies above, then manually restore any changes you want to keep.',
    'Use `git apply --cached <staged patch>` to inspect or restore staged/index-only changes on a safe branch.',
    'Use `git apply <worktree patch>` to inspect or restore unstaged worktree changes on a safe branch.',
    '',
  ].join('\n');
}

export class PullBackupStore {
  constructor({ vaultDir }) {
    this.vaultDir = resolve(vaultDir);
  }

  resolveStoragePath(path) {
    const absolute = sanitizeVaultPath(this.vaultDir, path, { allowIgnored: true });
    if (!absolute) throw new Error('Unsafe pull backup path');
    return absolute;
  }

  getStorageRoot() {
    return this.resolveStoragePath(PULL_BACKUP_STORAGE_ROOT);
  }

  getBackupPath(backupId) {
    return this.resolveStoragePath(`${PULL_BACKUP_STORAGE_ROOT}/${backupId}`);
  }

  getSummaryPath(backupId) {
    return `${PULL_BACKUP_STORAGE_ROOT}/${backupId}/summary.md`;
  }

  async createBackup({
    branch = null,
    createdAt = new Date().toISOString(),
    entries = [],
    headRef = null,
    targetRef = null,
  } = {}) {
    const backupId = createBackupId(headRef, createdAt);
    const filesRoot = this.resolveStoragePath(`${PULL_BACKUP_STORAGE_ROOT}/${backupId}/files`);
    const patchesRoot = this.resolveStoragePath(`${PULL_BACKUP_STORAGE_ROOT}/${backupId}/patches`);
    this.resolveStoragePath(this.getSummaryPath(backupId));
    this.resolveStoragePath('.git/info/exclude');
    await ensureCollabMetadataGitExclude(this.vaultDir);
    const backupEntries = [];

    await mkdir(filesRoot, { recursive: true });
    await mkdir(patchesRoot, { recursive: true });

    for (const entry of entries) {
      const normalizedPath = normalizeRelativePath(entry?.path);
      if (!normalizedPath) {
        continue;
      }

      const absoluteSourcePath = sanitizeVaultPath(this.vaultDir, normalizedPath, { allowIgnored: true });
      if (!absoluteSourcePath) continue;
      const relativeBackupPath = `${PULL_BACKUP_STORAGE_ROOT}/${backupId}/files/${normalizedPath}`;
      const relativeStagedPatchPath = entry?.stagedPatchContent
        ? `${PULL_BACKUP_STORAGE_ROOT}/${backupId}/patches/${normalizedPath}.staged.patch`
        : null;
      const relativeWorktreePatchPath = entry?.worktreePatchContent
        ? `${PULL_BACKUP_STORAGE_ROOT}/${backupId}/patches/${normalizedPath}.worktree.patch`
        : null;
      let backupPath = null;

      try {
        await stat(absoluteSourcePath);
        const absoluteBackupPath = this.resolveStoragePath(relativeBackupPath);
        await mkdir(dirname(absoluteBackupPath), { recursive: true });
        await copyFile(absoluteSourcePath, absoluteBackupPath);
        backupPath = normalizeRelativePath(relativeBackupPath);
      } catch (error) {
        if (error?.code !== 'ENOENT') {
          throw error;
        }
      }

      if (relativeStagedPatchPath) {
        const absolutePatchPath = this.resolveStoragePath(relativeStagedPatchPath);
        await mkdir(dirname(absolutePatchPath), { recursive: true });
        await writeFile(absolutePatchPath, entry.stagedPatchContent, 'utf8');
      }

      if (relativeWorktreePatchPath) {
        const absolutePatchPath = this.resolveStoragePath(relativeWorktreePatchPath);
        await mkdir(dirname(absolutePatchPath), { recursive: true });
        await writeFile(absolutePatchPath, entry.worktreePatchContent, 'utf8');
      }

      backupEntries.push({
        backupPath,
        oldPath: normalizeRelativePath(entry?.oldPath ?? ''),
        path: normalizedPath,
        stagedPatchPath: relativeStagedPatchPath ? normalizeRelativePath(relativeStagedPatchPath) : null,
        worktreePatchPath: relativeWorktreePatchPath ? normalizeRelativePath(relativeWorktreePatchPath) : null,
      });
    }

    const fileCount = backupEntries.filter((entry) => (
      entry.backupPath
      || entry.stagedPatchPath
      || entry.worktreePatchPath
    )).length;
    const summaryPath = this.getSummaryPath(backupId);
    await writeFile(
      this.resolveStoragePath(summaryPath),
      formatSummary({
        backupEntries,
        backupId,
        branch,
        createdAt,
        fileCount,
        headRef,
        targetRef,
      }),
      'utf8',
    );

    return {
      branch,
      createdAt,
      fileCount,
      id: backupId,
      summaryPath,
    };
  }

  async readSummary(backupId) {
    if (typeof backupId !== 'string' || !/^[a-z0-9-]{1,128}$/iu.test(backupId)) return null;
    const path = sanitizeVaultPath(this.vaultDir, this.getSummaryPath(backupId), { allowIgnored: true });
    if (!path) return null;
    try {
      return await readFile(path, 'utf8');
    } catch (error) {
      if (error.code === 'ENOENT' || error.code === 'EISDIR') return null;
      throw error;
    }
  }

  async listBackups() {
    let entries;
    try {
      entries = await readdir(this.getStorageRoot(), { withFileTypes: true });
    } catch (error) {
      if (error?.code === 'ENOENT') {
        return [];
      }
      throw error;
    }

    const backups = await Promise.all(entries
      .filter((entry) => entry.isDirectory())
      .map(async (entry) => {
        const summaryPath = this.getSummaryPath(entry.name);
        const content = await this.readSummary(entry.name);
        const metadata = parseBackupMetadata(content);
        if (!metadata) {
          return null;
        }

        return {
          branch: metadata.branch ?? null,
          createdAt: metadata.createdAt ?? null,
          fileCount: Number(metadata.fileCount ?? 0) || 0,
          id: entry.name,
          summaryPath,
        };
      }));

    return backups
      .filter(Boolean)
      .sort((left, right) => String(right.createdAt || '').localeCompare(String(left.createdAt || '')));
  }
}
