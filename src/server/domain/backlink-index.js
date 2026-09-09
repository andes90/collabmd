/**
 * BacklinkIndex — an in-memory inverted index that tracks which files link
 * to which other files via [[wiki links]].
 *
 * Maintains two maps:
 *   forward: sourcePath → Set<targetPath>    (outgoing links from a file)
 *   reverse: targetPath → Set<sourcePath>    (incoming links to a file — backlinks)
 *
 * The index is built from the vault at startup, then kept in sync
 * incrementally whenever a file is persisted, created, deleted, or renamed.
 */

import { createWikiTargetIndex } from '../../domain/wiki-link-resolver.js';
import { isMarkdownFilePath } from '../../domain/file-kind.js';
import {
  collectMarkdownReferences,
  collectReferenceTargetKeysForFilePath,
  createReferenceTargetAliasMap,
} from './markdown-reference-extractor.js';
import { mapWithConcurrency } from '../shared/async-utils.js';

const BACKLINK_BUILD_CONCURRENCY = 8;

export class BacklinkIndex {
  constructor({
    rebuildDelayMs = 150,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
    vaultFileStore,
  }) {
    this.vaultFileStore = vaultFileStore;
    this.rebuildDelayMs = rebuildDelayMs;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    /** @type {Map<string, Set<string>>} sourcePath → set of resolved target paths */
    this.forward = new Map();
    /** @type {Map<string, Set<string>>} targetPath → set of source paths */
    this.reverse = new Map();
    /** @type {Map<string, Map<string, string[]>>} sourcePath → targetPath → contexts[] */
    this.contextsBySource = new Map();
    /** @type {Map<string, Set<string>>} sourcePath → normalized raw target keys */
    this.rawTargetKeysBySource = new Map();
    /** @type {Map<string, Set<string>>} normalized raw target key → source paths */
    this.rawTargetSources = new Map();
    /** @type {string[]} cached flat target file list for link resolution */
    this._fileList = [];
    /** @type {string[]} cached markdown source file list for content scans */
    this._sourceFileList = [];
    /** @type {Set<string>} file path membership set */
    this._fileSet = new Set();
    this._wikiTargetIndex = createWikiTargetIndex(this._fileList);
    this._built = false;
    this._requestedBuildVersion = 0;
    this._completedBuildVersion = 0;
    this._buildPromise = null;
    this._scheduledBuildTimer = null;
    this._scheduledBuildDeferred = null;
  }

  /**
   * Build the full index by scanning every markdown file in the vault.
   * Called once at server startup.
   */
  async build({ workspaceState = null } = {}) {
    this._requestedBuildVersion += 1;
    this._latestRequestedWorkspaceState = workspaceState;
    return this.flushScheduledBuild();
  }

  scheduleBuild({ delayMs = this.rebuildDelayMs, workspaceState } = {}) {
    this._requestedBuildVersion += 1;
    if (workspaceState !== undefined) {
      this._latestRequestedWorkspaceState = workspaceState;
    }
    if (!this._scheduledBuildDeferred) {
      this._scheduledBuildDeferred = Promise.withResolvers();
    }

    if (this._scheduledBuildTimer) {
      this.clearTimeoutFn(this._scheduledBuildTimer);
    }

    this._scheduledBuildTimer = this.setTimeoutFn(() => {
      this._scheduledBuildTimer = null;
      const deferred = this._scheduledBuildDeferred;
      this._scheduledBuildDeferred = null;
      this._ensureBuiltToRequestedVersion()
        .then(() => deferred?.resolve())
        .catch((error) => deferred?.reject(error));
    }, delayMs);
    this._scheduledBuildTimer.unref?.();

    return this._scheduledBuildDeferred.promise;
  }

  async flushScheduledBuild() {
    if (this._scheduledBuildTimer) {
      this.clearTimeoutFn(this._scheduledBuildTimer);
      this._scheduledBuildTimer = null;
    }

    const deferred = this._scheduledBuildDeferred;
    this._scheduledBuildDeferred = null;

    try {
      await this._ensureBuiltToRequestedVersion();
      deferred?.resolve();
    } catch (error) {
      deferred?.reject(error);
      throw error;
    }
  }

  async _ensureBuiltToRequestedVersion() {
    while (this._completedBuildVersion < this._requestedBuildVersion) {
      await this._runSingleBuild();
    }
  }

