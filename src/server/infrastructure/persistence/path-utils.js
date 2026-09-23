import { lstatSync } from 'node:fs';
import { isAbsolute, join, normalize, relative, resolve } from 'path';

import { getVaultFileKind, isVaultFilePath } from '../../../domain/file-kind.js';

export const IGNORED_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.DS_Store']);
export const VAULT_FILE_PATH_REQUIREMENT = '.md, .markdown, .mdx, .html, .htm, .base, .canvas, .excalidraw, .drawio, .mmd, .mermaid, .puml, .plantuml, .dsl, .pdf, .png, .jpg, .jpeg, .webp, .gif, or .svg';
export const INVALID_VAULT_FILE_PATH_ERROR = `Invalid file path — must end in ${VAULT_FILE_PATH_REQUIREMENT}`;
export const INVALID_DIRECTORY_PATH_ERROR = 'Invalid directory path';

export function isIgnoredVaultEntry(name) {
  return IGNORED_DIRECTORIES.has(name.toLowerCase()) || name.startsWith('.');
}

function normalizeRequestedPath(requestedPath) {
  const value = String(requestedPath ?? '').trim().replace(/\\/g, '/');
  const segments = value.split('/');
  if (
    !value
    || value.includes('\0')
    || isAbsolute(value)
    || segments.some((segment) => segment === '.' || segment === '..')
  ) {
    return '';
  }

  const normalized = normalize(value);
  return normalized === '.' ? '' : normalized;
}

export function sanitizeVaultPath(vaultDir, requestedPath, { allowIgnored = false } = {}) {
  const normalized = normalizeRequestedPath(requestedPath);
  if (!normalized) {
    return null;
  }

  const absolute = resolve(vaultDir, normalized);
  const relativePath = relative(vaultDir, absolute);
  const segments = relativePath.split(/[\\/]/u);

  if (
    relativePath.startsWith('..')
    || relativePath === '..'
    || isAbsolute(relativePath)
    || (!allowIgnored && segments.some(isIgnoredVaultEntry))
  ) {
    return null;
  }

  // The configured root may be a symlink; content below it must never be one.
  let currentPath = resolve(vaultDir);
  for (const segment of segments) {
    currentPath = join(currentPath, segment);
    try {
      if (lstatSync(currentPath).isSymbolicLink()) {
        return null;
      }
    } catch (error) {
      if (error.code === 'ENOENT') {
        break;
      }
      return null;
    }
  }

  return absolute;
}

export function resolveVaultFilePath(vaultDir, requestedPath) {
  const absolute = sanitizeVaultPath(vaultDir, requestedPath);
  if (!absolute || !isVaultFilePath(absolute)) {
    return { absolute: null, error: INVALID_VAULT_FILE_PATH_ERROR };
  }

  return { absolute, error: null };
}

export function resolveVaultDirectoryPath(vaultDir, requestedPath) {
  const absolute = sanitizeVaultPath(vaultDir, requestedPath);
  if (!absolute) {
    return { absolute: null, error: INVALID_DIRECTORY_PATH_ERROR };
  }

  return { absolute, error: null };
}

export function resolveVaultDirectoryRenamePaths(vaultDir, oldPath, newPath) {
  const absoluteOld = sanitizeVaultPath(vaultDir, oldPath);
  const absoluteNew = sanitizeVaultPath(vaultDir, newPath);

  if (!absoluteOld || !absoluteNew) {
    return { absoluteNew: null, absoluteOld: null, error: INVALID_DIRECTORY_PATH_ERROR };
  }

  return { absoluteNew, absoluteOld, error: null };
}

export function resolveVaultRenamePaths(vaultDir, oldPath, newPath) {
  const absoluteOld = sanitizeVaultPath(vaultDir, oldPath);
  const absoluteNew = sanitizeVaultPath(vaultDir, newPath);

  if (!absoluteOld || !absoluteNew) {
    return { absoluteNew: null, absoluteOld: null, error: 'Invalid file path' };
  }

  if (!isVaultFilePath(absoluteOld)) {
    return {
      absoluteNew: null,
      absoluteOld: null,
      error: `Old path must be a vault file (${VAULT_FILE_PATH_REQUIREMENT})`,
    };
  }

  if (!isVaultFilePath(absoluteNew)) {
    return {
      absoluteNew: null,
      absoluteOld: null,
      error: `New path must be a vault file (${VAULT_FILE_PATH_REQUIREMENT})`,
    };
  }

  const oldKind = getVaultFileKind(absoluteOld);
  const newKind = getVaultFileKind(absoluteNew);
  if (oldKind !== newKind && [oldKind, newKind].includes('canvas')) {
    return { absoluteNew: null, absoluteOld: null, error: 'Canvas files must keep the .canvas extension' };
  }

  return { absoluteNew, absoluteOld, error: null };
}

export function toVaultRelativePath(vaultDir, absolutePath) {
  return relative(vaultDir, absolutePath);
}
