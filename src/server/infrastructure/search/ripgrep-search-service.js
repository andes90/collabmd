import { execFile as execFileCallback } from 'node:child_process';
import { glob, readFile, stat } from 'node:fs/promises';
import { promisify } from 'node:util';

import { logPerfEvent } from '../../config/perf-logging.js';
import {
  createEmptySearchResult,
  DEFAULT_MAX_FILES,
  DEFAULT_MAX_SNIPPETS_PER_FILE,
  parseRipgrepJson,
  searchExcalidrawSceneText,
} from '../../domain/search-text.js';
import { sanitizeVaultPath } from '../persistence/path-utils.js';

export { parseRipgrepJson, searchExcalidrawSceneText } from '../../domain/search-text.js';

const execFile = promisify(execFileCallback);

const DEFAULT_MAX_BUFFER_BYTES = 2 * 1024 * 1024;
const DEFAULT_MAX_FILE_SIZE = '1M';
const DEFAULT_TIMEOUT_MS = 8_000;
const MIN_QUERY_LENGTH = 2;
const TEXT_SEARCH_GLOBS = Object.freeze([
  '*.md',
  '*.markdown',
  '*.mdx',
  '*.html',
  '*.htm',
  '*.base',
  '*.mmd',
  '*.mermaid',
  '*.puml',
  '*.plantuml',
  '*.dsl',
  '*.drawio',
]);

function parseByteLimit(value) {
  const match = String(value ?? '').trim().match(/^(\d+)([KMG])?$/iu);
  if (!match) return 1024 * 1024;
  const multipliers = { K: 1024, M: 1024 ** 2, G: 1024 ** 3 };
  return Number(match[1]) * (multipliers[match[2]?.toUpperCase()] ?? 1);
}

function normalizePositiveInt(value, fallback, { min = 1, max = Number.MAX_SAFE_INTEGER } = {}) {
  const parsed = Number.parseInt(value ?? '', 10);
  if (!Number.isInteger(parsed) || parsed < min) {
    return fallback;
  }

  return Math.min(parsed, max);
}

function createRipgrepArgs(query, {
  maxFileSize = DEFAULT_MAX_FILE_SIZE,
  maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
  wholeWord = false,
} = {}) {
  const args = [
    '--json',
    '--fixed-strings',
    '--ignore-case',
    '--line-number',
    '--column',
    '--max-filesize',
    String(maxFileSize || DEFAULT_MAX_FILE_SIZE),
    '--max-count',
    String(Math.max(Number(maxSnippetsPerFile) || DEFAULT_MAX_SNIPPETS_PER_FILE, 1) + 1),
    '--glob',
    '!.git/**',
    '--glob',
    '!.collabmd/**',
    '--glob',
    '!node_modules/**',
    '--glob',
    '!.obsidian/**',
    '--glob',
    '!.trash/**',
  ];
  if (wholeWord) args.push('--word-regexp');

  TEXT_SEARCH_GLOBS.forEach((glob) => {
    args.push('--glob', glob);
  });

  args.push('--', String(query ?? ''), '.');
  return args;
}

async function searchExcalidrawText({
  excludedPaths = [],
  kinds = [],
  maxFileSize,
  maxFiles,
  maxSnippetsPerFile,
  prefix = '',
  query,
  wholeWord = false,
  signal,
  vaultDir,
}) {
  const excluded = new Set(excludedPaths);
  const kindFilter = new Set(Array.isArray(kinds) ? kinds : []);
  if (kindFilter.size > 0 && !kindFilter.has('excalidraw')) {
    return { files: [], matchCount: 0, truncated: false };
  }
  const files = [];
  let matchCount = 0;
  let truncated = false;
  const maxBytes = parseByteLimit(maxFileSize);
  const paths = glob('**/*.excalidraw', {
    cwd: vaultDir,
    exclude: ['**/.*', '**/node_modules/**'],
  });

  for await (const filePath of paths) {
    const normalizedPath = filePath.replaceAll('\\', '/');
    if (excluded.has(normalizedPath)) continue;
    if (prefix && normalizedPath !== prefix && !normalizedPath.startsWith(`${prefix}/`)) continue;
    signal?.throwIfAborted?.();
    const absolutePath = sanitizeVaultPath(vaultDir, filePath, { preservePath: true });
    if (!absolutePath) continue;

    let scene;
    try {
      const info = await stat(absolutePath);
      if (!info.isFile() || info.size > maxBytes) continue;
      scene = JSON.parse(await readFile(absolutePath, { encoding: 'utf8', signal: signal ?? undefined }));
    } catch (error) {
      if (error instanceof SyntaxError || ['ENOENT', 'ENOTDIR', 'EISDIR'].includes(error.code)) continue;
      throw error;
    }

    const result = searchExcalidrawSceneText(scene, { query, maxSnippetsPerFile, wholeWord });
    const { matchCount: fileMatchCount, snippets } = result;
    matchCount += fileMatchCount;
    truncated ||= result.truncated;

    if (fileMatchCount > 0) {
      if (files.length >= maxFiles) {
        truncated = true;
        continue;
      }
      files.push({
        file: normalizedPath,
        kind: 'excalidraw',
        matchCount: fileMatchCount,
        snippets,
        truncated: fileMatchCount > snippets.length,
      });
    }
  }

  return { files, matchCount, truncated };
}

