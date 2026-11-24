import { basename, dirname } from 'node:path';

import { getVaultTreeNodeType, isMarkdownFilePath, isVaultFilePath } from '../../domain/file-kind.js';
import { createWorkspaceChange, createEmptyWorkspaceChange } from '../../domain/workspace-change.js';
import { mapWithConcurrency } from '../shared/async-utils.js';

const WORKSPACE_SCAN_CONCURRENCY = 8;
let workspaceSnapshotRevision = 0;

export function compareWorkspacePaths(left = '', right = '') {
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
}

export function normalizeWorkspacePath(pathValue = '') {
  return String(pathValue ?? '').replace(/\\/g, '/').trim();
}

export function getParentDirectoryPath(pathValue = '') {
  const parentPath = dirname(normalizeWorkspacePath(pathValue)).replace(/\\/g, '/');
  return parentPath === '.' ? '' : parentPath;
}

export function createWorkspaceEntry(pathValue, nodeType) {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  return {
    fileKind: nodeType === 'directory' ? null : getVaultTreeNodeType(normalizedPath),
    name: basename(normalizedPath),
    nodeType,
    parentPath: getParentDirectoryPath(normalizedPath),
    path: normalizedPath,
    type: nodeType === 'directory' ? 'directory' : getVaultTreeNodeType(normalizedPath),
  };
}

export function createWorkspaceMetadata(pathValue, type, info = {}) {
  return {
    ctimeMs: Number(info.ctimeMs || 0),
    inode: Number(info.ino || info.inode || 0),
    mtimeMs: Number(info.mtimeMs || 0),
    path: pathValue,
    size: type === 'directory' ? 0 : Number(info.size || 0),
    type,
  };
}

function enrichWorkspaceEntries(entries, metadata) {
  const enrichedEntries = new Map(entries);
  metadata.forEach((entryMetadata, pathValue) => {
    const entry = enrichedEntries.get(pathValue);
    const mtimeMs = Number(entryMetadata?.mtimeMs);
    if (!entry || !Number.isFinite(mtimeMs) || entry.mtimeMs === mtimeMs) {
      return;
    }

    enrichedEntries.set(pathValue, { ...entry, mtimeMs });
  });
  return enrichedEntries;
}

export function collectWorkspaceStateStats(entries = new Map(), metadata = new Map()) {
  const filePaths = [];
  const markdownPaths = [];
  let vaultFileCount = 0;

  entries.forEach((entry, pathValue) => {
    const entryType = entry?.type ?? entry?.nodeType ?? metadata.get(pathValue)?.type ?? '';
    if (entryType === 'directory') {
      return;
    }

    vaultFileCount += 1;
    if (isVaultFilePath(pathValue)) {
      filePaths.push(pathValue);
    }
    if (isMarkdownFilePath(pathValue)) {
      markdownPaths.push(pathValue);
    }
  });

  filePaths.sort(compareWorkspacePaths);
  markdownPaths.sort(compareWorkspacePaths);

  return {
    filePaths,
    markdownPaths,
    vaultFileCount,
  };
}

export function createWorkspaceStateSnapshot(entries = new Map(), metadata = new Map(), {
  scannedAt = Date.now(),
} = {}) {
  const normalizedMetadata = metadata instanceof Map ? metadata : new Map(metadata ?? []);
  const normalizedEntries = enrichWorkspaceEntries(
    entries instanceof Map ? entries : new Map(entries ?? []),
    normalizedMetadata,
  );
  const stats = collectWorkspaceStateStats(normalizedEntries, normalizedMetadata);

  return {
    entries: normalizedEntries,
    filePaths: stats.filePaths,
    markdownPaths: stats.markdownPaths,
    metadata: normalizedMetadata,
    revision: ++workspaceSnapshotRevision,
    scannedAt,
    vaultFileCount: stats.vaultFileCount,
  };
}

export function getWorkspaceSnapshotKey(snapshot) {
  if (snapshot?.revision != null) return `revision:${snapshot.revision}`;
  return snapshot?.scannedAt != null ? `scanned-at:${snapshot.scannedAt}` : null;
}

