import { createGitRequestError } from './errors.js';
import { getVaultFileKind, isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { normalizeRelativeGitPath } from './path-utils.js';
import {
  countPatchLines,
  parseNumstatEntries,
  parseNameStatusEntries,
  parseUnifiedDiff,
} from './parsers.js';
import {
  createCommitDiffResponse,
  createEmptyStats,
  createFileHistoryResponse,
  createFileSnapshotResponse,
  createHistoryResponse,
} from './responses.js';

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DEFAULT_HISTORY_LIMIT = 30;
const HISTORY_LIMIT_CAP = 50;

function clampHistoryLimit(limit) {
  const parsedLimit = Number.parseInt(String(limit ?? DEFAULT_HISTORY_LIMIT), 10);
  if (!Number.isFinite(parsedLimit) || parsedLimit <= 0) {
    return DEFAULT_HISTORY_LIMIT;
  }
  return Math.min(HISTORY_LIMIT_CAP, parsedLimit);
}

function normalizeHistoryOffset(offset) {
  const parsedOffset = Number.parseInt(String(offset ?? 0), 10);
  if (!Number.isFinite(parsedOffset) || parsedOffset < 0) {
    return 0;
  }
  return parsedOffset;
}

function formatRelativeDate(value) {
  const timestamp = Date.parse(String(value ?? ''));
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const diffMs = Date.now() - timestamp;
  const absDiffMs = Math.abs(diffMs);
  if (absDiffMs < 60_000) {
    return 'just now';
  }

  const units = [
    { divisor: 365 * 24 * 60 * 60 * 1000, label: 'y' },
    { divisor: 30 * 24 * 60 * 60 * 1000, label: 'mo' },
    { divisor: 7 * 24 * 60 * 60 * 1000, label: 'w' },
    { divisor: 24 * 60 * 60 * 1000, label: 'd' },
    { divisor: 60 * 60 * 1000, label: 'h' },
    { divisor: 60 * 1000, label: 'm' },
  ];

  for (const unit of units) {
    if (absDiffMs >= unit.divisor) {
      const amount = Math.round(absDiffMs / unit.divisor);
      return diffMs >= 0 ? `${amount}${unit.label} ago` : `in ${amount}${unit.label}`;
    }
  }

  return 'just now';
}

function getCachedValue(cache, key) {
  const cached = cache.get(key);
  if (!cached) {
    return null;
  }
  if (Date.now() >= cached.expiresAt) {
    cache.delete(key);
    return null;
  }
  return cached.value;
}

function setCachedValue(cache, key, value, ttlMs) {
  cache.set(key, {
    expiresAt: Date.now() + ttlMs,
    value,
  });
  return value;
}

function createSummaryFromFiles(files = []) {
  return files.reduce((summary, file) => ({
    additions: summary.additions + Number(file.stats?.additions || 0),
    deletions: summary.deletions + Number(file.stats?.deletions || 0),
    filesChanged: summary.filesChanged + 1,
  }), {
    additions: 0,
    deletions: 0,
    filesChanged: 0,
  });
}

export class GitHistoryService {
  constructor({
    commandRunner,
    maxInitialPatchBytes = 250_000,
    maxInitialPatchLines = 1_500,
    responseCacheTtlMs = 5_000,
  }) {
    this.commandRunner = commandRunner;
    this.maxInitialPatchBytes = maxInitialPatchBytes;
    this.maxInitialPatchLines = maxInitialPatchLines;
    this.responseCacheTtlMs = responseCacheTtlMs;
    this.pendingRequests = new Map();
    this.historyCache = new Map();
    this.commitCache = new Map();
  }

  invalidate() {
    this.pendingRequests.clear();
    this.historyCache.clear();
    this.commitCache.clear();
  }

  async listHistory({ limit = DEFAULT_HISTORY_LIMIT, offset = 0 } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    const normalizedLimit = clampHistoryLimit(limit);
    const normalizedOffset = normalizeHistoryOffset(offset);

    if (!isGitRepo) {
      return createHistoryResponse({
        commits: [],
        hasMore: false,
        isGitRepo: false,
        limit: normalizedLimit,
        offset: normalizedOffset,
      });
    }

    const cacheKey = JSON.stringify({
      limit: normalizedLimit,
      offset: normalizedOffset,
      type: 'history',
    });
    const cached = getCachedValue(this.historyCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.runRequest(cacheKey, async () => {
      const hasHeadCommit = await this.hasHeadCommit();
      if (!hasHeadCommit) {
        return setCachedValue(this.historyCache, cacheKey, createHistoryResponse({
          commits: [],
          hasMore: false,
          limit: normalizedLimit,
          offset: normalizedOffset,
        }), this.responseCacheTtlMs);
      }

      const output = await this.commandRunner.execGit([
        'log',
        'HEAD',
        `--skip=${normalizedOffset}`,
        `-n`,
        String(normalizedLimit + 1),
        '--date=iso-strict',
        '--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P',
        '--numstat',
      ]);

      const commits = String(output ?? '')
        .split('\x1e')
        .map((chunk) => chunk.trim())
        .filter(Boolean)
        .map((chunk) => this.parseHistoryChunk(chunk));

      const hasMore = commits.length > normalizedLimit;
      const response = createHistoryResponse({
        commits: commits.slice(0, normalizedLimit),
        hasMore,
        limit: normalizedLimit,
        offset: normalizedOffset,
      });

      return setCachedValue(this.historyCache, cacheKey, response, this.responseCacheTtlMs);
    });
  }

  async listFileHistory({ limit = DEFAULT_HISTORY_LIMIT, offset = 0, path } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    const normalizedLimit = clampHistoryLimit(limit);
    const normalizedOffset = normalizeHistoryOffset(offset);
    const normalizedPath = normalizeRelativeGitPath(path);

    if (!isGitRepo) {
      return createFileHistoryResponse({
        commits: [],
        hasMore: false,
        isGitRepo: false,
        limit: normalizedLimit,
        offset: normalizedOffset,
        path: normalizedPath,
      });
    }

    const cacheKey = JSON.stringify({
      limit: normalizedLimit,
      offset: normalizedOffset,
      path: normalizedPath,
      type: 'file-history',
    });
    const cached = getCachedValue(this.historyCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.runRequest(cacheKey, async () => {
      const hasHeadCommit = await this.hasHeadCommit();
      if (!hasHeadCommit) {
        return setCachedValue(this.historyCache, cacheKey, createFileHistoryResponse({
          commits: [],
          hasMore: false,
          limit: normalizedLimit,
          offset: normalizedOffset,
          path: normalizedPath,
        }), this.responseCacheTtlMs);
      }

      const logArgs = [
        'log',
        'HEAD',
        `--skip=${normalizedOffset}`,
        '-n',
        String(normalizedLimit + 1),
        '--follow',
        '--find-renames=20%',
        '--date=iso-strict',
        '--format=%x1e%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P',
        '--',
        normalizedPath,
      ];
      const [nameStatusOutput, numstatOutput] = await Promise.all([
        this.commandRunner.execGit([
          ...logArgs.slice(0, -2),
          '--name-status',
          ...logArgs.slice(-2),
        ]),
        this.commandRunner.execGit([
          ...logArgs.slice(0, -2),
          '--numstat',
          ...logArgs.slice(-2),
        ]),
      ]);

      const commits = this.mergeFileHistoryChunks(nameStatusOutput, numstatOutput);
      const hasMore = commits.length > normalizedLimit;
      const response = createFileHistoryResponse({
        commits: commits.slice(0, normalizedLimit),
        hasMore,
        limit: normalizedLimit,
        offset: normalizedOffset,
        path: normalizedPath,
      });

      return setCachedValue(this.historyCache, cacheKey, response, this.responseCacheTtlMs);
    });
  }

  async getCommit({ allowLargePatch = false, hash, metaOnly = false, path = null } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    if (!isGitRepo) {
      return createCommitDiffResponse({
        commit: null,
        files: [],
        isGitRepo: false,
        metaOnly,
        path: null,
      });
    }

    const normalizedHash = this.normalizeCommitHash(hash);
    const normalizedPath = path ? normalizeRelativeGitPath(path) : null;
    if (!metaOnly && !normalizedPath) {
      throw createGitRequestError(400, 'Missing path parameter');
    }

    const cacheKey = JSON.stringify({
      allowLargePatch: Boolean(allowLargePatch),
      hash: normalizedHash,
      metaOnly: Boolean(metaOnly),
      path: normalizedPath,
      type: 'commit',
    });
    const cached = getCachedValue(this.commitCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.runRequest(cacheKey, async () => {
      const meta = await this.loadCommitMetadata(normalizedHash);
      const summary = createSummaryFromFiles(meta.files);

      if (metaOnly) {
        const metaResponse = createCommitDiffResponse({
          commit: meta.commit,
          files: meta.files,
          metaOnly: true,
          path: normalizedPath,
          summary,
        });
        return setCachedValue(this.commitCache, cacheKey, metaResponse, this.responseCacheTtlMs);
      }

      const baseFile = meta.files.find((file) => file.path === normalizedPath);
      if (!baseFile) {
        throw createGitRequestError(404, 'Commit file not found');
      }

      const fileSummary = {
        additions: Number(baseFile.stats?.additions || 0),
        deletions: Number(baseFile.stats?.deletions || 0),
        filesChanged: 1,
      };

      if (
        !allowLargePatch
        && (fileSummary.additions + fileSummary.deletions) > this.maxInitialPatchLines
      ) {
        const guardedResponse = createCommitDiffResponse({
          commit: meta.commit,
          files: [{
            ...baseFile,
            canLoadFullPatch: true,
            hunks: [],
            patchLineCount: fileSummary.additions + fileSummary.deletions,
            tooLarge: true,
          }],
          metaOnly: false,
          path: normalizedPath,
          summary,
        });
        return setCachedValue(this.commitCache, cacheKey, guardedResponse, this.responseCacheTtlMs);
      }

      const diffText = await this.commandRunner.execGit([
        'diff',
        '--no-color',
        '--no-ext-diff',
        '--find-renames',
        meta.baseRef,
        meta.commit.hash,
        '--',
        normalizedPath,
      ]);
      const parsedFiles = parseUnifiedDiff(diffText);
      const detail = parsedFiles.find((file) => file.path === normalizedPath) ?? {
        ...baseFile,
        hunks: [],
        isBinary: false,
        stats: baseFile.stats ?? createEmptyStats(),
      };
      const patchLineCount = countPatchLines(detail);

      const detailedFile = (
        !allowLargePatch
        && (
          patchLineCount > this.maxInitialPatchLines
          || diffText.length > this.maxInitialPatchBytes
        )
      )
        ? {
          ...baseFile,
          byteLength: diffText.length,
          canLoadFullPatch: true,
          hunks: [],
          patchLineCount,
          stats: detail.stats,
          tooLarge: true,
        }
        : {
          ...baseFile,
          ...detail,
          canLoadFullPatch: false,
          patchLineCount,
          tooLarge: false,
        };

      const response = createCommitDiffResponse({
        commit: meta.commit,
        files: [detailedFile],
        metaOnly: false,
        path: normalizedPath,
        summary,
      });
      return setCachedValue(this.commitCache, cacheKey, response, this.responseCacheTtlMs);
    });
  }

  async getFileSnapshot({ hash, path } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    const normalizedHash = this.normalizeCommitHash(hash);
    const normalizedPath = normalizeRelativeGitPath(path);

    if (!isGitRepo) {
      return createFileSnapshotResponse({
        content: '',
        fileKind: getVaultFileKind(normalizedPath),
        hash: normalizedHash,
        isGitRepo: false,
        path: normalizedPath,
      });
    }

    if (isImageAttachmentFilePath(normalizedPath)) {
      throw createGitRequestError(400, 'Binary file snapshots are not supported');
    }

    const fileKind = getVaultFileKind(normalizedPath);
    if (!fileKind) {
      throw createGitRequestError(400, 'Unsupported file snapshot type');
    }

    const cacheKey = JSON.stringify({
      hash: normalizedHash,
      path: normalizedPath,
      type: 'file-snapshot',
    });
    const cached = getCachedValue(this.commitCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.runRequest(cacheKey, async () => {
      let content = '';
      try {
        content = await this.commandRunner.execGit(['show', `${normalizedHash}:${normalizedPath}`]);
      } catch {
        throw createGitRequestError(404, 'Commit file not found');
      }

      return setCachedValue(this.commitCache, cacheKey, createFileSnapshotResponse({
        content,
        fileKind,
        hash: normalizedHash,
        path: normalizedPath,
      }), this.responseCacheTtlMs);
    });
  }

  async runRequest(key, callback) {
    if (this.pendingRequests.has(key)) {
      return this.pendingRequests.get(key);
    }

    const requestPromise = callback();
    this.pendingRequests.set(key, requestPromise);

    try {
      return await requestPromise;
    } finally {
      if (this.pendingRequests.get(key) === requestPromise) {
        this.pendingRequests.delete(key);
      }
    }
  }

  async hasHeadCommit() {
    try {
      await this.commandRunner.execGit(['rev-parse', '--verify', 'HEAD']);
      return true;
    } catch {
      return false;
    }
  }

  normalizeCommitHash(hash) {
    const normalizedHash = String(hash ?? '').trim();
    if (!/^[0-9a-f]{4,64}$/iu.test(normalizedHash)) {
      throw createGitRequestError(400, 'Invalid commit hash');
    }
    return normalizedHash;
  }

  parseHistoryChunk(chunk) {
    const [headerLine = '', ...statLines] = String(chunk ?? '')
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    const [
      hash = '',
      shortHash = '',
      subject = '',
      authorName = '',
      authorEmail = '',
      authoredAt = '',
      rawParents = '',
    ] = headerLine.split('\x1f');
    const parentHashes = rawParents.split(' ').map((value) => value.trim()).filter(Boolean);

    const summary = statLines.reduce((result, line) => {
      const [rawAdditions = '0', rawDeletions = '0'] = line.split('\t');
      return {
        additions: result.additions + (rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions, 10) || 0),
        deletions: result.deletions + (rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions, 10) || 0),
        filesChanged: result.filesChanged + 1,
      };
    }, {
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    });

    return {
      additions: summary.additions,
      authorEmail,
      authorName,
      authoredAt,
      deletions: summary.deletions,
      filesChanged: summary.filesChanged,
      hash,
      isMergeCommit: parentHashes.length > 1,
      parentCount: parentHashes.length,
      relativeDateLabel: formatRelativeDate(authoredAt),
      shortHash,
      subject,
    };
  }

  parseFileHistoryChunk(chunk) {
    const [headerLine = '', ...detailLines] = String(chunk ?? '')
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    const [
      hash = '',
      shortHash = '',
      subject = '',
      authorName = '',
      authorEmail = '',
      authoredAt = '',
      rawParents = '',
    ] = headerLine.split('\x1f');
    const parentHashes = rawParents.split(' ').map((value) => value.trim()).filter(Boolean);

    return {
      authorEmail,
      authorName,
      authoredAt,
      detailLines,
      hash,
      isMergeCommit: parentHashes.length > 1,
      parentCount: parentHashes.length,
      relativeDateLabel: formatRelativeDate(authoredAt),
      shortHash,
      subject,
    };
  }

  mergeFileHistoryChunks(nameStatusOutput, numstatOutput) {
    const nameStatusChunks = String(nameStatusOutput ?? '')
      .split('\x1e')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => this.parseFileHistoryChunk(chunk));
    const numstatChunks = String(numstatOutput ?? '')
      .split('\x1e')
      .map((chunk) => chunk.trim())
      .filter(Boolean)
      .map((chunk) => this.parseFileHistoryChunk(chunk));

    return nameStatusChunks.map((chunk, index) => {
      const nameStatusEntry = parseNameStatusEntries(chunk.detailLines.join('\n'))[0] ?? null;
      const numstatEntry = parseNumstatEntries(numstatChunks[index]?.detailLines?.join('\n') ?? '')[0] ?? null;
      return {
        additions: Number(numstatEntry?.additions || 0),
        authorEmail: chunk.authorEmail,
        authorName: chunk.authorName,
        authoredAt: chunk.authoredAt,
        deletions: Number(numstatEntry?.deletions || 0),
        filesChanged: 1,
        hash: chunk.hash,
        isMergeCommit: chunk.isMergeCommit,
        oldPath: nameStatusEntry?.oldPath ?? null,
        parentCount: chunk.parentCount,
        pathAtCommit: nameStatusEntry?.path ?? null,
        relativeDateLabel: chunk.relativeDateLabel,
        shortHash: chunk.shortHash,
        status: nameStatusEntry?.status ?? 'modified',
        subject: chunk.subject,
      };
    }).filter((entry) => entry.hash && entry.pathAtCommit);
  }

  async loadCommitMetadata(hash) {
    const cacheKey = JSON.stringify({ hash, metaOnly: true, type: 'commit-metadata' });
    const cached = getCachedValue(this.commitCache, cacheKey);
    if (cached) {
      return cached;
    }

    const headerOutput = await this.commandRunner.execGit([
      'show',
      '--no-patch',
      '--date=iso-strict',
      '--format=%H%x1f%h%x1f%s%x1f%an%x1f%ae%x1f%aI%x1f%P',
      hash,
    ]).catch(() => {
      throw createGitRequestError(404, 'Commit not found');
    });

    const [
      commitHash = '',
      shortHash = '',
      subject = '',
      authorName = '',
      authorEmail = '',
      authoredAt = '',
      rawParents = '',
    ] = String(headerOutput ?? '').trim().split('\x1f');

    if (!commitHash) {
      throw createGitRequestError(404, 'Commit not found');
    }

    const parentHashes = rawParents.split(' ').map((value) => value.trim()).filter(Boolean);
    const baseRef = parentHashes[0] || EMPTY_TREE_HASH;
    const nameStatusOutput = await this.commandRunner.execGit([
      'diff',
      '--find-renames',
      '--name-status',
      baseRef,
      commitHash,
    ]);
    const numstatOutput = await this.commandRunner.execGit([
      'diff',
      '--find-renames',
      '--numstat',
      baseRef,
      commitHash,
    ]);

    const files = this.mergeCommitMetadataFiles(
      parseNameStatusEntries(nameStatusOutput),
      numstatOutput,
    );
    const meta = {
      baseRef,
      commit: {
        authorEmail,
        authorName,
        authoredAt,
        filesChanged: files.length,
        hash: commitHash,
        isMergeCommit: parentHashes.length > 1,
        parentCount: parentHashes.length,
        relativeDateLabel: formatRelativeDate(authoredAt),
        shortHash,
        subject,
      },
      files,
    };

    return setCachedValue(this.commitCache, cacheKey, meta, this.responseCacheTtlMs);
  }

  mergeCommitMetadataFiles(nameStatusEntries, numstatOutput) {
    const statsByPath = new Map();
    const numstatLines = String(numstatOutput ?? '')
      .split(/\r?\n/u)
      .filter(Boolean);

    for (let index = 0; index < nameStatusEntries.length; index += 1) {
      const line = numstatLines[index] ?? '';
      const [rawAdditions = '0', rawDeletions = '0'] = line.split('\t');
      statsByPath.set(nameStatusEntries[index].path, {
        additions: rawAdditions === '-' ? 0 : Number.parseInt(rawAdditions, 10) || 0,
        deletions: rawDeletions === '-' ? 0 : Number.parseInt(rawDeletions, 10) || 0,
      });
    }

    return nameStatusEntries.map((entry) => ({
      ...entry,
      stats: statsByPath.get(entry.path) ?? createEmptyStats(),
    }));
  }
}