export class RipgrepSearchService {
  constructor({
    execFileImpl = execFile,
    maxBufferBytes = DEFAULT_MAX_BUFFER_BYTES,
    maxFileSize = DEFAULT_MAX_FILE_SIZE,
    maxFiles = DEFAULT_MAX_FILES,
    maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
    perfLoggingEnabled = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
    vaultDir,
  } = {}) {
    this.execFileImpl = execFileImpl;
    this.maxBufferBytes = maxBufferBytes;
    this.maxFileSize = maxFileSize;
    this.maxFiles = maxFiles;
    this.maxSnippetsPerFile = maxSnippetsPerFile;
    this.perfLoggingEnabled = perfLoggingEnabled;
    this.timeoutMs = timeoutMs;
    this.vaultDir = vaultDir;
    this.available = false;
    this.version = '';
    this.unavailableReason = 'ripgrep has not been checked yet';
  }

  async initialize() {
    try {
      const result = await this.execFileImpl('rg', ['--version'], {
        encoding: 'utf8',
        maxBuffer: 128 * 1024,
        timeout: 3_000,
      });
      this.available = true;
      this.version = String(result.stdout ?? '').split(/\r?\n/u)[0] || 'ripgrep';
      this.unavailableReason = '';
    } catch (error) {
      this.available = false;
      this.version = '';
      this.unavailableReason = error?.code === 'ENOENT'
        ? 'ripgrep is not installed on the server'
        : (error?.message || 'ripgrep is unavailable');
    }

    logPerfEvent(this.perfLoggingEnabled, 'search-capability', {
      available: this.available,
      backend: 'ripgrep',
      version: this.version,
    });

    return this.getClientConfig();
  }

  getClientConfig() {
    return {
      available: this.available,
      backend: 'ripgrep',
      minQueryLength: MIN_QUERY_LENGTH,
      unavailableReason: this.unavailableReason,
      version: this.version,
    };
  }

  async search({
    excludedPaths = [],
    kinds = [],
    limit = DEFAULT_MAX_FILES,
    maxSnippetsPerFile = DEFAULT_MAX_SNIPPETS_PER_FILE,
    prefix = '',
    query = '',
    signal = null,
    wholeWord = false,
  } = {}) {
    const normalizedQuery = String(query ?? '').trim();
    const snippetLimit = normalizePositiveInt(maxSnippetsPerFile, this.maxSnippetsPerFile, {
      max: 10,
      min: 1,
    });
    const maxFiles = normalizePositiveInt(limit, this.maxFiles, {
      max: this.maxFiles,
      min: 1,
    });

    if (normalizedQuery.length < MIN_QUERY_LENGTH) {
      return createEmptySearchResult({
        query: normalizedQuery,
        searchAvailable: this.available,
      });
    }

    if (!this.available) {
      const error = new Error('Global text search requires ripgrep on the server.');
      error.statusCode = 503;
      error.search = this.getClientConfig();
      throw error;
    }

    const startedAt = Date.now();
    const args = createRipgrepArgs(normalizedQuery, {
      maxFileSize: this.maxFileSize,
      maxSnippetsPerFile: snippetLimit,
      wholeWord,
    });
    let parsed;
    try {
      const result = await this.execFileImpl('rg', args, {
        cwd: this.vaultDir,
        encoding: 'utf8',
        maxBuffer: this.maxBufferBytes,
        ...(signal ? { signal } : {}),
        timeout: this.timeoutMs,
      });
      parsed = parseRipgrepJson(result.stdout, {
        excludedPaths,
        kinds,
        maxFiles,
        maxSnippetsPerFile: snippetLimit,
        prefix,
        query: normalizedQuery,
      });
    } catch (error) {
      if (error?.code === 1) {
        parsed = createEmptySearchResult({
          query: normalizedQuery,
          searchAvailable: this.available,
        });
      } else {
        const isMaxBuffer = error?.code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER';
        parsed = parseRipgrepJson(error?.stdout ?? '', {
          excludedPaths,
          kinds,
          maxFiles,
          maxSnippetsPerFile: snippetLimit,
          prefix,
          query: normalizedQuery,
        });
        if (isMaxBuffer && parsed.files.length > 0) {
          parsed.truncated = true;
        } else {
          error.statusCode = error?.signal === 'SIGTERM' ? 504 : 500;
          throw error;
        }
      }
    }

    if (parsed.files.length < maxFiles) {
      const excalidraw = await searchExcalidrawText({
        excludedPaths,
        kinds,
        maxFileSize: this.maxFileSize,
        maxFiles: maxFiles - parsed.files.length,
        maxSnippetsPerFile: snippetLimit,
        prefix,
        query: normalizedQuery,
        wholeWord,
        signal,
        vaultDir: this.vaultDir,
      });
      parsed.files.push(...excalidraw.files);
      parsed.matchCount += excalidraw.matchCount;
      parsed.truncated ||= excalidraw.truncated;
    } else if (kinds.length === 0 || kinds.includes('excalidraw')) {
      parsed.truncated = true;
    }
    parsed.search = this.getClientConfig();
    logPerfEvent(this.perfLoggingEnabled, 'search-query', {
      durationMs: Date.now() - startedAt,
      fileCount: parsed.files.length,
      matchCount: parsed.matchCount,
      truncated: parsed.truncated,
    });
    return parsed;
  }
}