function getDirectoryEntryKind(entry = {}) {
  if (typeof entry.isDirectory === 'function' && entry.isDirectory()) {
    return 'directory';
  }
  if (typeof entry.isFile === 'function' && entry.isFile()) {
    return 'file';
  }
  if (entry.type === 'directory' || entry.type === 'file') {
    return entry.type;
  }
  return null;
}

function sortDirectoryEntries(entries = []) {
  return [...entries].sort((left, right) => {
    const leftKind = getDirectoryEntryKind(left);
    const rightKind = getDirectoryEntryKind(right);
    if (leftKind === 'directory' && rightKind !== 'directory') return -1;
    if (leftKind !== 'directory' && rightKind === 'directory') return 1;
    return String(left.name ?? '').localeCompare(String(right.name ?? ''), undefined, { sensitivity: 'base' });
  });
}

async function readWorkspaceStat(adapter, pathValue) {
  try {
    return await adapter.stat(pathValue);
  } catch (error) {
    if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
      return null;
    }
    throw error;
  }
}

function isDirectoryStat(info = {}) {
  return typeof info.isDirectory === 'function' ? info.isDirectory() : info.type === 'directory';
}

function isFileStat(info = {}) {
  return typeof info.isFile === 'function' ? info.isFile() : info.type === 'file';
}

async function walkWorkspaceDirectory(adapter, directoryPath, entries, metadata, { concurrency = WORKSPACE_SCAN_CONCURRENCY, includeRoot = false } = {}) {
  if (includeRoot) {
    const directoryInfo = await readWorkspaceStat(adapter, directoryPath);
    if (!directoryInfo || !isDirectoryStat(directoryInfo)) return;
    entries.set(directoryPath, createWorkspaceEntry(directoryPath, 'directory'));
    metadata.set(directoryPath, createWorkspaceMetadata(directoryPath, 'directory', directoryInfo));
  }

  let dirEntries;
  try {
    dirEntries = await adapter.readDirectory(directoryPath);
  } catch (error) {
    if (directoryPath && ['ENOENT', 'ENOTDIR'].includes(error.code)) {
      entries.delete(directoryPath);
      metadata.delete(directoryPath);
      return;
    }
    throw error;
  }

  const visitEntry = async (entry) => {
    if (adapter.isIgnoredEntry?.(entry.name)) return;
    const relativePath = [directoryPath, entry.name].filter(Boolean).join('/').replace(/\\/g, '/');
    const direntKind = getDirectoryEntryKind(entry);

    if (direntKind === 'directory') {
      entries.set(relativePath, createWorkspaceEntry(relativePath, 'directory'));
      const info = await readWorkspaceStat(adapter, relativePath);
      if (info) metadata.set(relativePath, createWorkspaceMetadata(relativePath, 'directory', info));
      await walkWorkspaceDirectory(adapter, relativePath, entries, metadata, { concurrency });
      return;
    }

    if (direntKind === 'file' && !isVaultFilePath(relativePath)) return;

    const info = await readWorkspaceStat(adapter, relativePath);
    if (!info) {
      if (direntKind === 'file') {
        entries.set(relativePath, createWorkspaceEntry(relativePath, 'file'));
      }
      return;
    }

    if (isDirectoryStat(info)) {
      entries.set(relativePath, createWorkspaceEntry(relativePath, 'directory'));
      metadata.set(relativePath, createWorkspaceMetadata(relativePath, 'directory', info));
      await walkWorkspaceDirectory(adapter, relativePath, entries, metadata, { concurrency });
      return;
    }

    if (isFileStat(info) && isVaultFilePath(relativePath)) {
      entries.set(relativePath, createWorkspaceEntry(relativePath, 'file'));
      metadata.set(relativePath, createWorkspaceMetadata(relativePath, 'file', info));
    }
  };

  if (concurrency > 1) {
    await mapWithConcurrency(sortDirectoryEntries(dirEntries), concurrency, visitEntry);
  } else {
    for (const entry of dirEntries) {
      await visitEntry(entry);
    }
  }
}