  async _runSingleBuild() {
    if (this._buildPromise) {
      return this._buildPromise;
    }

    const targetVersion = this._requestedBuildVersion;
    const workspaceState = this._latestRequestedWorkspaceState;
    this._buildPromise = (async () => {
      await this._performBuild(workspaceState);
      this._completedBuildVersion = Math.max(this._completedBuildVersion, targetVersion);
    })().finally(() => {
      this._buildPromise = null;
    });

    return this._buildPromise;
  }

  async _performBuild(workspaceState = null) {
    this.forward.clear();
    this.reverse.clear();
    this.contextsBySource.clear();
    this.rawTargetKeysBySource.clear();
    this.rawTargetSources.clear();

    const snapshot = workspaceState ?? await this._resolveWorkspaceState();
    this._fileList = Array.from(snapshot?.filePaths ?? snapshot?.markdownPaths ?? []);
    this._fileSet = new Set(this._fileList);
    this._sourceFileList = Array.from(
      snapshot?.markdownPaths
        ?? this._fileList.filter((filePath) => isMarkdownFilePath(filePath)),
    ).filter((filePath) => this._fileSet.has(filePath));
    this._refreshWikiTargetIndex();

    const fileContents = await mapWithConcurrency(
      this._sourceFileList,
      BACKLINK_BUILD_CONCURRENCY,
      async (filePath) => ({
        content: await this.vaultFileStore.readMarkdownFile(filePath),
        filePath,
      }),
    );

    for (const { content, filePath } of fileContents) {
      if (content !== null) {
        this._indexFile(filePath, content);
      }
    }

    this._built = true;
    console.log(`[backlinks] Index built: ${this._sourceFileList.length} markdown sources, ${this._fileList.length} targets, ${this.reverse.size} targets with backlinks`);
  }

  async _resolveWorkspaceState() {
    if (typeof this.vaultFileStore.scanWorkspaceState === 'function') {
      return this.vaultFileStore.scanWorkspaceState();
    }

    const tree = await this.vaultFileStore.tree();
    const filePaths = flattenTree(tree);
    return {
      filePaths,
      markdownPaths: filePaths.filter((filePath) => isMarkdownFilePath(filePath)),
    };
  }

  /**
   * Incrementally update the index when a file's content changes.
   * Call this after every persist / write.
   */
  updateFile(filePath, content, {
    refreshIndex = true,
    targetPathAliases = new Map(),
  } = {}) {
    // Remove old forward links for this file
    this._removeForwardLinks(filePath);

    if (!this._fileSet.has(filePath)) {
      this._fileSet.add(filePath);
      this._fileList.push(filePath);
      if (refreshIndex) {
        this._refreshWikiTargetIndex();
      }
    }

    if (!isMarkdownFilePath(filePath)) {
      return;
    }

    // Re-index with new content
    this._indexFile(filePath, content, { targetPathAliases });
  }

  /**
   * Handle file creation — add to file list and index its content.
   */
  onFileCreated(filePath, content = '', { refreshIndex = true } = {}) {
    let membershipChanged = false;
    if (!this._fileSet.has(filePath)) {
      this._fileSet.add(filePath);
      this._fileList.push(filePath);
      membershipChanged = true;
      if (refreshIndex) {
        this._refreshWikiTargetIndex();
      }
    }

    if (content && isMarkdownFilePath(filePath)) {
      this._indexFile(filePath, content);
    }

    return membershipChanged;
  }

  /**
   * Handle file deletion — remove from file list and all index entries.
   */
  onFileDeleted(filePath, { refreshIndex = true } = {}) {
    this._removeForwardLinks(filePath);
    let membershipChanged = false;
    if (this._fileSet.delete(filePath)) {
      this._fileList = this._fileList.filter((f) => f !== filePath);
      membershipChanged = true;
      if (refreshIndex) {
        this._refreshWikiTargetIndex();
      }
    }

    // Also remove this file as a reverse entry (no one can link to a deleted file)
    this.reverse.delete(filePath);
    return membershipChanged;
  }

