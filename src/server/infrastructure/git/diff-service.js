import { countPatchLines, parseNumstatOutput, parseUnifiedDiff } from './parsers.js';
import { createEmptyStats } from './responses.js';
import { getVaultFileKind } from '../../../domain/file-kind.js';

function createSectionMap(sections = []) {
  return new Map(sections.map((section) => [section.key, section]));
}

function getStatusPriority(status) {
  switch (status) {
    case 'deleted':
      return 5;
    case 'added':
    case 'untracked':
      return 4;
    case 'renamed':
      return 3;
    default:
      return 2;
  }
}

function createScopeFlags(scope) {
  return {
    hasStagedChanges: scope === 'staged',
    hasUntrackedChanges: scope === 'untracked',
    hasWorkingTreeChanges: scope === 'working-tree',
  };
}

function mergeScopedFile(existingFile, nextFile, scope) {
  const nextFlags = createScopeFlags(nextFile.scope);
  if (!existingFile) {
    return {
      ...nextFile,
      ...nextFlags,
      fileKind: nextFile.fileKind || getVaultFileKind(nextFile.path),
      scope,
      stats: createEmptyStats(),
    };
  }

  const nextPriority = getStatusPriority(nextFile.status);
  const currentPriority = getStatusPriority(existingFile.status);
  if (nextPriority > currentPriority) {
    return {
      ...existingFile,
      ...nextFile,
      fileKind: existingFile.fileKind || getVaultFileKind(nextFile.path),
      hasStagedChanges: existingFile.hasStagedChanges || nextFlags.hasStagedChanges,
      hasUntrackedChanges: existingFile.hasUntrackedChanges || nextFlags.hasUntrackedChanges,
      hasWorkingTreeChanges: existingFile.hasWorkingTreeChanges || nextFlags.hasWorkingTreeChanges,
      scope,
      stats: existingFile.stats ?? createEmptyStats(),
    };
  }

  return {
    ...existingFile,
    fileKind: existingFile.fileKind || getVaultFileKind(nextFile.path),
    hasStagedChanges: existingFile.hasStagedChanges || nextFlags.hasStagedChanges,
    hasUntrackedChanges: existingFile.hasUntrackedChanges || nextFlags.hasUntrackedChanges,
    hasWorkingTreeChanges: existingFile.hasWorkingTreeChanges || nextFlags.hasWorkingTreeChanges,
  };
}

export class GitDiffService {
  constructor({
    commandRunner,
    maxInitialPatchBytes = 250_000,
    maxInitialPatchLines = 1_500,
    statusService,
    untrackedFileService,
  }) {
    this.commandRunner = commandRunner;
    this.maxInitialPatchBytes = maxInitialPatchBytes;
    this.maxInitialPatchLines = maxInitialPatchLines;
    this.statusService = statusService;
    this.untrackedFileService = untrackedFileService;
    this.pendingDiffRequests = new Map();
  }

  invalidate() {
    this.pendingDiffRequests.clear();
  }

  buildDiffCommandArgs({ hasHeadCommit = true, numstat = false, path = null, scope = 'working-tree' } = {}) {
    const args = numstat
      ? ['diff', '--numstat']
      : ['diff', '--no-color', '--no-ext-diff', '--find-renames'];

    if (scope === 'staged') {
      args.push('--cached');
    } else if (scope === 'all') {
      if (hasHeadCommit) {
        args.push('HEAD');
      } else {
        args.push('--cached');
      }
    }

    if (path) {
      args.push('--', path);
    }

    return args;
  }

  getScopedFiles(status, scope = 'working-tree', path = null) {
    const fileMap = new Map();
    const sectionMap = createSectionMap(status.sections);
    const candidateSections = scope === 'staged'
      ? ['staged']
      : scope === 'all'
        ? ['staged', 'working-tree', 'untracked']
        : ['working-tree', 'untracked'];

    for (const sectionKey of candidateSections) {
      const section = sectionMap.get(sectionKey);
      for (const file of section?.files ?? []) {
        if (path && file.path !== path) {
          continue;
        }

        const existing = fileMap.get(file.path) ?? null;
        const merged = mergeScopedFile(existing, file, scope);
        fileMap.set(file.path, merged);
      }
    }

    return Array.from(fileMap.values());
  }