export async function scanWorkspaceState(adapter, {
  scannedAt = Date.now(),
} = {}) {
  const entries = new Map();
  const metadata = new Map();
  await walkWorkspaceDirectory(adapter, '', entries, metadata);
  return createWorkspaceStateSnapshot(entries, metadata, { scannedAt });
}

export async function readWorkspacePathState(adapter, pathValue, {
  expectDirectory = null,
} = {}) {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  if (!normalizedPath) {
    return null;
  }

  const info = await readWorkspaceStat(adapter, normalizedPath);
  if (!info) {
    return null;
  }

  if (expectDirectory === true) {
    if (!isDirectoryStat(info)) {
      return null;
    }
    return {
      entry: createWorkspaceEntry(normalizedPath, 'directory'),
      metadata: createWorkspaceMetadata(normalizedPath, 'directory', info),
    };
  }

  if (expectDirectory === false && isDirectoryStat(info)) {
    return null;
  }

  if (isDirectoryStat(info)) {
    return {
      entry: createWorkspaceEntry(normalizedPath, 'directory'),
      metadata: createWorkspaceMetadata(normalizedPath, 'directory', info),
    };
  }

  if (!isFileStat(info) || !isVaultFilePath(normalizedPath)) {
    return null;
  }

  return {
    entry: createWorkspaceEntry(normalizedPath, 'file'),
    metadata: createWorkspaceMetadata(normalizedPath, 'file', info),
  };
}

export async function readWorkspacePathSnapshot(adapter, pathValue) {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  if (!normalizedPath) {
    return null;
  }

  const info = await readWorkspaceStat(adapter, normalizedPath);
  const entries = new Map();
  const metadata = new Map();
  if (!info) {
    return { entries, metadata };
  }

  if (isDirectoryStat(info)) {
    await walkWorkspaceDirectory(adapter, normalizedPath, entries, metadata, { concurrency: 1, includeRoot: true });
    return { entries, metadata };
  }

  if (!isFileStat(info) || !isVaultFilePath(normalizedPath)) {
    return { entries, metadata };
  }

  entries.set(normalizedPath, createWorkspaceEntry(normalizedPath, 'file'));
  metadata.set(normalizedPath, createWorkspaceMetadata(normalizedPath, 'file', info));
  return { entries, metadata };
}

export async function ensureAncestorDirectories(adapter, nextEntries, nextMetadata, pathValue, {
  includeSelf = false,
} = {}) {
  const rootPath = includeSelf ? normalizeWorkspacePath(pathValue) : getParentDirectoryPath(pathValue);
  if (!rootPath) {
    return true;
  }

  const segments = rootPath.split('/').filter(Boolean);
  let currentPath = '';
  for (const segment of segments) {
    currentPath = currentPath ? `${currentPath}/${segment}` : segment;
    if (nextEntries.has(currentPath) && nextMetadata.has(currentPath)) {
      continue;
    }

    const directoryState = await readWorkspacePathState(adapter, currentPath, {
      expectDirectory: true,
    });
    if (!directoryState) {
      return false;
    }

    nextEntries.set(currentPath, directoryState.entry);
    nextMetadata.set(currentPath, directoryState.metadata);
  }

  return true;
}

function compareWorkspaceTreeNodes(left = {}, right = {}) {
  const leftIsDirectory = left.type === 'directory';
  const rightIsDirectory = right.type === 'directory';
  if (leftIsDirectory && !rightIsDirectory) {
    return -1;
  }
  if (!leftIsDirectory && rightIsDirectory) {
    return 1;
  }

  return String(left.name ?? '').localeCompare(String(right.name ?? ''), undefined, { sensitivity: 'base' });
}

function sortWorkspaceTree(nodes = []) {
  nodes.sort(compareWorkspaceTreeNodes);
  nodes.forEach((node) => {
    if (node.type === 'directory') {
      sortWorkspaceTree(node.children);
    }
  });
  return nodes;
}