  /**
   * Handle file rename — re-map all index entries from oldPath to newPath.
   */
  onFileRenamed(oldPath, newPath, { refreshIndex = true } = {}) {
    // Move cached contexts for the renamed source file.
    if (this.contextsBySource.has(oldPath)) {
      const sourceContexts = this.contextsBySource.get(oldPath);
      this.contextsBySource.delete(oldPath);
      this.contextsBySource.set(newPath, sourceContexts);
    }

    if (this.rawTargetKeysBySource.has(oldPath)) {
      const rawTargetKeys = this.rawTargetKeysBySource.get(oldPath);
      this.rawTargetKeysBySource.delete(oldPath);
      this.rawTargetKeysBySource.set(newPath, rawTargetKeys);
      rawTargetKeys.forEach((rawTargetKey) => {
        const sources = this.rawTargetSources.get(rawTargetKey);
        if (!sources) {
          return;
        }

        sources.delete(oldPath);
        sources.add(newPath);
      });
    }

    // Move forward links
    const oldForward = this.forward.get(oldPath);
    if (oldForward) {
      this.forward.delete(oldPath);
      this.forward.set(newPath, oldForward);

      // Update reverse entries: replace oldPath with newPath in all targets
      for (const targetPath of oldForward) {
        const sources = this.reverse.get(targetPath);
        if (sources) {
          sources.delete(oldPath);
          sources.add(newPath);
        }
      }
    }

    // Move reverse links (files that linked to oldPath now link to newPath)
    const oldReverse = this.reverse.get(oldPath);
    if (oldReverse) {
      this.reverse.delete(oldPath);
      const mergedReverse = this.reverse.has(newPath)
        ? new Set([...this.reverse.get(newPath), ...oldReverse])
        : oldReverse;
      this.reverse.set(newPath, mergedReverse);

      // Update forward entries: replace oldPath with newPath in all sources
      for (const sourcePath of oldReverse) {
        const targets = this.forward.get(sourcePath);
        if (targets) {
          targets.delete(oldPath);
          targets.add(newPath);
        }

        const sourceContexts = this.contextsBySource.get(sourcePath);
        if (sourceContexts?.has(oldPath)) {
          const previous = sourceContexts.get(newPath) ?? [];
          sourceContexts.set(newPath, [...previous, ...sourceContexts.get(oldPath)]);
          sourceContexts.delete(oldPath);
        }
      }
    }

    // Update file list
    let membershipChanged = false;
    if (this._fileSet.delete(oldPath)) {
      this._fileSet.add(newPath);
      this._fileList = this._fileList.map((f) => (f === oldPath ? newPath : f));
      membershipChanged = true;
      if (refreshIndex) {
        this._refreshWikiTargetIndex();
      }
    }

    return membershipChanged;
  }

  async applyWorkspaceChange(workspaceChange = {}, {
    previousState = null,
    nextState = null,
  } = {}) {
    const previousEntries = previousState?.entries ?? new Map();
    const nextEntries = nextState?.entries ?? new Map();
    const changedPaths = Array.from(new Set(workspaceChange.changedPaths ?? []));
    const { impactedSources, renameMap } = this._computeWorkspaceChangeMeta(workspaceChange, changedPaths, previousEntries, nextEntries);

    let refreshIndex = this._applyDeletedPaths(workspaceChange.deletedPaths);
    refreshIndex = this._applyRenamedPaths(workspaceChange.renamedPaths, refreshIndex);
    refreshIndex = await this._applyChangedPaths(changedPaths, previousEntries, nextEntries, refreshIndex);

    if (refreshIndex) {
      const sourcesToRefresh = this._collectRefreshSources(impactedSources, changedPaths, workspaceChange.renamedPaths, nextEntries);
      this._refreshWikiTargetIndex();
      await this._refreshImpactedSources(sourcesToRefresh, { nextEntries, renameMap });
    }
  }

