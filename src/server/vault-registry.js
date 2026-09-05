import { basename } from 'node:path';

import { logPerfEvent } from './config/perf-logging.js';
import { BacklinkIndex } from './domain/backlink-index.js';
import { BaseQueryService } from './domain/bases/base-query-service.js';
import { CollaborationDocumentStore } from './domain/collaboration/collaboration-document-store.js';
import { CollaborationRoom } from './domain/collaboration/collaboration-room.js';
import { RoomRegistry } from './domain/collaboration/room-registry.js';
import { isDrawioLeaseRoom } from '../domain/drawio-room.js';
import { WORKSPACE_ROOM_NAME } from '../domain/workspace-room.js';
import { workspaceStateMetadataEqual } from './domain/workspace-state.js';
import { GitService } from './infrastructure/git/git-service.js';
import { ensureCollabMetadataGitExclude } from './infrastructure/git/local-exclude.js';
import { RipgrepSearchService } from './domain/ripgrep-search-service.js';
import { VaultFileStore } from './infrastructure/persistence/vault-file-store.js';
import { FileSystemSyncService } from './infrastructure/workspace/file-system-sync-service.js';
import { WorkspaceReconciliation } from './application/workspace-reconciliation.js';
import { createWorkspaceStateFileSystemAdapter } from './infrastructure/workspace/workspace-state-file-system-adapter.js';

function buildVaultContext(def, { config, testControls }) {
  const vaultFileStore = new VaultFileStore({ vaultDir: def.dir });
  const backlinkIndex = new BacklinkIndex({ vaultFileStore });
  const context = {
    backlinkIndex,
    baseQueryService: null,
    def,
    fileSystemSyncService: null,
    gitService: null,
    roomRegistry: null,
    searchService: null,
    vaultFileCount: 0,
    vaultFileStore,
    workspaceMutationCoordinator: null,
  };
  const baseQueryService = new BaseQueryService({
    maxResultRows: config.maxBaseQueryRows,
    vaultFileStore,
    workspaceStateProvider: () => context.workspaceMutationCoordinator?.workspaceState ?? null,
    workspaceStateSynchronizer: () => context.fileSystemSyncService?.flushPendingChanges?.(),
  });
  const gitService = new GitService({
    commandEnv: config.git?.commandEnv,
    enabled: config.gitEnabled,
    vaultDir: def.dir,
  });
  const searchService = new RipgrepSearchService({
    maxBufferBytes: config.searchMaxBufferBytes,
    maxFileSize: config.searchMaxFileSize,
    perfLoggingEnabled: config.perfLoggingEnabled,
    vaultDir: def.dir,
  });
  const roomRegistry = new RoomRegistry({
    createRoom: ({ name, onEmpty }) => {
      const isTransientRoom = name === '__lobby__' || name === WORKSPACE_ROOM_NAME || isDrawioLeaseRoom(name);
      const room = new CollaborationRoom({
        documentStore: new CollaborationDocumentStore({
          backlinkIndex: isTransientRoom ? null : backlinkIndex,
          name,
          vaultFileStore: isTransientRoom ? null : vaultFileStore,
        }),
        getHydrateDelayMs: () => testControls.wsRoomHydrateDelayMs,
        idleGraceMs: config.wsRoomIdleGraceMs,
        maxInitialSyncBytes: config.maxInitialSyncBytes,
        maxBufferedAmountBytes: config.wsMaxBufferedAmountBytes,
        name,
        onEmpty,
        perfLoggingEnabled: config.perfLoggingEnabled,
      });

      if (name === WORKSPACE_ROOM_NAME && context.workspaceMutationCoordinator?.workspaceState) {
        room.replaceWorkspaceEntries(context.workspaceMutationCoordinator.workspaceState.entries, {
          generatedAt: context.workspaceMutationCoordinator.workspaceState.scannedAt,
        });
      }

      return room;
    },
  });
  const workspaceMutationCoordinator = new WorkspaceReconciliation({
    backlinkIndex,
    baseQueryService,
    roomRegistry,
    vaultFileStore,
    workspaceStateAdapter: createWorkspaceStateFileSystemAdapter({
      vaultDir: vaultFileStore.vaultDir,
    }),
  });
  const fileSystemSyncService = new FileSystemSyncService({
    mutationCoordinator: workspaceMutationCoordinator,
    perfLoggingEnabled: config.perfLoggingEnabled,
    vaultFileStore,
  });
  vaultFileStore.setManagedWriteTracker(workspaceMutationCoordinator);

  context.baseQueryService = baseQueryService;
  context.gitService = gitService;
  context.searchService = searchService;
  context.roomRegistry = roomRegistry;
  context.workspaceMutationCoordinator = workspaceMutationCoordinator;
  context.fileSystemSyncService = fileSystemSyncService;
  return context;
}