export function createWorkspaceTree(entries = new Map()) {
  const nodesByPath = new Map();
  const rootNodes = [];

  entries.forEach((entry, pathValue) => {
    const normalizedPath = normalizeWorkspacePath(pathValue);
    if (!normalizedPath) {
      return;
    }

    const mtimeMs = Number(entry?.mtimeMs);
    const node = entry?.type === 'directory' || entry?.nodeType === 'directory'
      ? {
        children: [],
        name: entry?.name ?? basename(normalizedPath),
        path: normalizedPath,
        type: 'directory',
      }
      : {
        name: entry?.name ?? basename(normalizedPath),
        path: normalizedPath,
        type: entry?.type ?? getVaultTreeNodeType(normalizedPath),
      };

    if (node.type !== 'directory' && Number.isFinite(mtimeMs)) {
      node.mtimeMs = mtimeMs;
    }
    nodesByPath.set(normalizedPath, node);
  });

  nodesByPath.forEach((node, pathValue) => {
    const parentPath = getParentDirectoryPath(pathValue);
    const parentNode = parentPath ? nodesByPath.get(parentPath) : null;
    if (parentNode?.type === 'directory') {
      parentNode.children.push(node);
      return;
    }

    rootNodes.push(node);
  });

  return sortWorkspaceTree(rootNodes);
}

export function workspaceEntriesEqual(left = {}, right = {}) {
  return (
    left.fileKind === right.fileKind
    && left.name === right.name
    && left.nodeType === right.nodeType
    && left.parentPath === right.parentPath
    && left.path === right.path
    && left.mtimeMs === right.mtimeMs
    && left.type === right.type
  );
}

export function diffWorkspaceEntries(previousEntries = new Map(), nextEntries = new Map()) {
  const upserts = new Map();
  const deletes = [];

  previousEntries.forEach((previousEntry, pathValue) => {
    const nextEntry = nextEntries.get(pathValue);
    if (!nextEntry) {
      deletes.push(pathValue);
      return;
    }

    if (!workspaceEntriesEqual(previousEntry, nextEntry)) {
      upserts.set(pathValue, nextEntry);
    }
  });

  nextEntries.forEach((nextEntry, pathValue) => {
    if (!previousEntries.has(pathValue)) {
      upserts.set(pathValue, nextEntry);
    }
  });

  return { deletes, upserts };
}

export function workspaceStateMetadataEqual(left = null, right = null) {
  const leftMetadata = left?.metadata;
  const rightMetadata = right?.metadata;
  if (!(leftMetadata instanceof Map) || !(rightMetadata instanceof Map)) {
    return false;
  }

  if (leftMetadata.size !== rightMetadata.size) {
    return false;
  }

  for (const [pathValue, leftEntry] of leftMetadata.entries()) {
    const rightEntry = rightMetadata.get(pathValue);
    if (!rightEntry) {
      return false;
    }

    if (
      leftEntry.type !== rightEntry.type
      || leftEntry.size !== rightEntry.size
      || leftEntry.inode !== rightEntry.inode
      || leftEntry.mtimeMs !== rightEntry.mtimeMs
    ) {
      return false;
    }
  }

  return true;
}

function entrySignature(entry = {}) {
  return `${entry.type}:${entry.inode}:${entry.size}:${entry.mtimeMs}`;
}

function isPathWithinPrefix(pathValue, prefix) {
  return pathValue === prefix || pathValue.startsWith(`${prefix}/`);
}

export function collectAncestorPaths(pathValue = '') {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  if (!normalizedPath) {
    return [];
  }

  const segments = normalizedPath.split('/').filter(Boolean);
  const ancestors = [];
  let currentPath = '';
  for (let index = 0; index < Math.max(segments.length - 1, 0); index += 1) {
    currentPath = currentPath ? `${currentPath}/${segments[index]}` : segments[index];
    ancestors.push(currentPath);
  }

  return ancestors;
}

export function collapseWorkspaceStatePaths(paths = []) {
  const collapsed = [];
  for (const pathValue of [...paths].filter(Boolean).sort(compareWorkspacePaths)) {
    if (collapsed.some((existingPath) => isPathWithinPrefix(pathValue, existingPath))) {
      continue;
    }

    collapsed.push(pathValue);
  }

  return collapsed;
}

