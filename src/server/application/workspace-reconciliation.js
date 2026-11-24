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
  normalizeWorkspacePath,
  readWorkspacePathState,
} from '../domain/workspace-state.js';

function createEventId() {
  return globalThis.crypto.randomUUID();
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

function normalizeMutationPath(path) {
  return normalizeWorkspacePath(path).replace(/\/{2,}/gu, '/').replace(/\/$/u, '');
}

function samePathMetadata(expected, actual) {
  if (!expected || !actual) return !expected && !actual;
  return expected.type === actual.type && expected.inode === actual.inode
    && expected.size === actual.size && expected.mtimeMs === actual.mtimeMs;
}

export class WorkspaceReconciliation {
  constructor({
    backlinkIndex,
    baseQueryService = null,
    roomRegistry,
    vaultFileStore,
    workspaceStateAdapter,
  }) {
    this.backlinkIndex = backlinkIndex ?? null;
    this.baseQueryService = baseQueryService ?? null;
    this.roomRegistry = roomRegistry;
    this.vaultFileStore = vaultFileStore;
    this.workspaceStateAdapter = workspaceStateAdapter;
    this.managedPathMetadata = new Map();
    this.activeManagedWrites = new Set();
    this.activeWorkspaceMutations = 0;
    this.workspaceQueue = null;
    this.workspaceState = null;
    this.workspaceTree = [];
  }

  replaceWorkspaceState(nextState) {
    if (nextState) {
      for (const [path, expected] of this.managedPathMetadata) {
        if (samePathMetadata(expected, nextState.metadata.get(path))) this.managedPathMetadata.delete(path);
      }
    }
    this.workspaceState = nextState ?? null;
    this.workspaceTree = createWorkspaceTree(nextState?.entries ?? new Map());
    return this.workspaceState;
  }

  getWorkspaceTree() {
    return this.workspaceTree;
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

  runManagedWrite(paths = [], operation, expectedContent) {
    return this.trackManagedWrite(async () => {
      const result = await operation();
      await Promise.all(normalizePaths(paths).map(async (path) => {
        const state = await readWorkspacePathState(this.workspaceStateAdapter, path);
        if (expectedContent !== undefined && await this.vaultFileStore.readEditableVaultContent(path) !== expectedContent) {
          this.managedPathMetadata.delete(path);
          return;
        }
        this.managedPathMetadata.set(path, state?.metadata ?? null);
      }));
      return result;
    });
  }

  trackManagedWrite(operation) {
    const pending = Promise.resolve().then(operation);
    this.activeManagedWrites.add(pending);
    return pending.finally(() => this.activeManagedWrites.delete(pending));
  }

  async waitForManagedWrites() {
    while (this.activeManagedWrites.size > 0) {
      await Promise.allSettled(this.activeManagedWrites);
    }
  }

  runInWorkspaceOrder(operation) {
    const pending = this.workspaceQueue ? this.workspaceQueue.catch(() => {}).then(operation) : operation();
    this.workspaceQueue = pending;
    return pending.finally(() => {
      if (this.workspaceQueue === pending) this.workspaceQueue = null;
    });
  }

  runManagedWorkspaceMutation(operation) {
    return this.runInWorkspaceOrder(() => this.trackManagedWrite(async () => {
      this.activeWorkspaceMutations += 1;
      try {
        return await operation();
      } finally {
        this.activeWorkspaceMutations -= 1;
      }
    }));
  }

  isGloballySuppressed() {
    return this.activeWorkspaceMutations > 0;
  }

  filterManagedWorkspaceChange(workspaceChange = {}, nextState) {
    const matchesManagedPath = (path) => {
      const actual = nextState?.metadata.get(path);
      return (this.managedPathMetadata.has(path) && samePathMetadata(this.managedPathMetadata.get(path), actual))
        || Boolean(this.workspaceState && samePathMetadata(this.workspaceState.metadata.get(path), actual));
    };

    const filtered = createWorkspaceChange({
      changedPaths: (workspaceChange.changedPaths ?? []).filter((pathValue) => !matchesManagedPath(pathValue)),
      deletedPaths: (workspaceChange.deletedPaths ?? []).filter((pathValue) => !matchesManagedPath(pathValue)),
      renamedPaths: (workspaceChange.renamedPaths ?? []).filter((entry) => (
        entry?.oldPath
        && entry?.newPath
        && !(matchesManagedPath(entry.oldPath) && matchesManagedPath(entry.newPath))
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
    // Hydration reconciles snapshots with disk. Keep pending conflict drafts
    // and editor operation IDs when a filesystem observation arrives.
    if (origin !== 'filesystem') {
      await this.vaultFileStore.reconcileCollaborationSnapshots?.(normalizedChange);
    }
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

  async runMutation({
    action,
    buildChange,
    origin = 'api',
    pausePaths = null,
    perform,
    requestId = null,
    sourceRef = null,
  }) {
    const execute = async () => {
      const result = await perform();
      if (!result.ok) {
        return result;
      }

      await this.reconcileVaultChangeObservation({
        action,
        origin,
        requestId,
        sourceRef,
        workspaceChange: typeof buildChange === 'function' ? buildChange(result) : buildChange,
      });
      return result;
    };

    return this.runInWorkspaceOrder(() => (pausePaths ? this.runWithPersistencePaused(pausePaths, execute) : execute()));
  }

  writeEditableContent({ content, origin = 'api', path, requestId = null, sourceRef = null } = {}) {
    return this.runMutation({
      action: 'write-file',
      buildChange: createWorkspaceChange({ changedPaths: [path] }),
      origin,
      perform: () => this.vaultFileStore.writeEditableVaultContent(path, content),
      requestId,
      sourceRef,
    });
  }

  uploadAttachment({ content, mimeType, origin = 'api', originalFileName = '', requestId = null, sourceDocumentPath } = {}) {
    return this.runMutation({
      action: 'upload-attachment',
      buildChange: (result) => createWorkspaceChange({ changedPaths: [result.path] }),
      origin,
      perform: () => this.vaultFileStore.writeImageAttachmentForDocument(sourceDocumentPath, {
        content,
        mimeType,
        originalFileName,
      }),
      requestId,
    });
  }

  createFile({ content = '', origin = 'api', path, requestId = null, sourceRef = null } = {}) {
    return this.runMutation({
      action: 'create-file',
      buildChange: createWorkspaceChange({ changedPaths: [path] }),
      origin,
      perform: () => this.vaultFileStore.createFile(path, content),
      requestId,
      sourceRef,
    });
  }

  deleteFile({ origin = 'api', path, requestId = null } = {}) {
    const normalizedPath = normalizeMutationPath(path);
    return this.runMutation({
      action: 'delete-file',
      buildChange: createWorkspaceChange({ deletedPaths: [normalizedPath] }),
      origin,
      pausePaths: [normalizedPath],
      perform: () => this.vaultFileStore.deleteFile(normalizedPath),
      requestId,
    });
  }

  renameFile({ newPath, oldPath, origin = 'api', requestId = null } = {}) {
    const from = normalizeMutationPath(oldPath);
    const to = normalizeMutationPath(newPath);
    return this.runMutation({
      action: 'rename-file',
      buildChange: createWorkspaceChange({ renamedPaths: [{ oldPath: from, newPath: to }] }),
      origin,
      pausePaths: [from, to],
      perform: () => this.vaultFileStore.renameFile(from, to),
      requestId,
    });
  }

  createDirectory({ origin = 'api', path, requestId = null } = {}) {
    return this.runMutation({
      action: 'create-directory',
      buildChange: createWorkspaceChange({ changedPaths: [path] }),
      origin,
      perform: () => this.vaultFileStore.createDirectory(path),
      requestId,
    });
  }

  renameDirectory({ newPath, oldPath, origin = 'api', requestId = null } = {}) {
    const from = normalizeMutationPath(oldPath);
    const to = normalizeMutationPath(newPath);
    let workspaceChange;
    return this.runMutation({
      action: 'rename-directory',
      buildChange: () => workspaceChange,
      origin,
      pausePaths: [from, to],
      perform: async () => {
        workspaceChange = await this.createDirectoryRenameWorkspaceChange(from, to);
        return this.vaultFileStore.renameDirectory(from, to);
      },
      requestId,
    });
  }

  deleteDirectory({ origin = 'api', path, recursive = false, requestId = null } = {}) {
    const normalizedPath = normalizeMutationPath(path);
    let workspaceChange;
    return this.runMutation({
      action: 'delete-directory',
      buildChange: () => workspaceChange,
      origin,
      pausePaths: [normalizedPath],
      perform: async () => {
        workspaceChange = await this.createDirectoryDeleteWorkspaceChange(normalizedPath);
        return this.vaultFileStore.deleteDirectory(normalizedPath, { recursive });
      },
      requestId,
    });
  }

  runWithPersistencePaused(paths, operation) {
    return this.roomRegistry?.runWithPersistencePaused
      ? this.roomRegistry.runWithPersistencePaused(paths, operation)
      : operation();
  }
}
