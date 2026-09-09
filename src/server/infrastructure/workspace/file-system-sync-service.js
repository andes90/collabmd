import { watch } from 'node:fs';
import { basename } from 'node:path';

import { logPerfEvent } from '../../config/perf-logging.js';
import { hasWorkspaceMutation } from '../../../domain/workspace-change.js';
import {
  deriveIncrementalWorkspaceState,
  detectWorkspaceStateChange,
  readWorkspacePathSnapshot as readWorkspacePathSnapshotFromAdapter,
} from '../../domain/workspace-state.js';
import { isIgnoredVaultEntry } from '../persistence/path-utils.js';
import { createWorkspaceStateFileSystemAdapter } from './workspace-state-file-system-adapter.js';

const MAX_INCREMENTAL_PENDING_PATHS = 64;

function normalizeWatchedPath(filename) {
  if (typeof filename !== 'string' && !Buffer.isBuffer(filename)) {
    return '';
  }

  const normalized = String(filename).trim().replace(/\\/g, '/').replace(/^\.\/+/, '');
  if (!normalized || normalized === '.') {
    return '';
  }

  return normalized
    .split('/')
    .filter(Boolean)
    .join('/');
}

function isIgnoredWatchedPath(pathValue) {
  if (!pathValue) {
    return true;
  }

  const segments = String(pathValue).split('/').filter(Boolean);
  if (segments.length === 0) {
    return true;
  }

  if (segments.some((segment) => isIgnoredVaultEntry(segment))) {
    return true;
  }

  return basename(pathValue).includes('.collabmd-');
}

export class FileSystemSyncService {
  constructor({
    debounceMs = 180,
    mutationCoordinator,
    perfLoggingEnabled = false,
    vaultFileStore,
  }) {
    this.debounceMs = debounceMs;
    this.mutationCoordinator = mutationCoordinator;
    this.perfLoggingEnabled = perfLoggingEnabled;
    this.vaultFileStore = vaultFileStore;
    this.workspaceStateAdapter = createWorkspaceStateFileSystemAdapter({
      vaultDir: vaultFileStore?.vaultDir,
    });
    this.watcher = null;
    this.debounceTimer = null;
    this.runningFlush = null;
    this.lastState = null;
    this.pendingEventTypesByPath = new Map();
    this.forceFullScan = false;
    this.suspendWatchEventsUntil = 0;
  }

  async start({ snapshot = null } = {}) {
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
    this.watcher = watch(this.vaultFileStore.vaultDir, { recursive: true }, (eventType, filename) => {
      this.handleWatchEvent(eventType, filename);
    });
  }

  initializeFromSnapshot({ snapshot = null } = {}) {
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? null;
  }

  handleWatchEvent(eventType, filename) {
    if (Date.now() <= this.suspendWatchEventsUntil) {
      return;
    }

    const normalizedPath = normalizeWatchedPath(filename);
    if (!normalizedPath) {
      this.forceFullScan = true;
      this.scheduleFlush();
      return;
    }

    if (isIgnoredWatchedPath(normalizedPath)) {
      return;
    }

    const bucket = this.pendingEventTypesByPath.get(normalizedPath) ?? new Set();
    bucket.add(String(eventType || 'change'));
    this.pendingEventTypesByPath.set(normalizedPath, bucket);

    if (this.pendingEventTypesByPath.size > MAX_INCREMENTAL_PENDING_PATHS) {
      this.forceFullScan = true;
    }

    this.scheduleFlush();
  }