export function collectPathsWithinPrefixes(paths = [], prefixes = []) {
  const collected = new Set();
  for (const pathValue of paths) {
    if (prefixes.some((prefix) => isPathWithinPrefix(pathValue, prefix))) {
      collected.add(pathValue);
    }
  }
  return collected;
}

export function createScopedWorkspaceState(sourceState, scopedPaths = new Set()) {
  const entries = new Map();
  const metadata = new Map();

  scopedPaths.forEach((pathValue) => {
    const entry = sourceState?.entries?.get(pathValue);
    const entryMetadata = sourceState?.metadata?.get(pathValue);
    if (entry) {
      entries.set(pathValue, entry);
    }
    if (entryMetadata) {
      metadata.set(pathValue, entryMetadata);
    }
  });

  return {
    entries,
    metadata,
  };
}

function buildPrefixRenameEntries(previousState, nextState, oldPrefix, newPrefix) {
  const renames = [];
  previousState.metadata.forEach((entry, pathValue) => {
    if (entry.type !== 'file' || !pathValue.startsWith(`${oldPrefix}/`)) {
      return;
    }

    const suffix = pathValue.slice(oldPrefix.length + 1);
    const nextPath = `${newPrefix}/${suffix}`;
    if (nextState.metadata.get(nextPath)?.type === 'file') {
      renames.push({ oldPath: pathValue, newPath: nextPath });
    }
  });
  return renames;
}

export function detectWorkspaceStateChange(previousState, nextState) {
  const previousMetadata = previousState?.metadata ?? new Map();
  const nextMetadata = nextState?.metadata ?? new Map();
  const changedPaths = new Set();
  const deletedPaths = new Set();
  const addedPaths = new Set();
  const renamedPaths = [];

  previousMetadata.forEach((previousEntry, pathValue) => {
    const nextEntry = nextMetadata.get(pathValue);
    if (!nextEntry) {
      if (previousEntry.type === 'file') {
        deletedPaths.add(pathValue);
      }
      return;
    }

    if (entrySignature(previousEntry) !== entrySignature(nextEntry) && nextEntry.type === 'file') {
      changedPaths.add(pathValue);
    }
  });

  nextMetadata.forEach((nextEntry, pathValue) => {
    if (!previousMetadata.has(pathValue) && nextEntry.type === 'file') {
      addedPaths.add(pathValue);
    }
  });

  const deletedBySignature = Map.groupBy(deletedPaths, (pathValue) => entrySignature(previousMetadata.get(pathValue)));
  const addedBySignature = Map.groupBy(addedPaths, (pathValue) => entrySignature(nextMetadata.get(pathValue)));

  Array.from(deletedBySignature.keys()).forEach((signature) => {
    const removed = deletedBySignature.get(signature) ?? [];
    const added = addedBySignature.get(signature) ?? [];
    if (removed.length === 1 && added.length === 1) {
      renamedPaths.push({ oldPath: removed[0], newPath: added[0] });
      deletedPaths.delete(removed[0]);
      addedPaths.delete(added[0]);
    }
  });

  const previousDirectories = Array.from(previousMetadata.entries())
    .filter(([, entry]) => entry.type === 'directory' && !nextMetadata.has(entry.path));
  const nextDirectories = Array.from(nextMetadata.entries())
    .filter(([, entry]) => entry.type === 'directory' && !previousMetadata.has(entry.path));

  previousDirectories.forEach(([oldPath, oldEntry]) => {
    const match = nextDirectories.find(([, nextEntry]) => entrySignature(oldEntry) === entrySignature(nextEntry));
    if (!match) {
      return;
    }

    const [newPath] = match;
    buildPrefixRenameEntries(previousState, nextState, oldPath, newPath).forEach((entry) => {
      renamedPaths.push(entry);
      deletedPaths.delete(entry.oldPath);
      addedPaths.delete(entry.newPath);
    });
  });

  addedPaths.forEach((pathValue) => {
    changedPaths.add(pathValue);
  });

  return createWorkspaceChange({
    changedPaths: Array.from(changedPaths).sort(compareWorkspacePaths),
    deletedPaths: Array.from(deletedPaths).sort(compareWorkspacePaths),
    renamedPaths,
    refreshExplorer: true,
  });
}

