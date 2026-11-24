import { createHash } from 'node:crypto';
import { mkdir, readFile, readdir, realpath, rm, stat, writeFile } from 'node:fs/promises';
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

import {
  isStructurizrFilePath,
  isVaultFilePath,
} from '../../../domain/file-kind.js';
import { createRequestError } from '../../shared/http-errors.js';
import { sanitizeVaultPath } from '../persistence/path-utils.js';

const MANIFEST_FILE_NAME = '.collabmd-manifest.json';
const WORKSPACE_DSL_FILE_NAME = 'workspace.dsl';
const WORKSPACE_JSON_FILE_NAME = 'workspace.json';
const SIDECAR_TIMEOUT_MS = 15_000;
const THUMBNAIL_FALLBACK_PATH = '/static/img/thumbnail-not-available.png';

function createServiceError(message, statusCode, code) {
  return createRequestError(statusCode, message, { requestCode: code });
}

function resolveMirrorPath(mirrorDir, pathValue) {
  const absolute = sanitizeVaultPath(mirrorDir, pathValue, { allowIgnored: true });
  if (!absolute) {
    throw createServiceError('Invalid Structurizr mirror path.', 400, 'STRUCTURIZR_MIRROR_INVALID');
  }
  return absolute;
}

function normalizeWorkspaceRootPath(pathValue) {
  const normalized = String(pathValue ?? '').trim().replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').some((segment) => !segment || segment === '.' || segment === '..')) {
    return '';
  }

  return normalized;
}

// Match comments and quoted text before bare tokens so descriptions cannot be
// mistaken for directives, and the text within comments is never inspected.
const DSL_TOKEN = /\/\*[\s\S]*?(?:\*\/|$)|\/\/[^\r\n]*|#[^\r\n]*|"(?:\\[\s\S]|[^"\\])*"|'(?:\\[\s\S]|[^'\\])*'|[{}]|[^\s{}"']+/gu;

