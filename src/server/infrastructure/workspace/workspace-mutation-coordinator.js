import { stat } from 'node:fs/promises';
import { basename, dirname } from 'node:path';

import { getVaultTreeNodeType, isVaultFilePath, supportsBacklinksForFilePath } from '../../../domain/file-kind.js';
import {
  createEmptyWorkspaceChange,
  createWorkspaceChange,
  normalizeWorkspaceEvent,
} from '../../../domain/workspace-change.js';
import { WORKSPACE_ROOM_NAME } from '../../../domain/workspace-room.js';
import { sanitizeVaultPath } from '../persistence/path-utils.js';

function createEventId() {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `workspace-${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function countWorkspacePaths(workspaceChange = {}) {
  return (
    (workspaceChange.changedPaths?.length ?? 0)
    + (workspaceChange.deletedPaths?.length ?? 0)
    + (workspaceChange.renamedPaths?.length ?? 0)
  );
}

function normalizePaths(paths = []) {
  return Array.from(new Set((paths ?? []).filter(Boolean)));
}

function normalizeWorkspacePath(pathValue = '') {
  return String(pathValue ?? '').replace(/\\/g, '/').trim();
}

function isDirectoryWorkspaceEntry(entry = {}) {
  return entry?.type === 'directory' || entry?.nodeType === 'directory';
}

function getParentDirectoryPath(pathValue = '') {
  const parentPath = dirname(normalizeWorkspacePath(pathValue)).replace(/\\/g, '/');
  return parentPath === '.' ? '' : parentPath;
}

function createWorkspaceEntry(pathValue, nodeType) {
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

function createWorkspaceMetadata(pathValue, type, info) {
  return {
    inode: Number(info.ino || 0),
    mtimeMs: Number(info.mtimeMs || 0),
    path: pathValue,
    size: type === 'directory' ? 0 : Number(info.size || 0),
    type,
  };
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

function createWorkspaceTree(entries = new Map()) {
  const nodesByPath = new Map();
  const rootNodes = [];

  entries.forEach((entry, pathValue) => {
    const normalizedPath = normalizeWorkspacePath(pathValue);
    if (!normalizedPath) {
      return;
    }

    if (entry?.type === 'directory' || entry?.nodeType === 'directory') {
      nodesByPath.set(normalizedPath, {
        children: [],
        name: entry?.name ?? basename(normalizedPath),
        path: normalizedPath,
        type: 'directory',
      });
      return;
    }

    nodesByPath.set(normalizedPath, {
      name: entry?.name ?? basename(normalizedPath),
      path: normalizedPath,
      type: entry?.type ?? getVaultTreeNodeType(normalizedPath),
    });
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

function workspaceEntriesEqual(left = {}, right = {}) {
  return (
    left.fileKind === right.fileKind
    && left.name === right.name
    && left.nodeType === right.nodeType
    && left.parentPath === right.parentPath
    && left.path === right.path
    && left.type === right.type
  );
}

function diffWorkspaceEntries(previousEntries = new Map(), nextEntries = new Map()) {
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

export class WorkspaceMutationCoordinator {
  constructor({
    backlinkIndex,
    roomRegistry,
    vaultFileStore,
    managedWriteWindowMs = 1200,
  }) {
    this.backlinkIndex = backlinkIndex ?? null;
    this.roomRegistry = roomRegistry;
    this.vaultFileStore = vaultFileStore;
    this.managedWriteWindowMs = managedWriteWindowMs;
    this.managedPathExpiry = new Map();
    this.globalSuppressionUntil = 0;
    this.workspaceState = null;
    this.workspaceTree = [];
  }

  replaceWorkspaceState(nextState) {
    this.workspaceState = nextState ?? null;
    this.workspaceTree = createWorkspaceTree(nextState?.entries ?? new Map());
    return this.workspaceState;
  }

  getWorkspaceTree() {
    return this.workspaceTree;
  }

  isIncrementalApiAction(action) {
    return action === 'create-directory'
      || action === 'create-file'
      || action === 'delete-directory'
      || action === 'delete-file'
      || action === 'rename-directory'
      || action === 'rename-file'
      || action === 'upload-attachment'
      || action === 'write-file';
  }

  async readWorkspacePathState(pathValue, {
    expectDirectory = null,
  } = {}) {
    const normalizedPath = normalizeWorkspacePath(pathValue);
    if (!normalizedPath) {
      return null;
    }

    const absolutePath = sanitizeVaultPath(this.vaultFileStore?.vaultDir, normalizedPath);
    if (!absolutePath) {
      return null;
    }

    try {
      const info = await stat(absolutePath);
      if (expectDirectory === true) {
        if (!info.isDirectory()) {
          return null;
        }

        return {
          entry: createWorkspaceEntry(normalizedPath, 'directory'),
          metadata: createWorkspaceMetadata(normalizedPath, 'directory', info),
        };
      }

      if (expectDirectory === false && info.isDirectory()) {
        return null;
      }

      if (info.isDirectory()) {
        return {
          entry: createWorkspaceEntry(normalizedPath, 'directory'),
          metadata: createWorkspaceMetadata(normalizedPath, 'directory', info),
        };
      }

      if (!info.isFile() || !isVaultFilePath(normalizedPath)) {
        return null;
      }

      return {
        entry: createWorkspaceEntry(normalizedPath, 'file'),
        metadata: createWorkspaceMetadata(normalizedPath, 'file', info),
      };
    } catch (error) {
      if (error?.code === 'ENOENT' || error?.code === 'ENOTDIR') {
        return null;
      }

      throw error;
    }
  }

  async ensureDirectoryEntries(nextEntries, nextMetadata, pathValue, {
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

      const directoryState = await this.readWorkspacePathState(currentPath, {
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

  async deriveNextWorkspaceStateForApiMutation(action, workspaceChange = {}) {
    if (!this.isIncrementalApiAction(action)) {
      return null;
    }

    const previousState = this.workspaceState;
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

      if (!(await this.ensureDirectoryEntries(nextEntries, nextMetadata, entry.newPath))) {
        return null;
      }

      const previousEntry = previousState.entries.get(entry.oldPath);
      const nextPathState = await this.readWorkspacePathState(entry.newPath, {
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
        if (!(await this.ensureDirectoryEntries(nextEntries, nextMetadata, pathValue, { includeSelf: true }))) {
          return null;
        }

        const directoryState = await this.readWorkspacePathState(pathValue, {
          expectDirectory: true,
        });
        if (!directoryState) {
          return null;
        }

        nextEntries.set(pathValue, directoryState.entry);
        nextMetadata.set(pathValue, directoryState.metadata);
        continue;
      }

      if (!(await this.ensureDirectoryEntries(nextEntries, nextMetadata, pathValue))) {
        return null;
      }

      const nextPathState = await this.readWorkspacePathState(pathValue);
      if (!nextPathState) {
        return null;
      }

      nextEntries.set(pathValue, nextPathState.entry);
      nextMetadata.set(pathValue, nextPathState.metadata);
    }

    return {
      entries: nextEntries,
      metadata: nextMetadata,
      scannedAt: Date.now(),
    };
  }

  getWorkspaceRoom() {
    return this.roomRegistry?.getOrCreate?.(WORKSPACE_ROOM_NAME) ?? null;
  }

  syncWorkspaceEntries(nextState, {
    previousState = this.workspaceState,
  } = {}) {
    const room = this.getWorkspaceRoom();
    if (!room || !nextState) {
      return false;
    }

    const patch = diffWorkspaceEntries(
      previousState?.entries ?? new Map(),
      nextState.entries ?? new Map(),
    );
    return room.applyWorkspaceEntryPatch(patch, {
      generatedAt: nextState.scannedAt,
    });
  }

  async initialize() {
    const snapshot = await this.vaultFileStore.scanWorkspaceState();
    this.replaceWorkspaceState(snapshot);
    this.getWorkspaceRoom()?.replaceWorkspaceEntries(snapshot.entries, {
      generatedAt: snapshot.scannedAt,
    });
    return snapshot;
  }

  markManagedPaths(paths = [], { durationMs = this.managedWriteWindowMs } = {}) {
    const expiresAt = Date.now() + durationMs;
    normalizePaths(paths).forEach((pathValue) => {
      this.managedPathExpiry.set(pathValue, expiresAt);
    });
  }

  runManagedWrite(paths = [], operation) {
    this.markManagedPaths(paths);
    return Promise.resolve(operation()).finally(() => {
      this.markManagedPaths(paths);
    });
  }

  async runManagedWorkspaceMutation(operation) {
    this.globalSuppressionUntil = Math.max(this.globalSuppressionUntil, Date.now() + this.managedWriteWindowMs);
    try {
      return await operation();
    } finally {
      this.globalSuppressionUntil = Math.max(this.globalSuppressionUntil, Date.now() + this.managedWriteWindowMs);
    }
  }

  isGloballySuppressed() {
    return Date.now() <= this.globalSuppressionUntil;
  }

  cleanupExpiredManagedPaths() {
    const now = Date.now();
    Array.from(this.managedPathExpiry.entries()).forEach(([pathValue, expiresAt]) => {
      if (expiresAt <= now) {
        this.managedPathExpiry.delete(pathValue);
      }
    });
  }

  isManagedPath(pathValue) {
    this.cleanupExpiredManagedPaths();
    const expiresAt = this.managedPathExpiry.get(pathValue);
    return Number.isFinite(expiresAt) && expiresAt > Date.now();
  }

  filterManagedWorkspaceChange(workspaceChange = {}) {
    if (this.isGloballySuppressed()) {
      return null;
    }

    const filtered = createWorkspaceChange({
      changedPaths: (workspaceChange.changedPaths ?? []).filter((pathValue) => !this.isManagedPath(pathValue)),
      deletedPaths: (workspaceChange.deletedPaths ?? []).filter((pathValue) => !this.isManagedPath(pathValue)),
      renamedPaths: (workspaceChange.renamedPaths ?? []).filter((entry) => (
        entry?.oldPath
        && entry?.newPath
        && !this.isManagedPath(entry.oldPath)
        && !this.isManagedPath(entry.newPath)
      )),
      refreshExplorer: workspaceChange.refreshExplorer !== false,
    });

    if (countWorkspacePaths(filtered) === 0) {
      return null;
    }

    return filtered;
  }

  async getWorkspaceStateSnapshot() {
    return this.workspaceState ?? this.vaultFileStore.scanWorkspaceState();
  }

  async createDirectoryRenameWorkspaceChange(oldPath, newPath) {
    const normalizedOldPath = normalizeWorkspacePath(oldPath);
    const normalizedNewPath = normalizeWorkspacePath(newPath);
    if (!normalizedOldPath || !normalizedNewPath || normalizedOldPath === normalizedNewPath) {
      return createEmptyWorkspaceChange();
    }

    const workspaceState = await this.getWorkspaceStateSnapshot();
    const renamedPaths = Array.from(workspaceState.entries.keys())
      .filter((pathValue) => pathValue === normalizedOldPath || pathValue.startsWith(`${normalizedOldPath}/`))
      .sort((left, right) => {
        const depthDelta = left.split('/').length - right.split('/').length;
        if (depthDelta !== 0) {
          return depthDelta;
        }

        return left.localeCompare(right, undefined, { sensitivity: 'base' });
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

  async createDirectoryDeleteWorkspaceChange(pathValue) {
    const normalizedPath = normalizeWorkspacePath(pathValue);
    if (!normalizedPath) {
      return createEmptyWorkspaceChange();
    }

    const workspaceState = await this.getWorkspaceStateSnapshot();
    const deletedPaths = Array.from(workspaceState.entries.keys())
      .filter((entryPath) => entryPath === normalizedPath || entryPath.startsWith(`${normalizedPath}/`))
      .sort((left, right) => {
        const depthDelta = right.split('/').length - left.split('/').length;
        if (depthDelta !== 0) {
          return depthDelta;
        }

        return left.localeCompare(right, undefined, { sensitivity: 'base' });
      });

    if (deletedPaths.length === 0) {
      deletedPaths.push(normalizedPath);
    }

    return createWorkspaceChange({ deletedPaths });
  }

  async reconcileBacklinks(workspaceChange, nextState, {
    forceRebuild = false,
  } = {}) {
    if (!this.backlinkIndex) {
      return;
    }

    const previousEntries = this.workspaceState?.entries ?? new Map();
    if (
      forceRebuild
      || countWorkspacePaths(workspaceChange) > 25
    ) {
      this.backlinkIndex.scheduleBuild?.();
      return;
    }

    for (const pathValue of workspaceChange.deletedPaths ?? []) {
      if (supportsBacklinksForFilePath(pathValue)) {
        this.backlinkIndex.onFileDeleted(pathValue);
      }
    }

    for (const entry of workspaceChange.renamedPaths ?? []) {
      if (supportsBacklinksForFilePath(entry.oldPath) || supportsBacklinksForFilePath(entry.newPath)) {
        this.backlinkIndex.onFileRenamed(entry.oldPath, entry.newPath);
      }
    }

    for (const pathValue of workspaceChange.changedPaths ?? []) {
      if (!supportsBacklinksForFilePath(pathValue)) {
        continue;
      }

      const existsNow = nextState.entries.has(pathValue);
      const existedBefore = previousEntries.has(pathValue);
      if (!existsNow) {
        if (existedBefore) {
          this.backlinkIndex.onFileDeleted(pathValue);
        }
        continue;
      }

      const content = await this.vaultFileStore.readMarkdownFile(pathValue);
      if (content === null) {
        continue;
      }

      if (existedBefore) {
        this.backlinkIndex.updateFile(pathValue, content);
      } else {
        this.backlinkIndex.onFileCreated(pathValue, content);
      }
    }
  }

  async apply({
    action = 'workspace',
    origin = 'api',
    publishEvent = true,
    requestId = null,
    sourceRef = null,
    workspaceChange = createEmptyWorkspaceChange(),
    nextState = null,
    forceBacklinkRebuild = false,
  } = {}) {
    const normalizedChange = createWorkspaceChange(workspaceChange);
    const previousState = this.workspaceState;
    const derivedState = nextState
      ? null
      : await this.deriveNextWorkspaceStateForApiMutation(action, normalizedChange);
    const resolvedState = nextState ?? derivedState ?? await this.vaultFileStore.scanWorkspaceState();

    await this.vaultFileStore.reconcileSidecars?.(normalizedChange);
    await this.vaultFileStore.reconcileCollaborationSnapshots?.(normalizedChange);
    await this.reconcileBacklinks(normalizedChange, resolvedState, {
      forceRebuild: forceBacklinkRebuild,
    });

    const roomEffects = await this.roomRegistry?.reconcileWorkspaceChange?.(normalizedChange) ?? {};
    const highlightRanges = normalizePaths(
      (roomEffects.highlightRanges ?? []).map((entry) => entry?.path),
    ).map((pathValue) => roomEffects.highlightRanges.find((entry) => entry.path === pathValue));
    const reloadRequiredPaths = normalizePaths(roomEffects.reloadRequiredPaths ?? []);

    this.syncWorkspaceEntries(resolvedState, {
      previousState,
    });
    this.replaceWorkspaceState(resolvedState);

    if (!publishEvent) {
      return null;
    }

    const event = normalizeWorkspaceEvent({
      action,
      createdAt: Date.now(),
      highlightRanges,
      id: createEventId(),
      origin,
      reloadRequiredPaths,
      requestId,
      sourceRef,
      workspaceChange: normalizedChange,
    });
    this.getWorkspaceRoom()?.publishWorkspaceEvent(event);
    return event;
  }
}