  async getScopeSummary({
    files = [],
    hasHeadCommit = false,
    path = null,
    scope = 'working-tree',
  } = {}) {
    const trackedFiles = files.filter((entry) => entry.status !== 'untracked');
    // The diff spawn and the untracked file scan are independent: overlap them.
    const trackedSummaryPromise = trackedFiles.length > 0
      ? this.commandRunner.execGit(this.buildDiffCommandArgs({
        hasHeadCommit,
        numstat: true,
        path,
        scope,
      })).then((output) => parseNumstatOutput(output))
      : Promise.resolve(createEmptyStats());
    const untrackedAdditionsPromise = this.untrackedFileService.countAdditions(
      files.filter((entry) => entry.status === 'untracked'),
    );

    const [trackedSummary, untrackedAdditions] = await Promise.all([
      trackedSummaryPromise,
      untrackedAdditionsPromise,
    ]);

    return {
      additions: trackedSummary.additions + untrackedAdditions,
      deletions: trackedSummary.deletions,
      filesChanged: files.length,
    };
  }

  async getDiff({ allowLargePatch = false, metaOnly = false, path = null, scope = 'working-tree' } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    if (!isGitRepo) {
      return {
        files: [],
        isGitRepo: false,
        metaOnly,
        path: null,
        scope,
        summary: {
          additions: 0,
          deletions: 0,
          filesChanged: 0,
        },
      };
    }

    const resolvedScope = scope === 'staged' || scope === 'all'
      ? scope
      : 'working-tree';
    const requestKey = JSON.stringify({
      allowLargePatch: Boolean(allowLargePatch),
      metaOnly: Boolean(metaOnly),
      path,
      scope: resolvedScope,
    });

    if (this.pendingDiffRequests.has(requestKey)) {
      return this.pendingDiffRequests.get(requestKey);
    }

    const requestPromise = this.getDiffUncached({
      allowLargePatch,
      metaOnly,
      path,
      scope: resolvedScope,
    });
    this.pendingDiffRequests.set(requestKey, requestPromise);

    try {
      return await requestPromise;
    } finally {
      if (this.pendingDiffRequests.get(requestKey) === requestPromise) {
        this.pendingDiffRequests.delete(requestKey);
      }
    }
  }

