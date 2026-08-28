import { supportsBacklinksForFilePath } from '../../domain/file-kind.js';
import {
  createEmptyWorkspaceChange,
  createWorkspaceChange,
  normalizeWorkspaceEvent,
} from '../../domain/workspace-change.js';
import { WORKSPACE_ROOM_NAME } from '../../domain/workspace-room.js';
import {
  createDirectoryDeleteWorkspaceChange as createWorkspaceStateDirectoryDeleteChange,
  createDirectoryRenameWorkspaceChange as createWorkspaceStateDirectoryRenameChange,
  createWorkspaceTree,
  deriveNextWorkspaceStateForApiMutation as deriveNextWorkspaceStateFromApiMutation,
  diffWorkspaceEntries,
  isIncrementalWorkspaceMutationAction,
  readWorkspacePathState as readWorkspacePathStateFromAdapter,
} from '../domain/workspace-state.js';

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

function countBacklinkAffectedPaths(workspaceChange = {}) {
  const affectedPaths = new Set();

  (workspaceChange.changedPaths ?? []).forEach((pathValue) => {
    if (supportsBacklinksForFilePath(pathValue)) {
      affectedPaths.add(pathValue);
    }
  });
  (workspaceChange.deletedPaths ?? []).forEach((pathValue) => {
    if (supportsBacklinksForFilePath(pathValue)) {
      affectedPaths.add(pathValue);
    }
  });
  (workspaceChange.renamedPaths ?? []).forEach((entry) => {
    if (supportsBacklinksForFilePath(entry?.oldPath)) {
      affectedPaths.add(entry.oldPath);
    }
    if (supportsBacklinksForFilePath(entry?.newPath)) {
      affectedPaths.add(entry.newPath);
    }
  });

  return affectedPaths.size;
}

function normalizePaths(paths = []) {
  return Array.from(new Set((paths ?? []).filter(Boolean)));
}

export class WorkspaceReconciliation {
  constructor({
    backlinkIndex,
    baseQueryService = null,
    roomRegistry,
    vaultFileStore,
    workspaceStateAdapter,
    managedWriteWindowMs = 1200,
  }) {
    this.backlinkIndex = backlinkIndex ?? null;
    this.baseQueryService = baseQueryService ?? null;
    this.roomRegistry = roomRegistry;
    this.vaultFileStore = vaultFileStore;
    this.workspaceStateAdapter = workspaceStateAdapter;
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
    return isIncrementalWorkspaceMutationAction(action);
  }

  async readWorkspacePathState(pathValue, {
    expectDirectory = null,
  } = {}) {
    return readWorkspacePathStateFromAdapter(this.workspaceStateAdapter, pathValue, {
      expectDirectory,
    });
  }

