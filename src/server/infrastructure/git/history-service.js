import { createRequestError as createGitRequestError } from '../http/http-errors.js';
import { getVaultFileKind, isImageAttachmentFilePath } from '../../../domain/file-kind.js';
import { normalizeRelativeGitPath } from './path-utils.js';
import { getImageMimeType } from '../../shared/image-mime.js';
import {
  countPatchLines,
  parseGitLogHeader,
  parseNumstatEntries,
  parseNameStatusEntries,
  parseUnifiedDiff,
} from './parsers.js';
import {
  createEmptyStats,
} from './responses.js';

const EMPTY_TREE_HASH = '4b825dc642cb6eb9a060e54bf8d69288fbee4904';
const DEFAULT_HISTORY_LIMIT = 30;
const HISTORY_LIMIT_CAP = 50;
const RESPONSE_CACHE_LIMIT = 50;
const MAX_CACHED_RESPONSE_BYTES = 256 * 1024;

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
  const now = Date.now();
  for (const [cachedKey, cached] of cache) {
    if (now >= cached.expiresAt) cache.delete(cachedKey);
  }
  cache.delete(key);
  const payloadBytes = Buffer.isBuffer(value.content)
    ? value.content.byteLength
    : Buffer.byteLength(JSON.stringify(value));
  if (ttlMs <= 0 || payloadBytes + Buffer.byteLength(key) > MAX_CACHED_RESPONSE_BYTES) {
    return value;
  }
  while (cache.size >= RESPONSE_CACHE_LIMIT) {
    cache.delete(cache.keys().next().value);
  }
  cache.set(key, {
    expiresAt: now + ttlMs,
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
      return {
        commits: [],
        hasMore: false,
        isGitRepo: false,
        limit: normalizedLimit,
        offset: normalizedOffset,
      };
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
        return setCachedValue(this.historyCache, cacheKey, {
          commits: [],
          hasMore: false,
          isGitRepo: true,
          limit: normalizedLimit,
          offset: normalizedOffset,
        }, this.responseCacheTtlMs);
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
      const response = {
        commits: commits.slice(0, normalizedLimit),
        hasMore,
        isGitRepo: true,
        limit: normalizedLimit,
        offset: normalizedOffset,
      };

      return setCachedValue(this.historyCache, cacheKey, response, this.responseCacheTtlMs);
    });
  }

  async listFileHistory({ limit = DEFAULT_HISTORY_LIMIT, offset = 0, path } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    const normalizedLimit = clampHistoryLimit(limit);
    const normalizedOffset = normalizeHistoryOffset(offset);
    const normalizedPath = normalizeRelativeGitPath(path);

    if (!isGitRepo) {
      return {
        commits: [],
        hasMore: false,
        isGitRepo: false,
        limit: normalizedLimit,
        offset: normalizedOffset,
        path: normalizedPath,
      };
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
        return setCachedValue(this.historyCache, cacheKey, {
          commits: [],
          hasMore: false,
          isGitRepo: true,
          limit: normalizedLimit,
          offset: normalizedOffset,
          path: normalizedPath,
        }, this.responseCacheTtlMs);
      }

      const logArgs = [
        'log',
        'HEAD',
        `--skip=${normalizedOffset}`,
        '-n',
        String(normalizedLimit + 1),
        '--follow',
        '--find-renames',
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
      const response = {
        commits: commits.slice(0, normalizedLimit),
        hasMore,
        isGitRepo: true,
        limit: normalizedLimit,
        offset: normalizedOffset,
        path: normalizedPath,
      };

      return setCachedValue(this.historyCache, cacheKey, response, this.responseCacheTtlMs);
    });
  }

  async getCommit({ allowLargePatch = false, hash, metaOnly = false, path = null } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    if (!isGitRepo) {
      return {
        commit: null,
        files: [],
        isGitRepo: false,
        metaOnly,
        path: null,
        source: 'commit',
        summary: {
          additions: 0,
          deletions: 0,
          filesChanged: 0,
        },
      };
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
        const metaResponse = {
          baseRef: meta.baseRef,
          commit: meta.commit,
          files: meta.files,
          isGitRepo: true,
          metaOnly: true,
          path: normalizedPath,
          source: 'commit',
          summary,
        };
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
        const guardedResponse = {
          baseRef: meta.baseRef,
          commit: meta.commit,
          files: [{
            ...baseFile,
            canLoadFullPatch: true,
            hunks: [],
            patchLineCount: fileSummary.additions + fileSummary.deletions,
            tooLarge: true,
          }],
          isGitRepo: true,
          metaOnly: false,
          path: normalizedPath,
          source: 'commit',
          summary,
        };
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

      const response = {
        baseRef: meta.baseRef,
        commit: meta.commit,
        files: [detailedFile],
        isGitRepo: true,
        metaOnly: false,
        path: normalizedPath,
        source: 'commit',
        summary,
      };
      return setCachedValue(this.commitCache, cacheKey, response, this.responseCacheTtlMs);
    });
  }

  async getFileSnapshot({ hash, path } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    const normalizedHash = this.normalizeCommitHash(hash);
    const normalizedPath = normalizeRelativeGitPath(path);

    if (!isGitRepo) {
      return {
        content: '',
        fileKind: getVaultFileKind(normalizedPath),
        hash: normalizedHash,
        isGitRepo: false,
        path: normalizedPath,
      };
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
      let content;
      try {
        content = await this.commandRunner.execGit(['show', `${normalizedHash}:${normalizedPath}`]);
      } catch {
        throw createGitRequestError(404, 'Commit file not found');
      }

      return setCachedValue(this.commitCache, cacheKey, {
        content,
        fileKind,
        hash: normalizedHash,
        isGitRepo: true,
        path: normalizedPath,
      }, this.responseCacheTtlMs);
    });
  }

  async getFileAttachment({ hash, path } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    const normalizedHash = this.normalizeAttachmentRef(hash);
    const normalizedPath = normalizeRelativeGitPath(path);

    if (!isGitRepo) {
      throw createGitRequestError(404, 'Git repository not found');
    }

    if (!isImageAttachmentFilePath(normalizedPath)) {
      throw createGitRequestError(400, 'Unsupported image attachment path');
    }

    const cacheKey = JSON.stringify({
      hash: normalizedHash,
      path: normalizedPath,
      type: 'file-attachment',
    });
    const cached = getCachedValue(this.commitCache, cacheKey);
    if (cached) {
      return cached;
    }

    return this.runRequest(cacheKey, async () => {
      let content;
      try {
        content = await this.commandRunner.execGitBuffer(['cat-file', 'blob', `${normalizedHash}:${normalizedPath}`]);
      } catch {
        throw createGitRequestError(404, 'Commit image not found');
      }

      return setCachedValue(this.commitCache, cacheKey, {
        content,
        hash: normalizedHash,
        mimeType: getImageMimeType(normalizedPath),
        path: normalizedPath,
      }, this.responseCacheTtlMs);
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

  normalizeAttachmentRef(hash) {
    const normalizedHash = String(hash ?? '').trim();
    if (normalizedHash === 'HEAD') {
      return normalizedHash;
    }
    return this.normalizeCommitHash(normalizedHash);
  }

  parseHistoryChunk(chunk) {
    const [headerLine = '', ...statLines] = String(chunk ?? '')
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    const {
      authorEmail,
      authorName,
      authoredAt,
      hash,
      isMergeCommit,
      parentCount,
      shortHash,
      subject,
    } = parseGitLogHeader(headerLine);

    const summary = parseNumstatEntries(statLines.join('\n')).reduce((result, entry) => {
      return {
        additions: result.additions + entry.additions,
        deletions: result.deletions + entry.deletions,
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
      isMergeCommit,
      parentCount,
      relativeDateLabel: formatRelativeDate(authoredAt),
      shortHash,
      subject,
    };
  }

  parseFileHistoryChunk(chunk) {
    const [headerLine = '', ...detailLines] = String(chunk ?? '')
      .split(/\r?\n/u)
      .filter((line) => line.length > 0);
    const {
      authorEmail,
      authorName,
      authoredAt,
      hash,
      isMergeCommit,
      parentCount,
      shortHash,
      subject,
    } = parseGitLogHeader(headerLine);

    return {
      authorEmail,
      authorName,
      authoredAt,
      detailLines,
      hash,
      isMergeCommit,
      parentCount,
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
        fileKind: getVaultFileKind(nameStatusEntry?.path),
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

    const {
      authorEmail,
      authorName,
      authoredAt,
      hash: commitHash,
      parentHashes,
      shortHash,
      subject,
    } = parseGitLogHeader(String(headerOutput ?? '').trim());

    if (!commitHash) {
      throw createGitRequestError(404, 'Commit not found');
    }

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
    const numstatEntries = parseNumstatEntries(numstatOutput);

    return nameStatusEntries.map((entry, index) => {
      const numstatEntry = numstatEntries[index];
      return {
        ...entry,
        fileKind: getVaultFileKind(entry.path),
        stats: numstatEntry
          ? {
            additions: numstatEntry.additions,
            deletions: numstatEntry.deletions,
          }
          : createEmptyStats(),
      };
    });
  }
}