  _computeWorkspaceChangeMeta(workspaceChange, changedPaths, previousEntries, nextEntries) {
    const createdPaths = changedPaths.filter((pathValue) => (
      nextEntries.has(pathValue) && !previousEntries.has(pathValue)
    ));
    const removedChangedPaths = changedPaths.filter((pathValue) => (
      !nextEntries.has(pathValue) && previousEntries.has(pathValue)
    ));
    const membershipAffectedPaths = [
      ...(workspaceChange.deletedPaths ?? []),
      ...removedChangedPaths,
      ...createdPaths,
      ...(workspaceChange.renamedPaths ?? []).flatMap((entry) => [entry?.oldPath, entry?.newPath]).filter(Boolean),
    ];
    const impactedSources = this._collectImpactedSourcesForMembershipChanges(membershipAffectedPaths);
    const renameMap = new Map(
      (workspaceChange.renamedPaths ?? [])
        .filter((entry) => entry?.oldPath && entry?.newPath)
        .map((entry) => [entry.oldPath, entry.newPath]),
    );
    return { impactedSources, renameMap };
  }

  _applyDeletedPaths(deletedPaths) {
    let refreshIndex = false;
    for (const pathValue of deletedPaths ?? []) {
      refreshIndex = this.onFileDeleted(pathValue, { refreshIndex: false }) || refreshIndex;
    }
    return refreshIndex;
  }

  _applyRenamedPaths(renamedPaths, refreshIndex) {
    for (const entry of renamedPaths ?? []) {
      if (!entry?.oldPath || !entry?.newPath) {
        continue;
      }
      refreshIndex = this.onFileRenamed(entry.oldPath, entry.newPath, { refreshIndex: false }) || refreshIndex;
    }
    return refreshIndex;
  }

  async _applyChangedPaths(changedPaths, previousEntries, nextEntries, refreshIndex) {
    for (const pathValue of changedPaths) {
      const existsNow = nextEntries.has(pathValue);
      const existedBefore = previousEntries.has(pathValue);
      if (!existsNow) {
        if (existedBefore) {
          refreshIndex = this.onFileDeleted(pathValue, { refreshIndex: false }) || refreshIndex;
        }
        continue;
      }

      if (!isMarkdownFilePath(pathValue)) {
        if (!existedBefore) {
          refreshIndex = this.onFileCreated(pathValue, '', { refreshIndex: false }) || refreshIndex;
        }
        continue;
      }

      const content = await this.vaultFileStore.readMarkdownFile(pathValue);
      if (content === null) {
        continue;
      }

      if (existedBefore) {
        this.updateFile(pathValue, content, { refreshIndex: false });
      } else {
        refreshIndex = this.onFileCreated(pathValue, content, { refreshIndex: false }) || refreshIndex;
      }
    }
    return refreshIndex;
  }

  _collectRefreshSources(impactedSources, changedPaths, renamedPaths, nextEntries) {
    const sourcesToRefresh = new Set(impactedSources);
    changedPaths.forEach((pathValue) => {
      if (nextEntries.has(pathValue) && isMarkdownFilePath(pathValue)) {
        sourcesToRefresh.add(pathValue);
      }
    });
    (renamedPaths ?? []).forEach((entry) => {
      if (entry?.newPath && isMarkdownFilePath(entry.newPath)) {
        sourcesToRefresh.add(entry.newPath);
      }
    });
    return sourcesToRefresh;
  }

  /**
   * Get all backlinks for a file, with context snippets.
   * Returns: [{ file: string, contexts: string[] }]
   */
  async getBacklinks(filePath) {
    await this.flushScheduledBuild();

    const sources = this.reverse.get(filePath);
    if (!sources || sources.size === 0) {
      return [];
    }

    const results = [];

    for (const sourcePath of sources) {
      const sourceContexts = this.contextsBySource.get(sourcePath);
      const relevantContexts = sourceContexts?.get(filePath) ?? [];

      if (relevantContexts.length > 0) {
        results.push({
          file: sourcePath,
          contexts: [...relevantContexts],
        });
      }
    }

    // Sort by filename for stable ordering
    results.sort((a, b) => a.file.localeCompare(b.file));
    return results;
  }

  /**
   * Get the count of backlinks for a file (cheap — no I/O).
   */
  getBacklinkCount(filePath) {
    return this.reverse.get(filePath)?.size ?? 0;
  }

  // --- Private methods ---