  async deriveNextWorkspaceStateForApiMutation(action, workspaceChange = {}) {
    return deriveNextWorkspaceStateFromApiMutation(this.workspaceStateAdapter, {
      action,
      previousState: this.workspaceState,
      workspaceChange,
    });
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

  async initialize({ snapshot = null } = {}) {
    const effectiveSnapshot = snapshot ?? await this.vaultFileStore.scanWorkspaceState();
    this.replaceWorkspaceState(effectiveSnapshot);
    await this.baseQueryService?.snapshotStore?.initializeFromWorkspaceState?.(effectiveSnapshot);
    this.getWorkspaceRoom()?.replaceWorkspaceEntries(effectiveSnapshot.entries, {
      generatedAt: effectiveSnapshot.scannedAt,
    });
    return effectiveSnapshot;
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
    const workspaceState = await this.getWorkspaceStateSnapshot();
    return createWorkspaceStateDirectoryRenameChange(workspaceState, oldPath, newPath);
  }

  async createDirectoryDeleteWorkspaceChange(pathValue) {
    const workspaceState = await this.getWorkspaceStateSnapshot();
    return createWorkspaceStateDirectoryDeleteChange(workspaceState, pathValue);
  }

  async reconcileBacklinks(workspaceChange, nextState, {
    forceRebuild = false,
  } = {}) {
    if (!this.backlinkIndex) {
      return;
    }

    if (
      forceRebuild
      || countBacklinkAffectedPaths(workspaceChange) > 25
    ) {
      this.backlinkIndex.scheduleBuild?.({ workspaceState: nextState });
      return;
    }
    await this.backlinkIndex.applyWorkspaceChange?.(workspaceChange, {
      nextState,
      previousState: this.workspaceState,
    });
  }

  async reconcileVaultChangeObservation({
    action = 'workspace',
    origin = 'filesystem',
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
    await this.baseQueryService?.applyWorkspaceChange?.(normalizedChange, {
      nextState: resolvedState,
      previousState,
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

  apply(options = {}) {
    return this.reconcileVaultChangeObservation({
      origin: options.origin ?? 'api',
      ...options,
    });
  }

  async writeEditableContent({ content, origin = 'api', path, requestId = null, sourceRef = null } = {}) {
    const result = await this.vaultFileStore.writeEditableVaultContent(path, content);
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'write-file',
      origin,
      requestId,
      sourceRef,
      workspaceChange: createWorkspaceChange({
        changedPaths: [path],
      }),
    });
    return result;
  }

  async uploadAttachment({ content, mimeType, origin = 'api', originalFileName = '', requestId = null, sourceDocumentPath } = {}) {
    const result = await this.vaultFileStore.writeImageAttachmentForDocument(sourceDocumentPath, {
      content,
      mimeType,
      originalFileName,
    });
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'upload-attachment',
      origin,
      requestId,
      workspaceChange: createWorkspaceChange({
        changedPaths: [result.path],
      }),
    });
    return result;
  }

  async createFile({ content = '', origin = 'api', path, requestId = null, sourceRef = null } = {}) {
    const result = await this.vaultFileStore.createFile(path, content);
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'create-file',
      origin,
      requestId,
      sourceRef,
      workspaceChange: createWorkspaceChange({
        changedPaths: [path],
      }),
    });
    return result;
  }

  async deleteFile({ origin = 'api', path, requestId = null } = {}) {
    const result = await this.vaultFileStore.deleteFile(path);
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'delete-file',
      origin,
      requestId,
      workspaceChange: createWorkspaceChange({
        deletedPaths: [path],
      }),
    });
    return result;
  }

  async renameFile({ newPath, oldPath, origin = 'api', requestId = null } = {}) {
    const result = await this.vaultFileStore.renameFile(oldPath, newPath);
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'rename-file',
      origin,
      requestId,
      workspaceChange: createWorkspaceChange({
        renamedPaths: [{ oldPath, newPath }],
      }),
    });
    return result;
  }

  async createDirectory({ origin = 'api', path, requestId = null } = {}) {
    const result = await this.vaultFileStore.createDirectory(path);
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'create-directory',
      origin,
      requestId,
      workspaceChange: createWorkspaceChange({
        changedPaths: [path],
      }),
    });
    return result;
  }

  async renameDirectory({ newPath, oldPath, origin = 'api', requestId = null } = {}) {
    const workspaceChange = await this.createDirectoryRenameWorkspaceChange(oldPath, newPath);
    const result = await this.vaultFileStore.renameDirectory(oldPath, newPath);
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'rename-directory',
      origin,
      requestId,
      workspaceChange,
    });
    return result;
  }

  async deleteDirectory({ origin = 'api', path, recursive = false, requestId = null } = {}) {
    const workspaceChange = await this.createDirectoryDeleteWorkspaceChange(path);
    const result = await this.vaultFileStore.deleteDirectory(path, { recursive });
    if (!result.ok) {
      return result;
    }

    await this.reconcileVaultChangeObservation({
      action: 'delete-directory',
      origin,
      requestId,
      workspaceChange,
    });
    return result;
  }
}
