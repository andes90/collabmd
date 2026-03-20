import { isAbsolute, normalize, relative, resolve } from 'path';

import { isVaultFilePath } from '../../../domain/file-kind.js';

export const IGNORED_DIRECTORIES = new Set(['.git', '.obsidian', '.trash', 'node_modules', '.DS_Store']);
export const VAULT_FILE_PATH_REQUIREMENT = '.md, .excalidraw, .mmd, .mermaid, .puml, .plantuml, .png, .jpg, .jpeg, .webp, .gif, or .svg';
export const INVALID_VAULT_FILE_PATH_ERROR = `Invalid file path — must end in ${VAULT_FILE_PATH_REQUIREMENT}`;
export const INVALID_DIRECTORY_PATH_ERROR = 'Invalid directory path';

export function isIgnoredVaultEntry(name) {
  return IGNORED_DIRECTORIES.has(name) || name.startsWith('.');
}

function normalizeRequestedPath(requestedPath) {
  const raw = String(requestedPath ?? '').trim().replace(/\\/g, '/');
  if (raw.includes('\0')) {
    return '';
  }

  const normalized = normalize(raw);
  if (!normalized || normalized === '.') {
    return '';
  }

  return normalized;
}

export function sanitizeVaultPath(vaultDir, requestedPath) {
  const normalized = normalizeRequestedPath(requestedPath);
  if (!normalized) {
    return null;
  }

  const absolute = resolve(vaultDir, normalized);
  const relativePath = relative(vaultDir, absolute);

  if (
    relativePath.startsWith('..')
    || relativePath === '..'
    || isAbsolute(relativePath)
  ) {
    return null;
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

  return { absoluteNew, absoluteOld, error: null };
}

export function toVaultRelativePath(vaultDir, absolutePath) {
  return relative(vaultDir, absolutePath);
}