  _indexFile(filePath, content, { targetPathAliases = new Map() } = {}) {
    const resolvedTargets = new Set();
    const contextsByTarget = new Map();
    const rawTargetKeys = new Set();
    const references = collectMarkdownReferences(content, {
      sourceFilePath: filePath,
      targetPathAliases,
      wikiTargetIndex: this._wikiTargetIndex,
    });

    for (const reference of references) {
      if (reference.rawTargetKey) {
        rawTargetKeys.add(reference.rawTargetKey);
      }

      const resolved = reference.resolvedPath;
      if (!resolved || resolved === filePath) {
        continue;
      }

      resolvedTargets.add(resolved);

      if (!contextsByTarget.has(resolved)) {
        contextsByTarget.set(resolved, []);
      }
      contextsByTarget.get(resolved).push(reference.context);
    }

    this.contextsBySource.delete(filePath);
    this._removeRawTargetSourceContributions(filePath);

    if (rawTargetKeys.size > 0) {
      this.rawTargetKeysBySource.set(filePath, rawTargetKeys);
      rawTargetKeys.forEach((rawTargetKey) => {
        if (!this.rawTargetSources.has(rawTargetKey)) {
          this.rawTargetSources.set(rawTargetKey, new Set());
        }
        this.rawTargetSources.get(rawTargetKey).add(filePath);
      });
    }

    if (resolvedTargets.size > 0) {
      this.contextsBySource.set(filePath, contextsByTarget);
      this.forward.set(filePath, resolvedTargets);

      for (const targetPath of resolvedTargets) {
        if (!this.reverse.has(targetPath)) {
          this.reverse.set(targetPath, new Set());
        }
        this.reverse.get(targetPath).add(filePath);
      }
    }
  }

  _removeForwardLinks(filePath) {
    this.contextsBySource.delete(filePath);
    this._removeRawTargetSourceContributions(filePath);

    const oldTargets = this.forward.get(filePath);
    if (!oldTargets) return;

    for (const targetPath of oldTargets) {
      const sources = this.reverse.get(targetPath);
      if (sources) {
        sources.delete(filePath);
        if (sources.size === 0) {
          this.reverse.delete(targetPath);
        }
      }
    }

    this.forward.delete(filePath);
  }

  _refreshWikiTargetIndex() {
    this._wikiTargetIndex = createWikiTargetIndex(this._fileList);
  }

  _removeRawTargetSourceContributions(filePath) {
    const rawTargetKeys = this.rawTargetKeysBySource.get(filePath);
    if (!rawTargetKeys) {
      return;
    }

    rawTargetKeys.forEach((rawTargetKey) => {
      const sources = this.rawTargetSources.get(rawTargetKey);
      if (!sources) {
        return;
      }

      sources.delete(filePath);
      if (sources.size === 0) {
        this.rawTargetSources.delete(rawTargetKey);
      }
    });
    this.rawTargetKeysBySource.delete(filePath);
  }

  _collectImpactedSourcesForMembershipChanges(pathValues = []) {
    const affectedTargetKeys = new Set();
    pathValues.forEach((pathValue) => {
      collectReferenceTargetKeysForFilePath(pathValue).forEach((targetKey) => {
        affectedTargetKeys.add(targetKey);
      });
    });

    const impactedSources = new Set();
    affectedTargetKeys.forEach((targetKey) => {
      this.rawTargetSources.get(targetKey)?.forEach((sourcePath) => {
        impactedSources.add(sourcePath);
      });
    });
    return impactedSources;
  }

  async _refreshImpactedSources(impactedSources = new Set(), {
    nextEntries = new Map(),
    renameMap = new Map(),
  } = {}) {
    const refreshedSources = new Set();
    const targetPathAliases = createReferenceTargetAliasMap(Array.from(renameMap.entries()));

    for (const sourcePath of impactedSources) {
      const livePath = renameMap.get(sourcePath) ?? sourcePath;
      if (
        refreshedSources.has(livePath)
        || !livePath
        || !isMarkdownFilePath(livePath)
        || !nextEntries.has(livePath)
      ) {
        continue;
      }

      const content = await this.vaultFileStore.readMarkdownFile(livePath);
      if (content === null) {
        continue;
      }

      refreshedSources.add(livePath);
      this.updateFile(livePath, content, { refreshIndex: false, targetPathAliases });
    }
  }
}

/** Flatten a vault tree into an array of file paths. */
function flattenTree(nodes) {
  const files = [];
  for (const node of nodes) {
    if (node.type && node.type !== 'directory') {
      files.push(node.path);
    } else if (node.children) {
      files.push(...flattenTree(node.children));
    }
  }
  return files;
}