export function isIncrementalWorkspaceMutationAction(action) {
  return action === 'create-directory'
    || action === 'create-file'
    || action === 'delete-directory'
    || action === 'delete-file'
    || action === 'rename-directory'
    || action === 'rename-file'
    || action === 'upload-attachment'
    || action === 'write-file';
}

function normalizePaths(paths = []) {
  return Array.from(new Set((paths ?? []).filter(Boolean)));
}

function isDirectoryWorkspaceEntry(entry = {}) {
  return entry?.type === 'directory' || entry?.nodeType === 'directory';
}

export async function deriveNextWorkspaceStateForApiMutation(adapter, {
  action,
  previousState,
  workspaceChange = {},
  scannedAt = Date.now(),
} = {}) {
  if (!isIncrementalWorkspaceMutationAction(action)) {
    return null;
  }

  if (!previousState?.entries || !previousState?.metadata) {
    return null;
  }

  const nextEntries = new Map(previousState.entries);
  const nextMetadata = new Map(previousState.metadata);

  for (const pathValue of workspaceChange.deletedPaths ?? []) {
    nextEntries.delete(pathValue);
    nextMetadata.delete(pathValue);
  }

  for (const entry of workspaceChange.renamedPaths ?? []) {
    nextEntries.delete(entry.oldPath);
    nextMetadata.delete(entry.oldPath);

    if (!(await ensureAncestorDirectories(adapter, nextEntries, nextMetadata, entry.newPath))) {
      return null;
    }

    const previousEntry = previousState.entries.get(entry.oldPath);
    const nextPathState = await readWorkspacePathState(adapter, entry.newPath, {
      expectDirectory: isDirectoryWorkspaceEntry(previousEntry) ? true : null,
    });
    if (!nextPathState) {
      return null;
    }

    nextEntries.set(entry.newPath, nextPathState.entry);
    nextMetadata.set(entry.newPath, nextPathState.metadata);
  }

  const changedPaths = normalizePaths(workspaceChange.changedPaths ?? []);
  for (const pathValue of changedPaths) {
    const expectsDirectory = action === 'create-directory';
    if (expectsDirectory) {
      if (!(await ensureAncestorDirectories(adapter, nextEntries, nextMetadata, pathValue, { includeSelf: true }))) {
        return null;
      }

      const directoryState = await readWorkspacePathState(adapter, pathValue, {
        expectDirectory: true,
      });
      if (!directoryState) {
        return null;
      }

      nextEntries.set(pathValue, directoryState.entry);
      nextMetadata.set(pathValue, directoryState.metadata);
      continue;
    }

    if (!(await ensureAncestorDirectories(adapter, nextEntries, nextMetadata, pathValue))) {
      return null;
    }

    const nextPathState = await readWorkspacePathState(adapter, pathValue);
    if (!nextPathState) {
      return null;
    }

    nextEntries.set(pathValue, nextPathState.entry);
    nextMetadata.set(pathValue, nextPathState.metadata);
  }

  return createWorkspaceStateSnapshot(nextEntries, nextMetadata, { scannedAt });
}