function validateStructurizrDsl(source) {
  const tokens = Array.from(source.matchAll(DSL_TOKEN), ([token]) => token)
    .filter((token) => !token.startsWith('/*') && !token.startsWith('//') && !token.startsWith('#'));
  for (let index = 0; index < tokens.length; index += 1) {
    const directive = tokens[index].toLowerCase();
    if (directive === '!script' || directive === '!plugin' || directive === '!components') {
      throw createServiceError(
        'Executable Structurizr DSL is disabled for this workspace.',
        422,
        'STRUCTURIZR_EXECUTABLE_DSL_DISABLED',
      );
    }
    const extendsWorkspace = directive === 'workspace' && tokens[index + 1]?.toLowerCase() === 'extends';
    if (directive !== '!include' && !extendsWorkspace) continue;
    const location = (tokens[index + (extendsWorkspace ? 2 : 1)] ?? '').replace(/^["'<]|["'>]$/gu, '');
    if (/^(?:[a-z][a-z0-9+.-]*:|\/)|\\|\$\{|(?:^|\/)\.\.(?:\/|$)/iu.test(location)) {
      throw createServiceError(
        'Structurizr DSL includes and base workspaces must use local paths inside the workspace.',
        422,
        'STRUCTURIZR_REMOTE_INCLUDE_DISABLED',
      );
    }
  }
}

function isMirrorFileAllowed(relativePath) {
  return basename(relativePath) === WORKSPACE_JSON_FILE_NAME || isVaultFilePath(relativePath);
}

async function collectWorkspaceFiles(directoryPath, prefix = '') {
  const files = new Map();
  const entries = (await readdir(directoryPath, { withFileTypes: true }))
    .sort((left, right) => left.name.localeCompare(right.name, undefined, { sensitivity: 'base' }));

  for (const entry of entries) {
    if (entry.name.startsWith('.') || entry.name === 'node_modules' || entry.name === '.git') {
      continue;
    }

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      const nested = await collectWorkspaceFiles(absolutePath, relativePath);
      nested.forEach((content, pathValue) => files.set(pathValue, content));
      continue;
    }

    if (!entry.isFile() || !isMirrorFileAllowed(relativePath)) {
      continue;
    }

    files.set(relativePath, await readFile(absolutePath));
  }

  return files;
}

async function collectMirrorPaths(directoryPath, prefix = '') {
  let entries;
  try {
    entries = await readdir(directoryPath, { withFileTypes: true });
  } catch (error) {
    if (error.code === 'ENOENT') {
      return [];
    }
    throw error;
  }

  const paths = [];
  for (const entry of entries) {
    if (entry.name === '.structurizr') {
      continue;
    }

    const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name;
    const absolutePath = join(directoryPath, entry.name);
    if (entry.isDirectory()) {
      paths.push(...await collectMirrorPaths(absolutePath, relativePath));
    } else if (entry.isFile()) {
      paths.push(relativePath);
    }
  }

  return paths;
}

async function readManifest(manifestPath) {
  try {
    const parsed = JSON.parse(await readFile(manifestPath, 'utf8'));
    return Array.isArray(parsed?.paths)
      ? parsed.paths.filter((pathValue) => typeof pathValue === 'string' && sanitizeVaultPath(dirname(manifestPath), pathValue))
      : [];
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) {
      return [];
    }
    throw error;
  }
}

async function writeMirrorFiles(mirrorDir, files) {
  await Promise.all(Array.from(files, async ([relativePath, content]) => {
    const targetPath = resolveMirrorPath(mirrorDir, relativePath);
    await mkdir(dirname(targetPath), { recursive: true });
    await writeFile(targetPath, content);
  }));
}

async function removeMirrorPaths(mirrorDir, paths) {
  await Promise.all(paths.map((relativePath) => rm(resolveMirrorPath(mirrorDir, relativePath), {
    force: true,
    recursive: true,
  })));
}

async function snapshotMirror(mirrorDir) {
  const paths = await collectMirrorPaths(mirrorDir);
  const files = new Map();
  await Promise.all(paths.map(async (relativePath) => {
    files.set(relativePath, await readFile(resolveMirrorPath(mirrorDir, relativePath)));
  }));
  return files;
}

async function restoreMirror(mirrorDir, snapshot) {
  await removeMirrorPaths(mirrorDir, await collectMirrorPaths(mirrorDir));
  await writeMirrorFiles(mirrorDir, snapshot);
}

function hashFiles(files) {
  const hash = createHash('sha256');
  Array.from(files.keys()).sort().forEach((pathValue) => {
    hash.update(pathValue);
    hash.update('\0');
    hash.update(files.get(pathValue));
    hash.update('\0');
  });
  return hash.digest('hex');
}

export class StructurizrWorkspaceService {
  constructor({
    mirrorDir,
    serverUrl = '',
    trustedExecutableDsl = false,
    vaultDir,
  }) {
    this.mirrorDir = resolve(mirrorDir);
    this.serverUrl = String(serverUrl ?? '').trim().replace(/\/+$/u, '');
    this.trustedExecutableDsl = Boolean(trustedExecutableDsl);
    this.vaultDir = resolve(vaultDir);
    this.syncPromise = Promise.resolve();
  }

  isEnabled() {
    return Boolean(this.serverUrl);
  }

  isProxyPath(pathname) {
    return this.isEnabled() && (
      pathname === '/workspace/1'
      || pathname.startsWith('/workspace/1/')
      || pathname.startsWith('/static/')
      || pathname === '/api/workspace/1'
      || pathname.startsWith('/api/workspace/1/')
    );
  }

  isThumbnailPath(pathname) {
    return /^\/workspace\/1\/images\/(?:[^/]+-)?thumbnail(?:-dark)?\.png$/u.test(pathname);
  }

  async sync({ content, rootPath }) {
    if (!this.isEnabled()) {
      throw createServiceError('Structurizr renderer is not configured.', 503, 'STRUCTURIZR_NOT_CONFIGURED');
    }

    const run = async () => this.syncWorkspace({ content, rootPath });
    this.syncPromise = this.syncPromise.catch(() => {}).then(run);
    return this.syncPromise;
  }

  async syncWorkspace({ content, rootPath }) {
    const mirrorRelativePath = relative(this.vaultDir, this.mirrorDir);
    if (!isAbsolute(mirrorRelativePath) && !mirrorRelativePath.startsWith('..')) {
      resolveMirrorPath(this.vaultDir, mirrorRelativePath);
    }
    const normalizedRootPath = normalizeWorkspaceRootPath(rootPath);
    if (!isStructurizrFilePath(normalizedRootPath)) {
      throw createServiceError('Structurizr previews require a workspace.dsl root file.', 400, 'STRUCTURIZR_ROOT_REQUIRED');
    }

    const rootAbsolutePath = sanitizeVaultPath(this.vaultDir, normalizedRootPath);
    if (!rootAbsolutePath) {
      throw createServiceError('Invalid Structurizr workspace path.', 400, 'STRUCTURIZR_ROOT_INVALID');
    }

    let rootInfo;
    try {
      rootInfo = await stat(rootAbsolutePath);
    } catch (error) {
      if (error.code === 'ENOENT') {
        throw createServiceError('Structurizr workspace not found.', 404, 'STRUCTURIZR_ROOT_NOT_FOUND');
      }
      throw error;
    }
    if (!rootInfo.isFile()) {
      throw createServiceError('Structurizr workspace root is not a file.', 400, 'STRUCTURIZR_ROOT_INVALID');
    }

    const [vaultRealPath, rootRealPath] = await Promise.all([
      realpath(this.vaultDir),
      realpath(rootAbsolutePath),
    ]);
    if (rootRealPath !== vaultRealPath && !rootRealPath.startsWith(`${vaultRealPath}/`)) {
      throw createServiceError('Structurizr workspace must remain inside the vault.', 400, 'STRUCTURIZR_ROOT_INVALID');
    }

    const sourceDirectory = dirname(rootRealPath);
    const files = await collectWorkspaceFiles(sourceDirectory);
    const sourceRootFileName = basename(normalizedRootPath);
    const rootSource = typeof content === 'string'
      ? content
      : files.get(sourceRootFileName)?.toString('utf8');
    if (typeof rootSource !== 'string') {
      throw createServiceError('Structurizr workspace source is unavailable.', 400, 'STRUCTURIZR_ROOT_UNREADABLE');
    }

    files.delete(sourceRootFileName);
    files.delete(WORKSPACE_JSON_FILE_NAME);
    files.set(WORKSPACE_DSL_FILE_NAME, Buffer.from(rootSource, 'utf8'));
    if (!this.trustedExecutableDsl) {
      for (const fileContent of files.values()) {
        validateStructurizrDsl(fileContent.toString('utf8'));
      }
    }

    await mkdir(this.mirrorDir, { recursive: true });
    const snapshot = await snapshotMirror(this.mirrorDir);
    const previousManifest = await readManifest(resolveMirrorPath(this.mirrorDir, MANIFEST_FILE_NAME));
    const sourcePaths = Array.from(files.keys());
    const stalePaths = previousManifest.filter((pathValue) => !files.has(pathValue));

    try {
      await removeMirrorPaths(this.mirrorDir, stalePaths);
      await writeMirrorFiles(this.mirrorDir, files);
      // Invalidate the generated workspace after the new DSL is ready.
      const workspaceJsonPath = resolveMirrorPath(this.mirrorDir, WORKSPACE_JSON_FILE_NAME);
      await rm(workspaceJsonPath, { force: true });
      await this.validateMirror();
      await writeFile(
        resolveMirrorPath(this.mirrorDir, MANIFEST_FILE_NAME),
        `${JSON.stringify({ paths: sourcePaths }, null, 2)}\n`,
        'utf8',
      );
    } catch (error) {
      await restoreMirror(this.mirrorDir, snapshot);
      throw error;
    }

    return {
      ok: true,
      rootPath: normalizedRootPath,
      version: hashFiles(files),
    };
  }

  async validateMirror() {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      let response;
      try {
        response = await fetch(`${this.serverUrl}/api/workspace/1`, {
          headers: { Accept: 'application/json' },
          signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
        });
      } catch (error) {
        throw createServiceError(
          `Structurizr renderer is unavailable: ${error.message}`,
          503,
          'STRUCTURIZR_UNAVAILABLE',
        );
      }

      const payload = await response.json().catch(() => ({}));
      if (response.ok && payload.success !== false) {
        return;
      }

      const message = String(payload.message || payload.error || `Structurizr renderer returned HTTP ${response.status}`)
        .replace(/^com\.structurizr\.dsl\.StructurizrDslParserException:\s*/u, '');
      if (response.status === 503 && attempt < 2) {
        await delay(250);
        continue;
      }

      throw createServiceError(
        message,
        response.status >= 400 && response.status < 500 ? 422 : 502,
        response.status >= 400 && response.status < 500
          ? 'STRUCTURIZR_DSL_INVALID'
          : 'STRUCTURIZR_VALIDATION_FAILED',
      );
    }
  }

  async proxy(requestUrl, { body = null, method = 'GET', headers = {} } = {}) {
    if (!this.isProxyPath(requestUrl.pathname)) {
      return null;
    }

    const upstreamUrl = `${this.serverUrl}${requestUrl.pathname}${requestUrl.search}`;
    let response;
    const proxyHeaders = {
      Accept: headers.accept || '*/*',
    };
    if (headers['content-type']) {
      proxyHeaders['Content-Type'] = headers['content-type'];
    }
    if (headers.range) {
      proxyHeaders.Range = headers.range;
    }

    try {
      response = await fetch(upstreamUrl, {
        body,
        headers: proxyHeaders,
        method,
        redirect: 'follow',
        signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
      });
    } catch (error) {
      throw createServiceError(
        `Structurizr renderer is unavailable: ${error.message}`,
        503,
        'STRUCTURIZR_UNAVAILABLE',
      );
    }

    if (response.status === 404 && method === 'GET' && this.isThumbnailPath(requestUrl.pathname)) {
      try {
        const fallbackResponse = await fetch(`${this.serverUrl}${THUMBNAIL_FALLBACK_PATH}`, {
          headers: { Accept: 'image/png' },
          method: 'GET',
          redirect: 'follow',
          signal: AbortSignal.timeout(SIDECAR_TIMEOUT_MS),
        });
        if (fallbackResponse.ok) {
          response = fallbackResponse;
        }
      } catch {
        // Keep the original 404 when the optional placeholder is unavailable.
      }
    }

    return {
      body: Buffer.from(await response.arrayBuffer()),
      contentType: response.headers.get('content-type') || 'application/octet-stream',
      statusCode: response.status,
    };
  }
}
