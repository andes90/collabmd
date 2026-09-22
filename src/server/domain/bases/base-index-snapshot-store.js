import { basename, dirname, extname } from 'node:path';

import { createWikiTargetIndex } from '../../../domain/wiki-link-resolver.js';
import {
  isMarkdownFilePath,
  stripVaultFileExtension,
} from '../../../domain/file-kind.js';
import { extractYamlFrontmatter } from '../../../domain/yaml-frontmatter.js';
import {
  collectMarkdownReferences,
  collectReferenceTargetKeysForFilePath,
  createReferenceTargetAliasMap,
} from '../markdown-reference-extractor.js';
import { mapWithConcurrency } from '../../shared/async-utils.js';
import { isPlainObject } from './base-definition.js';
import { createLinkValue, dedupeLinkValues } from './base-expression-runtime.js';

const INLINE_TAG_RE = /(^|[\s(])#([A-Za-z0-9/_-]+)/g;
const INDEX_READ_CONCURRENCY = 8;

function cloneSnapshotRowRecord(rowRecord) {
  return {
    forwardLinks: new Set(rowRecord.forwardLinks ?? []),
    rawTargetKeys: new Set(rowRecord.rawTargetKeys ?? []),
    row: structuredClone(rowRecord.row),
  };
}

function createRowMetadataSignature(filePath, workspaceState) {
  const metadata = workspaceState?.metadata?.get(filePath) ?? null;
  return [
    Number.isFinite(metadata?.mtimeMs) ? metadata.mtimeMs : '',
    Number.isFinite(metadata?.size) ? metadata.size : '',
  ].join('\0');
}

function normalizeTags(value) {
  if (Array.isArray(value)) {
    return value
      .map((entry) => String(entry ?? '').trim().replace(/^#/u, ''))
      .filter(Boolean);
  }

  const normalized = String(value ?? '').trim().replace(/^#/u, '');
  return normalized ? [normalized] : [];
}

function extractInlineTags(markdownText = '') {
  const tags = new Set();
  let match;
  while ((match = INLINE_TAG_RE.exec(String(markdownText ?? ''))) !== null) {
    tags.add(match[2]);
  }
  return [...tags];
}

function compareVaultPaths(left = '', right = '') {
  return String(left).localeCompare(String(right), undefined, { sensitivity: 'base' });
}

function extractReferences(markdownText = '', {
  sourceFilePath = '',
  targetPathAliases = new Map(),
  wikiTargetIndex,
} = {}) {
  const links = [];
  const embeds = [];
  const rawTargetKeys = new Set();
  const references = collectMarkdownReferences(markdownText, {
    sourceFilePath,
    targetPathAliases,
    wikiTargetIndex,
  });

  references.forEach((reference) => {
    const linkValue = createLinkValue(reference.resolvedPath || reference.targetPath || reference.rawTarget, {
      exists: Boolean(reference.resolvedPath),
      rawTarget: reference.rawTarget,
    });
    links.push(linkValue);
    if (reference.isEmbed) {
      embeds.push(linkValue);
    }
    if (reference.rawTargetKey) {
      rawTargetKeys.add(reference.rawTargetKey);
    }
  });

  return { embeds, links, rawTargetKeys };
}

function isWorkspaceFileEntry(entry = null) {
  return Boolean(entry) && (entry.nodeType === 'file' || entry.type !== 'directory');
}

function listWorkspaceFilePaths(workspaceState = {}) {
  if (Array.isArray(workspaceState?.filePaths)) {
    return [...workspaceState.filePaths].sort(compareVaultPaths);
  }

  return Array.from(workspaceState?.entries?.values?.() ?? [])
    .filter((entry) => isWorkspaceFileEntry(entry))
    .map((entry) => entry.path)
    .sort(compareVaultPaths);
}

function createBacklinkEntry(sourcePath = '') {
  return createLinkValue(sourcePath, {
    display: basename(sourcePath),
    exists: true,
  });
}

function addRawTargetSourceContribution(snapshot, sourcePath, rawTargetKey) {
  if (!rawTargetKey) {
    return;
  }

  const sources = snapshot.rawTargetSourcesByKey.get(rawTargetKey) ?? new Set();
  sources.add(sourcePath);
  snapshot.rawTargetSourcesByKey.set(rawTargetKey, sources);
}

export class BaseIndexSnapshotStore {
  constructor({
    vaultFileStore,
    workspaceStateProvider = null,
    workspaceStateSynchronizer = null,
  }) {
    this.vaultFileStore = vaultFileStore;
    this.workspaceStateProvider = workspaceStateProvider;
    this.workspaceStateSynchronizer = workspaceStateSynchronizer;
    this.indexSnapshot = null;
    this.lastWorkspaceState = null;
    this.rowRecordCache = new Map();
    this.rowRecordCacheFileSetSignature = '';
    this.rowRecordCacheGeneration = 0;
  }

  async getWorkspaceState() {
    const workspaceState = await this.workspaceStateProvider?.();
    if (workspaceState) {
      this.lastWorkspaceState = workspaceState;
      return workspaceState;
    }

    if (this.lastWorkspaceState) {
      return this.lastWorkspaceState;
    }

    const scannedWorkspaceState = await this.vaultFileStore.scanWorkspaceState();
    this.lastWorkspaceState = scannedWorkspaceState;
    return scannedWorkspaceState;
  }

  createSnapshotRow(filePath, workspaceState, wikiTargetIndex, markdownContent = null, {
    targetPathAliases = new Map(),
  } = {}) {
    const metadata = workspaceState.metadata.get(filePath) ?? null;
    const frontmatter = markdownContent ? extractYamlFrontmatter(markdownContent) : null;
    const noteProperties = isPlainObject(frontmatter?.data) ? frontmatter.data : {};
    const bodyMarkdown = frontmatter?.bodyMarkdown ?? markdownContent ?? '';
    const references = extractReferences(bodyMarkdown, {
      sourceFilePath: filePath,
      targetPathAliases,
      wikiTargetIndex,
    });
    const tags = [...new Set([
      ...normalizeTags(noteProperties.tags),
      ...extractInlineTags(bodyMarkdown),
    ])];
    const fileValue = {
      __baseType: 'file',
      backlinks: [],
      basename: stripVaultFileExtension(basename(filePath)),
      ctime: Number.isFinite(metadata?.ctimeMs) ? new Date(metadata.ctimeMs) : null,
      embeds: references.embeds,
      ext: extname(filePath).replace(/^\./u, ''),
      folder: dirname(filePath) === '.' ? '' : dirname(filePath).replace(/\\/g, '/'),
      links: references.links,
      mtime: Number.isFinite(metadata?.mtimeMs) ? new Date(metadata.mtimeMs) : null,
      name: basename(filePath),
      path: filePath,
      properties: noteProperties,
      size: Number(metadata?.size ?? 0) || 0,
      tags,
    };

    return {
      forwardLinks: new Set(
        references.links
          .map((link) => link?.path)
          .filter((targetPath) => targetPath && targetPath !== filePath),
      ),
      rawTargetKeys: references.rawTargetKeys,
      row: {
        file: fileValue,
        noteProperties,
        path: filePath,
      },
    };
  }

  rebuildBacklinks(snapshot) {
    snapshot.backlinkSourcesByTarget = new Map();
    snapshot.backlinksByPath = new Map(snapshot.filePaths.map((filePath) => [filePath, []]));

    snapshot.rowsByPath.forEach((row, filePath) => {
      const forwardLinks = snapshot.forwardLinksByPath.get(filePath) ?? new Set();
      forwardLinks.forEach((targetPath) => {
        if (!snapshot.rowsByPath.has(targetPath) || targetPath === row.file.path) {
          return;
        }

        const sources = snapshot.backlinkSourcesByTarget.get(targetPath) ?? new Set();
        sources.add(filePath);
        snapshot.backlinkSourcesByTarget.set(targetPath, sources);
      });
    });

    this.refreshSerializedBacklinks(snapshot, snapshot.filePaths);
  }

  removeSourceBacklinkContributions(snapshot, sourcePath, affectedTargetPaths = new Set()) {
    const forwardLinks = snapshot.forwardLinksByPath.get(sourcePath) ?? new Set();
    forwardLinks.forEach((targetPath) => {
      const sources = snapshot.backlinkSourcesByTarget.get(targetPath);
      if (!sources) {
        return;
      }

      sources.delete(sourcePath);
      if (sources.size === 0) {
        snapshot.backlinkSourcesByTarget.delete(targetPath);
      }
      affectedTargetPaths.add(targetPath);
    });
  }

  removeRawTargetSourceContributions(snapshot, sourcePath) {
    const rawTargetKeys = snapshot.rawTargetKeysBySourcePath.get(sourcePath) ?? new Set();
    rawTargetKeys.forEach((rawTargetKey) => {
      const sources = snapshot.rawTargetSourcesByKey.get(rawTargetKey);
      if (!sources) {
        return;
      }

      sources.delete(sourcePath);
      if (sources.size === 0) {
        snapshot.rawTargetSourcesByKey.delete(rawTargetKey);
      }
    });
    snapshot.rawTargetKeysBySourcePath.delete(sourcePath);
  }

  addRawTargetSourceContributions(snapshot, sourcePath, rawTargetKeys = new Set()) {
    snapshot.rawTargetKeysBySourcePath.set(sourcePath, rawTargetKeys);
    rawTargetKeys.forEach((rawTargetKey) => {
      addRawTargetSourceContribution(snapshot, sourcePath, rawTargetKey);
    });
  }

  addSourceBacklinkContributions(snapshot, sourcePath, affectedTargetPaths = new Set()) {
    if (!snapshot.rowsByPath.has(sourcePath)) {
      return;
    }

    const forwardLinks = snapshot.forwardLinksByPath.get(sourcePath) ?? new Set();
    forwardLinks.forEach((targetPath) => {
      if (!snapshot.rowsByPath.has(targetPath) || targetPath === sourcePath) {
        return;
      }

      const sources = snapshot.backlinkSourcesByTarget.get(targetPath) ?? new Set();
      sources.add(sourcePath);
      snapshot.backlinkSourcesByTarget.set(targetPath, sources);
      affectedTargetPaths.add(targetPath);
    });
  }

  refreshSerializedBacklinks(snapshot, targetPaths = []) {
    Array.from(new Set(targetPaths)).forEach((targetPath) => {
      if (!snapshot.rowsByPath.has(targetPath)) {
        snapshot.backlinkSourcesByTarget.delete(targetPath);
        snapshot.backlinksByPath.delete(targetPath);
        return;
      }

      const sources = snapshot.backlinkSourcesByTarget.get(targetPath) ?? new Set();
      const backlinks = dedupeLinkValues(
        Array.from(sources, (sourcePath) => createBacklinkEntry(sourcePath)),
      );
      snapshot.backlinksByPath.set(targetPath, backlinks);
      const row = snapshot.rowsByPath.get(targetPath);
      if (row?.file) {
        row.file.backlinks = backlinks;
      }
    });
  }

  async buildIndexSnapshot(workspaceState = null) {
    const resolvedWorkspaceState = workspaceState ?? await this.getWorkspaceState();
    const fileEntries = listWorkspaceFilePaths(resolvedWorkspaceState);
    const cacheGeneration = this.prepareRowRecordCache(fileEntries);
    const wikiTargetIndex = createWikiTargetIndex(fileEntries);
    const markdownContents = new Map();
    // Keep reused rows available if another build replaces the shared cache during I/O.
    const cachedRowRecords = new Map(fileEntries.map((filePath) => [
      filePath, this.getCachedRowRecord(filePath, resolvedWorkspaceState, cacheGeneration),
    ]));

    await mapWithConcurrency(resolvedWorkspaceState.markdownPaths ?? [], INDEX_READ_CONCURRENCY, async (filePath) => {
      if (!cachedRowRecords.get(filePath)) {
        markdownContents.set(filePath, await this.vaultFileStore.readMarkdownFile(filePath));
      }
    });

    const rowsByPath = new Map();
    const forwardLinksByPath = new Map();
    const rawTargetKeysBySourcePath = new Map();
    const rawTargetSourcesByKey = new Map();
    const nextRowRecordCache = new Map();
    fileEntries.forEach((filePath) => {
      const cachedRowRecord = cachedRowRecords.get(filePath);
      const markdownContent = markdownContents.get(filePath) ?? null;
      const rowRecord = cachedRowRecord
        ? cloneSnapshotRowRecord(cachedRowRecord)
        : this.createSnapshotRow(filePath, resolvedWorkspaceState, wikiTargetIndex, markdownContent);
      nextRowRecordCache.set(filePath, {
        generation: cacheGeneration,
        metadataSignature: createRowMetadataSignature(filePath, resolvedWorkspaceState),
        rowRecord: cloneSnapshotRowRecord(rowRecord),
      });
      rowsByPath.set(filePath, rowRecord.row);
      forwardLinksByPath.set(filePath, rowRecord.forwardLinks);
      rawTargetKeysBySourcePath.set(filePath, rowRecord.rawTargetKeys);
      rowRecord.rawTargetKeys.forEach((rawTargetKey) => {
        addRawTargetSourceContribution({
          rawTargetSourcesByKey,
        }, filePath, rawTargetKey);
      });
    });

    const snapshot = {
      backlinkSourcesByTarget: new Map(),
      backlinksByPath: new Map(),
      filePaths: fileEntries,
      forwardLinksByPath,
      rawTargetKeysBySourcePath,
      rawTargetSourcesByKey,
      rowsByPath,
      scannedAt: resolvedWorkspaceState.scannedAt,
      wikiTargetIndex,
      workspaceState: resolvedWorkspaceState,
    };
    this.rebuildBacklinks(snapshot);
    this.indexSnapshot = snapshot;
    this.lastWorkspaceState = resolvedWorkspaceState;
    this.rowRecordCache = nextRowRecordCache;
    return snapshot;
  }

  async synchronizeWorkspaceState() {
    await this.workspaceStateSynchronizer?.();
  }

  removeSnapshotPath(snapshot, filePath) {
    this.removeRawTargetSourceContributions(snapshot, filePath);
    snapshot.rowsByPath.delete(filePath);
    snapshot.forwardLinksByPath.delete(filePath);
    snapshot.backlinkSourcesByTarget.delete(filePath);
    snapshot.backlinksByPath.delete(filePath);
    snapshot.filePaths = snapshot.filePaths.filter((candidatePath) => candidatePath !== filePath);
  }

  upsertSnapshotPath(snapshot, filePath) {
    if (snapshot.filePaths.includes(filePath)) {
      return;
    }

    snapshot.filePaths.push(filePath);
    snapshot.filePaths.sort(compareVaultPaths);
  }

  collectImpactedSourcesForMembershipChanges(snapshot, pathValues = []) {
    const affectedTargetKeys = new Set();
    pathValues.forEach((pathValue) => {
      collectReferenceTargetKeysForFilePath(pathValue).forEach((targetKey) => {
        affectedTargetKeys.add(targetKey);
      });
    });

    if (affectedTargetKeys.size === 0) {
      return new Set();
    }

    const impactedPaths = new Set();
    affectedTargetKeys.forEach((targetKey) => {
      const sourcePaths = snapshot.rawTargetSourcesByKey.get(targetKey);
      sourcePaths?.forEach((filePath) => {
        impactedPaths.add(filePath);
      });
    });
    return impactedPaths;
  }

  async refreshSnapshotRows(snapshot, workspaceState, pathValues = [], {
    targetPathAliases = new Map(),
  } = {}) {
    const filePathsToRefresh = Array.from(new Set(pathValues))
      .filter((pathValue) => {
        const entry = workspaceState?.entries?.get(pathValue);
        return pathValue && isWorkspaceFileEntry(entry);
      });

    const cacheGeneration = this.prepareRowRecordCache(snapshot.filePaths);
    await mapWithConcurrency(filePathsToRefresh, INDEX_READ_CONCURRENCY, async (filePath) => {
      const markdownContent = isMarkdownFilePath(filePath)
        ? await this.vaultFileStore.readMarkdownFile(filePath)
        : null;
      const rowRecord = this.createSnapshotRow(filePath, workspaceState, snapshot.wikiTargetIndex, markdownContent, {
        targetPathAliases,
      });
      this.rowRecordCache.set(filePath, {
        generation: cacheGeneration,
        metadataSignature: createRowMetadataSignature(filePath, workspaceState),
        rowRecord: cloneSnapshotRowRecord(rowRecord),
      });
      this.removeRawTargetSourceContributions(snapshot, filePath);
      snapshot.rowsByPath.set(filePath, rowRecord.row);
      snapshot.forwardLinksByPath.set(filePath, rowRecord.forwardLinks);
      this.addRawTargetSourceContributions(snapshot, filePath, rowRecord.rawTargetKeys);
    });
  }

  prepareRowRecordCache(filePaths) {
    const signature = JSON.stringify(filePaths);
    if (signature !== this.rowRecordCacheFileSetSignature) {
      // Link resolution depends on every target path, including previously missing files.
      this.rowRecordCache.clear();
      this.rowRecordCacheFileSetSignature = signature;
      this.rowRecordCacheGeneration += 1;
    }
    return this.rowRecordCacheGeneration;
  }

  getCachedRowRecord(filePath, workspaceState, generation) {
    const cached = this.rowRecordCache.get(filePath);
    return cached?.generation === generation
      && cached.metadataSignature === createRowMetadataSignature(filePath, workspaceState)
      ? cached.rowRecord
      : null;
  }

  invalidateRowRecordCachePath(filePath) {
    this.rowRecordCache.delete(filePath);
  }

  async ensureIndexSnapshot({ basePath = '', sourcePath = '' } = {}) {
    await this.synchronizeWorkspaceState();
    let workspaceState = await this.getWorkspaceState();
    const requiresFreshScan = [basePath, sourcePath]
      .filter(Boolean)
      .some((pathValue) => !workspaceState?.entries?.has?.(pathValue));
    if (requiresFreshScan) {
      workspaceState = await this.vaultFileStore.scanWorkspaceState();
      this.lastWorkspaceState = workspaceState;
      if (this.indexSnapshot?.scannedAt !== workspaceState?.scannedAt) {
        this.indexSnapshot = null;
      }
    }

    if (this.indexSnapshot?.scannedAt === workspaceState?.scannedAt) {
      return this.indexSnapshot;
    }

    return this.buildIndexSnapshot(workspaceState);
  }

  async initializeFromWorkspaceState(workspaceState = null) {
    this.lastWorkspaceState = workspaceState ?? null;
    if (this.indexSnapshot && workspaceState && this.indexSnapshot.scannedAt !== workspaceState.scannedAt) {
      this.indexSnapshot = null;
    }
    return this.indexSnapshot;
  }

  async applyWorkspaceChange(workspaceChange = {}, {
    previousState = null,
    nextState = null,
  } = {}) {
    this.lastWorkspaceState = nextState ?? this.lastWorkspaceState;
    if (!this.indexSnapshot) {
      return null;
    }

    if (!previousState || this.indexSnapshot.scannedAt !== previousState.scannedAt) {
      this.indexSnapshot = null;
      return null;
    }

    const changedPaths = Array.from(new Set(workspaceChange.changedPaths ?? []));
    const deletedFilePaths = (workspaceChange.deletedPaths ?? []).filter((pathValue) => (
      isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
    ));
    const renamedFileEntries = (workspaceChange.renamedPaths ?? []).filter((entry) => (
      isWorkspaceFileEntry(previousState?.entries?.get(entry?.oldPath))
      || isWorkspaceFileEntry(nextState?.entries?.get(entry?.newPath))
    ));
    const createdFilePaths = changedPaths.filter((pathValue) => (
      isWorkspaceFileEntry(nextState?.entries?.get(pathValue))
      && !isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
    ));
    const removedChangedFilePaths = changedPaths.filter((pathValue) => (
      !isWorkspaceFileEntry(nextState?.entries?.get(pathValue))
      && isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
    ));
    const membershipChanged = deletedFilePaths.length > 0
      || renamedFileEntries.length > 0
      || createdFilePaths.length > 0
      || removedChangedFilePaths.length > 0;

    const markdownPathsToRefresh = changedPaths.filter((pathValue) => (
      isWorkspaceFileEntry(previousState?.entries?.get(pathValue))
      && isWorkspaceFileEntry(nextState?.entries?.get(pathValue))
    ));

    if (!membershipChanged && markdownPathsToRefresh.length === 0) {
      this.indexSnapshot.workspaceState = nextState ?? this.indexSnapshot.workspaceState;
      this.indexSnapshot.scannedAt = nextState?.scannedAt ?? this.indexSnapshot.scannedAt;
      return this.indexSnapshot;
    }

    const snapshot = this.indexSnapshot;
    const affectedTargetPaths = new Set();
    const affectedSourcePaths = new Set(markdownPathsToRefresh);
    const targetPathAliases = createReferenceTargetAliasMap(renamedFileEntries);
    if (membershipChanged) {
      const membershipAffectedPaths = [
        ...deletedFilePaths,
        ...removedChangedFilePaths,
        ...createdFilePaths,
        ...renamedFileEntries.flatMap((entry) => [entry.oldPath, entry.newPath]),
      ];
      const impactedSourcePaths = this.collectImpactedSourcesForMembershipChanges(snapshot, membershipAffectedPaths);
      impactedSourcePaths.forEach((pathValue) => affectedSourcePaths.add(pathValue));
      [...deletedFilePaths, ...removedChangedFilePaths].forEach((pathValue) => {
        if (isMarkdownFilePath(pathValue)) {
          affectedSourcePaths.add(pathValue);
        }
        affectedTargetPaths.add(pathValue);
      });
      renamedFileEntries.forEach((entry) => {
        if (isMarkdownFilePath(entry.oldPath)) {
          affectedSourcePaths.add(entry.oldPath);
        }
        if (isMarkdownFilePath(entry.newPath)) {
          affectedSourcePaths.add(entry.newPath);
        }
        affectedTargetPaths.add(entry.oldPath);
        affectedTargetPaths.add(entry.newPath);
      });
      createdFilePaths.forEach((pathValue) => {
        if (isMarkdownFilePath(pathValue)) {
          affectedSourcePaths.add(pathValue);
        }
        affectedTargetPaths.add(pathValue);
      });

      affectedSourcePaths.forEach((pathValue) => {
        this.removeSourceBacklinkContributions(snapshot, pathValue, affectedTargetPaths);
      });

      [...deletedFilePaths, ...removedChangedFilePaths].forEach((pathValue) => {
        this.invalidateRowRecordCachePath(pathValue);
        this.removeSnapshotPath(snapshot, pathValue);
      });
      renamedFileEntries.forEach((entry) => {
        this.invalidateRowRecordCachePath(entry.oldPath);
        this.invalidateRowRecordCachePath(entry.newPath);
        this.removeSnapshotPath(snapshot, entry.oldPath);
      });
      [...createdFilePaths, ...renamedFileEntries.map((entry) => entry.newPath)].forEach((pathValue) => {
        const nextEntry = nextState?.entries?.get(pathValue);
        if (isWorkspaceFileEntry(nextEntry)) {
          this.upsertSnapshotPath(snapshot, pathValue);
        }
      });

      snapshot.wikiTargetIndex = createWikiTargetIndex(snapshot.filePaths);
      await this.refreshSnapshotRows(snapshot, nextState, [
        ...createdFilePaths,
        ...renamedFileEntries.map((entry) => entry.newPath),
        ...affectedSourcePaths,
      ], { targetPathAliases });
    } else {
      affectedSourcePaths.forEach((pathValue) => {
        this.removeSourceBacklinkContributions(snapshot, pathValue, affectedTargetPaths);
      });
      await this.refreshSnapshotRows(snapshot, nextState, [...affectedSourcePaths]);
    }

    affectedSourcePaths.forEach((pathValue) => {
      this.addSourceBacklinkContributions(snapshot, pathValue, affectedTargetPaths);
    });
    snapshot.workspaceState = nextState;
    snapshot.scannedAt = nextState?.scannedAt ?? snapshot.scannedAt;
    this.refreshSerializedBacklinks(snapshot, [
      ...snapshot.filePaths.filter((filePath) => !snapshot.backlinksByPath.has(filePath)),
      ...affectedTargetPaths,
    ]);
    return snapshot;
  }
}