  scheduleFlush() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = setTimeout(() => {
      this.debounceTimer = null;
      this.runningFlush = this.flush().finally(() => {
        this.runningFlush = null;
      });
    }, this.debounceMs);
    this.debounceTimer.unref?.();
  }

  async resetForExternalStateChange({ snapshot = null } = {}) {
    this.suspendWatchEventsUntil = Math.max(this.suspendWatchEventsUntil, Date.now() + 750);
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;

    try {
      await this.runningFlush;
    } catch {
      // Ignore stale flush failures while rebaselining around an external reset.
    }

    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    this.lastState = snapshot ?? this.mutationCoordinator.workspaceState ?? await this.vaultFileStore.scanWorkspaceState();
  }

  async flushPendingChanges() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;

    if (this.runningFlush) {
      await this.runningFlush;
      return;
    }

    if (this.pendingEventTypesByPath.size === 0 && !this.forceFullScan) {
      return;
    }

    this.runningFlush = this.flush().finally(() => {
      this.runningFlush = null;
    });
    await this.runningFlush;
  }

  async readWorkspacePathSnapshot(pathValue) {
    return readWorkspacePathSnapshotFromAdapter(this.workspaceStateAdapter, pathValue);
  }

  async buildIncrementalResult() {
    return deriveIncrementalWorkspaceState(this.workspaceStateAdapter, {
      forceFullScan: this.forceFullScan,
      maxPendingPaths: MAX_INCREMENTAL_PENDING_PATHS,
      pendingPaths: Array.from(this.pendingEventTypesByPath.keys()),
      previousState: this.lastState,
      readPathSnapshot: (pathValue) => this.readWorkspacePathSnapshot(pathValue),
    });
  }

  consumePendingEvents() {
    const hadPendingEvents = this.pendingEventTypesByPath.size > 0 || this.forceFullScan;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    return hadPendingEvents;
  }

  async flush() {
    const startedAt = Date.now();
    const pendingPathCount = this.pendingEventTypesByPath.size;
    const { fallbackReason, incrementalResult } = await this.buildIncrementalResult();
    this.consumePendingEvents();

    const previousWorkspaceState = this.mutationCoordinator.workspaceState;
    const authoritativePreviousState = previousWorkspaceState ?? this.lastState;
    let effectiveMode = incrementalResult ? 'incremental' : 'full-scan';
    let effectiveFallbackReason = fallbackReason;
    let nextState = incrementalResult?.nextState ?? await this.vaultFileStore.scanWorkspaceState();
    let workspaceChange = incrementalResult?.workspaceChange ?? detectWorkspaceStateChange(this.lastState, nextState);
    this.lastState = nextState;

    let filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
    if (!filteredChange) {
      const authoritativeChange = detectWorkspaceStateChange(authoritativePreviousState, nextState);
      // A full scan already reflects current disk state (no awaits since),
      // so only rebase when the first pass was incremental and may be stale.
      if (incrementalResult && hasWorkspaceMutation(authoritativeChange)) {
        nextState = await this.vaultFileStore.scanWorkspaceState();
        workspaceChange = detectWorkspaceStateChange(authoritativePreviousState, nextState);
        this.lastState = nextState;
        filteredChange = this.mutationCoordinator.filterManagedWorkspaceChange(workspaceChange);
        effectiveMode = 'full-scan';
        effectiveFallbackReason = effectiveFallbackReason || 'authoritative-rebase';
      }
    }

    if (!filteredChange) {
      if (this.mutationCoordinator.isGloballySuppressed?.() || hasWorkspaceMutation(workspaceChange)) {
        this.mutationCoordinator.syncWorkspaceEntries(nextState, {
          previousState: previousWorkspaceState,
        });
        this.mutationCoordinator.replaceWorkspaceState(nextState);
      }

      logPerfEvent(this.perfLoggingEnabled, 'filesystem-sync', {
        changedPathCount: workspaceChange.changedPaths?.length ?? 0,
        deletedPathCount: workspaceChange.deletedPaths?.length ?? 0,
        durationMs: Date.now() - startedAt,
        fallbackReason: effectiveFallbackReason,
        mode: effectiveMode,
        pendingPathCount,
        renamedPathCount: workspaceChange.renamedPaths?.length ?? 0,
      });
      return;
    }

    await this.mutationCoordinator.apply({
      action: 'filesystem-sync',
      origin: 'filesystem',
      nextState,
      workspaceChange: filteredChange,
    });
    logPerfEvent(this.perfLoggingEnabled, 'filesystem-sync', {
      changedPathCount: filteredChange.changedPaths?.length ?? 0,
      deletedPathCount: filteredChange.deletedPaths?.length ?? 0,
      durationMs: Date.now() - startedAt,
      fallbackReason: effectiveFallbackReason,
      mode: effectiveMode,
      pendingPathCount,
      renamedPathCount: filteredChange.renamedPaths?.length ?? 0,
    });
  }

  async close() {
    clearTimeout(this.debounceTimer);
    this.debounceTimer = null;
    this.pendingEventTypesByPath.clear();
    this.forceFullScan = false;
    if (this.watcher) {
      this.watcher.close();
      this.watcher = null;
    }
    await this.runningFlush;
  }
}