export async function deriveIncrementalWorkspaceState(adapter, {
  forceFullScan = false,
  maxPendingPaths = 16,
  pendingPaths = [],
  previousState = null,
  readPathSnapshot = (pathValue) => readWorkspacePathSnapshot(adapter, pathValue),
  scannedAt = Date.now(),
} = {}) {
  if (forceFullScan) {
    return { fallbackReason: 'forced-full-scan', incrementalResult: null };
  }

  if (pendingPaths.length === 0) {
    return { fallbackReason: 'no-pending-paths', incrementalResult: null };
  }

  if (!previousState) {
    return { fallbackReason: 'missing-last-state', incrementalResult: null };
  }

  const collapsedPendingPaths = collapseWorkspaceStatePaths(pendingPaths);
  if (collapsedPendingPaths.length === 0 || collapsedPendingPaths.length > maxPendingPaths) {
    return { fallbackReason: 'too-many-pending-paths', incrementalResult: null };
  }

  const nextEntries = new Map(previousState.entries);
  const nextMetadata = new Map(previousState.metadata);
  const previousTouchedPaths = collectPathsWithinPrefixes(previousState.entries.keys(), collapsedPendingPaths);
  const nextTouchedPaths = new Set();

  collapsedPendingPaths.forEach((pathValue) => {
    collectAncestorPaths(pathValue).forEach((ancestorPath) => {
      if (previousState.entries.has(ancestorPath)) {
        previousTouchedPaths.add(ancestorPath);
      }
    });
  });

  previousTouchedPaths.forEach((pathValue) => {
    nextEntries.delete(pathValue);
    nextMetadata.delete(pathValue);
  });

  for (const pathValue of collapsedPendingPaths) {
    const snapshot = await readPathSnapshot(pathValue);
    if (!snapshot) {
      return { fallbackReason: 'snapshot-unavailable', incrementalResult: null };
    }

    if (!(await ensureAncestorDirectories(adapter, nextEntries, nextMetadata, pathValue))) {
      return { fallbackReason: 'ancestor-missing', incrementalResult: null };
    }

    collectAncestorPaths(pathValue).forEach((ancestorPath) => {
      if (nextEntries.has(ancestorPath)) {
        nextTouchedPaths.add(ancestorPath);
      }
    });

    snapshot.entries.forEach((entry, entryPath) => {
      nextEntries.set(entryPath, entry);
      nextTouchedPaths.add(entryPath);
    });
    snapshot.metadata.forEach((metadata, metadataPath) => {
      nextMetadata.set(metadataPath, metadata);
    });
  }

  const nextState = createWorkspaceStateSnapshot(nextEntries, nextMetadata, { scannedAt });
  const workspaceChange = detectWorkspaceStateChange(
    createScopedWorkspaceState(previousState, previousTouchedPaths),
    createScopedWorkspaceState(nextState, nextTouchedPaths),
  );

  return {
    fallbackReason: '',
    incrementalResult: {
      nextState,
      workspaceChange,
    },
  };
}

export function createDirectoryRenameWorkspaceChange(workspaceState, oldPath, newPath) {
  const normalizedOldPath = normalizeWorkspacePath(oldPath);
  const normalizedNewPath = normalizeWorkspacePath(newPath);
  if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
    return createEmptyWorkspaceChange();
  }

  const renamedPaths = Array.from(workspaceState?.entries?.keys?.() ?? [])
    .filter((pathValue) => pathValue === normalizedOldPath || pathValue.startsWith(`${normalizedOldPath}/`))
    .sort((left, right) => {
      const depthDelta = left.split('/').length - right.split('/').length;
      if (depthDelta !== 0) {
        return depthDelta;
      }

      return compareWorkspacePaths(left, right);
    })
    .map((pathValue) => ({
      oldPath: pathValue,
      newPath: pathValue === normalizedOldPath
        ? normalizedNewPath
        : `${normalizedNewPath}${pathValue.slice(normalizedOldPath.length)}`,
    }));

  if (renamedPaths.length === 0) {
    renamedPaths.push({ oldPath: normalizedOldPath, newPath: normalizedNewPath });
  }

  return createWorkspaceChange({ renamedPaths });
}

export function createDirectoryDeleteWorkspaceChange(workspaceState, pathValue) {
  const normalizedPath = normalizeWorkspacePath(pathValue);
  if (!normalizedPath) {
    return createEmptyWorkspaceChange();
  }

  const deletedPaths = Array.from(workspaceState?.entries?.keys?.() ?? [])
    .filter((entryPath) => entryPath === normalizedPath || entryPath.startsWith(`${normalizedPath}/`))
    .sort((left, right) => {
      const depthDelta = right.split('/').length - left.split('/').length;
      if (depthDelta !== 0) {
        return depthDelta;
      }

      return compareWorkspacePaths(left, right);
    });

  if (deletedPaths.length === 0) {
    deletedPaths.push(normalizedPath);
  }

  return createWorkspaceChange({ deletedPaths });
}