  async getDiffUncached({ allowLargePatch = false, metaOnly = false, path = null, scope = 'working-tree' } = {}) {
    const status = await this.statusService.getStatus();
    const scopedFiles = this.getScopedFiles(status, scope, path);
    const hasHeadCommit = Boolean(status.branch?.hasCommits);

    if (metaOnly) {
      const scopeSummary = await this.getScopeSummary({
        files: scopedFiles,
        hasHeadCommit,
        path,
        scope,
      });

      return {
        files: scopedFiles,
        isGitRepo: true,
        metaOnly: true,
        path,
        scope,
        summary: scopeSummary,
      };
    }

    const isSinglePathRequest = Boolean(path);
    const currentFile = isSinglePathRequest ? scopedFiles[0] ?? null : null;
    if (currentFile?.status === 'untracked') {
      const fileLineCount = await this.untrackedFileService.countAdditions([currentFile]);
      const summary = {
        additions: fileLineCount,
        deletions: 0,
        filesChanged: scopedFiles.length,
      };

      if (!allowLargePatch && fileLineCount > this.maxInitialPatchLines) {
        return {
          files: [{
            ...currentFile,
            canLoadFullPatch: true,
            hunks: [],
            patchLineCount: fileLineCount,
            stats: {
              additions: fileLineCount,
              deletions: 0,
            },
            tooLarge: true,
          }],
          isGitRepo: true,
          metaOnly: false,
          path,
          scope,
          summary,
        };
      }

      const syntheticFiles = await this.untrackedFileService.buildSyntheticDiffs([currentFile]);
      const detail = syntheticFiles[0] ?? {
        ...currentFile,
        hunks: [],
        stats: {
          additions: fileLineCount,
          deletions: 0,
        },
      };

      return {
        files: [{
          ...currentFile,
          ...detail,
          canLoadFullPatch: false,
          patchLineCount: countPatchLines(detail),
          tooLarge: false,
        }],
        isGitRepo: true,
        metaOnly: false,
        path,
        scope,
        summary,
      };
    }

    let singleFileSummary = null;
    if (isSinglePathRequest) {
      singleFileSummary = await this.getScopeSummary({
        files: scopedFiles,
        hasHeadCommit,
        path,
        scope,
      });

      if (
        currentFile
        && !allowLargePatch
        && singleFileSummary.filesChanged > 0
        && (singleFileSummary.additions + singleFileSummary.deletions) > this.maxInitialPatchLines
      ) {
        return {
          files: [{
            ...currentFile,
            canLoadFullPatch: true,
            hunks: [],
            patchLineCount: singleFileSummary.additions + singleFileSummary.deletions,
            stats: {
              additions: singleFileSummary.additions,
              deletions: singleFileSummary.deletions,
            },
            tooLarge: true,
          }],
          isGitRepo: true,
          metaOnly: false,
          path,
          scope,
          summary: singleFileSummary,
        };
      }
    }

    const diffText = await this.commandRunner.execGit(this.buildDiffCommandArgs({
      hasHeadCommit,
      path,
      scope,
    }));
    const parsedFiles = parseUnifiedDiff(diffText);

    if (scope !== 'staged') {
      const untrackedFiles = this.getScopedFiles(status, 'working-tree', path)
        .filter((file) => file.status === 'untracked');
      const trackedPathSet = new Set(parsedFiles.map((entry) => entry.path));
      const missingUntrackedFiles = untrackedFiles.filter((file) => !trackedPathSet.has(file.path));
      parsedFiles.push(...await this.untrackedFileService.buildSyntheticDiffs(missingUntrackedFiles));
    }

    const parsedFileMap = new Map(parsedFiles.map((file) => [file.path, file]));
    const mergedFiles = scopedFiles.map((file) => {
      const detail = parsedFileMap.get(file.path) ?? null;
      if (!detail) {
        return {
          ...file,
          hunks: [],
          stats: file.stats ?? createEmptyStats(),
        };
      }

      const patchLineCount = countPatchLines(detail);
      if (
        isSinglePathRequest
        && !allowLargePatch
        && (
          patchLineCount > this.maxInitialPatchLines
          || diffText.length > this.maxInitialPatchBytes
        )
      ) {
        return {
          ...file,
          byteLength: diffText.length,
          canLoadFullPatch: true,
          hunks: [],
          patchLineCount,
          stats: detail.stats,
          tooLarge: true,
        };
      }

      return {
        ...file,
        ...detail,
        fileKind: file.fileKind || detail.fileKind || getVaultFileKind(file.path),
        canLoadFullPatch: false,
        patchLineCount,
        tooLarge: false,
      };
    });

    const summary = parsedFiles.reduce((accumulator, file) => ({
      additions: accumulator.additions + (file.stats?.additions ?? 0),
      deletions: accumulator.deletions + (file.stats?.deletions ?? 0),
      filesChanged: accumulator.filesChanged + 1,
    }), {
      additions: 0,
      deletions: 0,
      filesChanged: 0,
    });

    return {
      files: mergedFiles,
      isGitRepo: true,
      metaOnly: false,
      path,
      scope,
      summary: isSinglePathRequest ? singleFileSummary ?? summary : summary,
    };
  }
}