async function initializeVaultContext(context, { config }) {
  const { def } = context;
  if (await context.gitService.isGitRepo()) {
    await ensureCollabMetadataGitExclude(def.dir);
  }

  const searchCapabilityStartedAt = Date.now();
  const searchCapability = await context.searchService.initialize();
  logPerfEvent(config.perfLoggingEnabled, 'startup', {
    available: searchCapability.available,
    durationMs: Date.now() - searchCapabilityStartedAt,
    phase: 'search-capability',
    vault: def.id,
  });

  const initialWorkspaceScanStartedAt = Date.now();
  const initialWorkspaceSnapshot = await context.vaultFileStore.scanWorkspaceState();
  context.vaultFileCount = initialWorkspaceSnapshot.vaultFileCount ?? 0;
  logPerfEvent(config.perfLoggingEnabled, 'startup', {
    durationMs: Date.now() - initialWorkspaceScanStartedAt,
    phase: 'workspace-scan',
    vault: def.id,
    vaultFileCount: context.vaultFileCount,
  });

  const backlinkBuildStartedAt = Date.now();
  await context.backlinkIndex.build({ workspaceState: initialWorkspaceSnapshot });
  logPerfEvent(config.perfLoggingEnabled, 'startup', {
    durationMs: Date.now() - backlinkBuildStartedAt,
    markdownFileCount: initialWorkspaceSnapshot.markdownPaths?.length ?? 0,
    phase: 'backlink-build',
    vault: def.id,
  });

  const liveWorkspaceScanStartedAt = Date.now();
  const liveWorkspaceSnapshot = await context.vaultFileStore.scanWorkspaceState();
  const workspaceChangedDuringStartup = !workspaceStateMetadataEqual(initialWorkspaceSnapshot, liveWorkspaceSnapshot);
  context.vaultFileCount = liveWorkspaceSnapshot.vaultFileCount ?? context.vaultFileCount;
  logPerfEvent(config.perfLoggingEnabled, 'startup', {
    changedDuringStartup: workspaceChangedDuringStartup,
    durationMs: Date.now() - liveWorkspaceScanStartedAt,
    phase: 'workspace-rescan',
    vault: def.id,
    vaultFileCount: context.vaultFileCount,
  });

  if (workspaceChangedDuringStartup) {
    const backlinkRebuildStartedAt = Date.now();
    await context.backlinkIndex.build({ workspaceState: liveWorkspaceSnapshot });
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: Date.now() - backlinkRebuildStartedAt,
      markdownFileCount: liveWorkspaceSnapshot.markdownPaths?.length ?? 0,
      phase: 'backlink-rebuild',
      vault: def.id,
    });
  }

  const workspaceInitStartedAt = Date.now();
  await context.workspaceMutationCoordinator.initialize({ snapshot: liveWorkspaceSnapshot });
  logPerfEvent(config.perfLoggingEnabled, 'startup', {
    durationMs: Date.now() - workspaceInitStartedAt,
    phase: 'workspace-init',
    vault: def.id,
  });

  if (config.fileWatcherEnabled !== false) {
    const watcherStartStartedAt = Date.now();
    await context.fileSystemSyncService.start({ snapshot: liveWorkspaceSnapshot });
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: Date.now() - watcherStartStartedAt,
      phase: 'watcher-start',
      vault: def.id,
    });
  } else {
    context.fileSystemSyncService.initializeFromSnapshot({ snapshot: liveWorkspaceSnapshot });
    logPerfEvent(config.perfLoggingEnabled, 'startup', {
      durationMs: 0,
      phase: 'watcher-skipped',
      vault: def.id,
    });
  }

  return { searchCapability, snapshot: liveWorkspaceSnapshot, vaultFileCount: context.vaultFileCount };
}

export function createVaultRegistry({ config, testControls }) {
  const defs = config.vaults?.length
    ? config.vaults
    : [{ dir: config.vaultDir, id: basename(config.vaultDir) }];
  const knownIds = new Set(defs.map((def) => def.id));
  const contexts = new Map();
  const initPromises = new Map();

  function getOrBuild(def) {
    let context = contexts.get(def.id);
    if (!context) {
      context = buildVaultContext(def, { config, testControls });
      contexts.set(def.id, context);
    }
    return context;
  }
  // ponytail: primary builds eagerly like the old singleton; the rest stay lazy
  const primaryDef = defs[0];
  getOrBuild(primaryDef);

  function initializeAsync(context) {
    let pending = initPromises.get(context.def.id);
    if (!pending) {
      pending = initializeVaultContext(context, { config }).catch((error) => {
        initPromises.delete(context.def.id);
        throw error;
      });
      initPromises.set(context.def.id, pending);
    }
    return pending;
  }

  return {
    isKnownVaultId(vaultId) {
      return knownIds.has(vaultId);
    },
    getPrimaryContext() {
      return contexts.get(primaryDef.id);
    },
    async initializePrimary() {
      return initializeAsync(contexts.get(primaryDef.id));
    },
    async getOrCreateContextAsync(vaultId) {
      const def = defs.find((entry) => entry.id === vaultId) ?? null;
      if (!def) {
        const error = new Error(`Unknown vault "${vaultId}".`);
        error.statusCode = 404;
        throw error;
      }
      const context = getOrBuild(def);
      await initializeAsync(context);
      return context;
    },
    async closeAll() {
      initPromises.clear();
      await Promise.all(Array.from(contexts.values()).map(async (context) => {
        await context.fileSystemSyncService?.close?.();
        await context.roomRegistry?.reset?.();
      }));
      contexts.clear();
    },
  };
}
