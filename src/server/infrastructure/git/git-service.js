import { createGitRequestError } from './errors.js';
import { normalizeRelativeGitPath } from './path-utils.js';
import { GitCommandRunner } from './command-runner.js';
import { GitDiffService } from './diff-service.js';
import { GitHistoryService } from './history-service.js';
import { parseNameStatusOutput } from './parsers.js';
import { createEmptyWorkspaceChange, createWorkspaceChange } from './responses.js';
import { GitStatusService } from './status-service.js';
import { GitUntrackedFileService } from './untracked-files.js';
import { PullBackupStore } from '../persistence/pull-backup-store.js';

function buildAuthorEnv(author = null) {
  const name = String(author?.name ?? '').trim();
  const email = String(author?.email ?? '').trim();

  if (!name || !email) {
    return null;
  }

  return {
    GIT_AUTHOR_EMAIL: email,
    GIT_AUTHOR_NAME: name,
    GIT_COMMITTER_EMAIL: email,
    GIT_COMMITTER_NAME: name,
  };
}

export class GitService {
  constructor({
    commandEnv = null,
    enabled = true,
    execFileImpl,
    maxInitialPatchBytes = 250_000,
    maxInitialPatchLines = 1_500,
    statusCacheTtlMs = 2_000,
    vaultDir,
  }) {
    this.commandRunner = new GitCommandRunner({
      commandEnv,
      enabled,
      execFileImpl,
      vaultDir,
    });
    this.untrackedFileService = new GitUntrackedFileService({ vaultDir });
    this.statusService = new GitStatusService({
      commandRunner: this.commandRunner,
      statusCacheTtlMs,
      untrackedFileService: this.untrackedFileService,
    });
    this.diffService = new GitDiffService({
      commandRunner: this.commandRunner,
      maxInitialPatchBytes,
      maxInitialPatchLines,
      statusService: this.statusService,
      untrackedFileService: this.untrackedFileService,
    });
    this.historyService = new GitHistoryService({
      commandRunner: this.commandRunner,
      maxInitialPatchBytes,
      maxInitialPatchLines,
    });
    this.pullBackupStore = new PullBackupStore({ vaultDir });
  }

  async isGitRepo() {
    return this.commandRunner.isGitRepo();
  }

  async execGit(args) {
    return this.commandRunner.execGit(args);
  }

  invalidateStatusCache() {
    this.statusService.invalidate();
    this.diffService.invalidate();
    this.historyService.invalidate();
  }

  async getStatus(options = {}) {
    return this.statusService.getStatus(options);
  }

  async listPullBackups() {
    if (!(await this.isGitRepo())) {
      return [];
    }

    return this.pullBackupStore.listBackups();
  }

  async stageFile(path) {
    const normalizedPath = normalizeRelativeGitPath(path);
    await this.commandRunner.execGit(['add', '-A', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
      workspaceChange: createEmptyWorkspaceChange(),
    };
  }

  async unstageFile(path) {
    const normalizedPath = normalizeRelativeGitPath(path);
    await this.commandRunner.execGit(['reset', 'HEAD', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
      workspaceChange: createEmptyWorkspaceChange(),
    };
  }

  async commitStaged({ author = null, message } = {}) {
    const normalizedMessage = String(message ?? '').trim();
    if (!normalizedMessage) {
      throw createGitRequestError(400, 'Missing commit message');
    }

    const status = await this.getStatus({ force: true });
    if (Number(status.summary?.staged || 0) === 0) {
      throw createGitRequestError(409, 'No staged changes to commit');
    }

    await this.commandRunner.execGit(['commit', '-m', normalizedMessage], {
      env: buildAuthorEnv(author),
    });
    const hash = (await this.commandRunner.execGit(['rev-parse', 'HEAD'])).trim();
    const shortHash = (await this.commandRunner.execGit(['rev-parse', '--short', 'HEAD'])).trim();
    this.invalidateStatusCache();
    return {
      commit: {
        hash,
        message: normalizedMessage,
        shortHash,
      },
      ok: true,
      workspaceChange: createEmptyWorkspaceChange(),
    };
  }

  async pushBranch() {
    const status = await this.getStatus({ force: true });
    if (status.branch?.detached) {
      throw createGitRequestError(409, 'Cannot push from a detached HEAD');
    }
    if (!status.branch?.upstream) {
      throw createGitRequestError(409, 'No upstream branch is configured for push');
    }

    try {
      const output = await this.commandRunner.execGit(['push']);
      this.invalidateStatusCache();
      return {
        ok: true,
        output: output.trim(),
        workspaceChange: createEmptyWorkspaceChange(),
      };
    } catch (pushError) {
      const message = String(pushError?.message ?? '');
      const isNonFastForward = message.includes('non-fast-forward') || message.includes('fetch first');
      if (!isNonFastForward) {
        throw pushError;
      }

      // Remote has advanced: fetch + rebase local commits on top, then retry push.
      const branchName = status.branch.name ?? 'HEAD';
      const beforeLocalRef = await this.getHeadRef();

      await this.commandRunner.execGit(['fetch', 'origin']);

      try {
        await this.commandRunner.execGit(['rebase', 'origin/' + branchName]);
      } catch {
        await this.commandRunner.execGit(['rebase', '--abort']).catch(() => {});
        this.invalidateStatusCache();
        throw createGitRequestError(
          409,
          'Push failed: the remote has new commits that conflict with your local commits. Resolve the conflicts manually.',
          'push_rebase_conflict',
        );
      }

      // Compute which files changed from the remote commits so CollabMD can
      // reload the corresponding rooms — otherwise stale Yjs content would be
      // persisted back to disk and git would flag those files as modified.
      const remoteWorkspaceChange = beforeLocalRef
        ? await this.createWorkspaceChangeFromRefs(beforeLocalRef, `origin/${branchName}`)
        : createEmptyWorkspaceChange();

      const output = await this.commandRunner.execGit(['push']);
      this.invalidateStatusCache();
      return {
        ok: true,
        output: output.trim(),
        rebased: true,
        workspaceChange: remoteWorkspaceChange,
      };
    }
  }

  async pullBranch() {
    const status = await this.getStatus({ force: true });
    if (status.branch?.detached) {
      throw createGitRequestError(409, 'Cannot pull from a detached HEAD');
    }
    if (!status.branch?.upstream) {
      throw createGitRequestError(409, 'No upstream branch is configured for pull');
    }

    const beforeRef = await this.getHeadRef();
    await this.fetchUpstream(status.branch.upstream);

    const targetRef = await this.resolveRef(status.branch.upstream);
    if (!targetRef) {
      throw createGitRequestError(409, 'Unable to resolve upstream branch for pull');
    }

    if (!(await this.canFastForwardTo(targetRef))) {
      throw createGitRequestError(
        409,
        'Cannot pull because local and remote commits have diverged; fast-forward only pull is not possible.',
        'pull_diverged_ff_only',
      );
    }

    const dirtyEntries = this.collectDirtyEntries(status);
    const upstreamWorkspaceChange = await this.createWorkspaceChangeFromRefs(beforeRef, targetRef);
    const overlappingEntries = this.findOverlappingDirtyEntries({
      dirtyEntries,
      workspaceChange: upstreamWorkspaceChange,
    });

    let pullBackup = null;
    if (overlappingEntries.length > 0) {
      pullBackup = await this.backupAndClearOverlappingEntries({
        beforeRef,
        branchName: status.branch?.name ?? null,
        entries: overlappingEntries,
        targetRef,
      });
    }

    let output;
    try {
      output = await this.commandRunner.execGit(['pull', '--ff-only', '--autostash']);
    } catch (error) {
      throw await this.classifyPullError(error);
    }

    const afterRef = await this.getHeadRef();
    this.invalidateStatusCache();
    return {
      afterRef,
      beforeRef,
      ok: true,
      output: output.trim(),
      pullBackup,
      workspaceChange: await this.createWorkspaceChangeFromRefs(beforeRef, afterRef),
    };
  }

  async resetFileToHead(path) {
    const normalizedPath = normalizeRelativeGitPath(path);
    const sourceRef = 'HEAD';
    const existsOnSource = await this.pathExistsAtRef(sourceRef, normalizedPath);

    if (existsOnSource) {
      await this.commandRunner.execGit(['restore', '--source', sourceRef, '--staged', '--worktree', '--', normalizedPath]);
      this.invalidateStatusCache();
      return {
        ok: true,
        path: normalizedPath,
        sourceRef,
        workspaceChange: createWorkspaceChange({
          changedPaths: [normalizedPath],
        }),
      };
    }

    await this.commandRunner.execGit(['rm', '-f', '--ignore-unmatch', '--', normalizedPath]);
    await this.commandRunner.execGit(['clean', '-f', '--', normalizedPath]);
    this.invalidateStatusCache();
    return {
      ok: true,
      path: normalizedPath,
      sourceRef,
      workspaceChange: createWorkspaceChange({
        deletedPaths: [normalizedPath],
      }),
    };
  }

  async getDiff({ allowLargePatch = false, metaOnly = false, path = null, scope = 'working-tree' } = {}) {
    const normalizedPath = path ? normalizeRelativeGitPath(path) : null;
    return this.diffService.getDiff({
      allowLargePatch,
      metaOnly,
      path: normalizedPath,
      scope,
    });
  }

  async getHistory({ limit = 30, offset = 0 } = {}) {
    return this.historyService.listHistory({ limit, offset });
  }

  async getFileHistory({ limit = 30, offset = 0, path } = {}) {
    return this.historyService.listFileHistory({ limit, offset, path });
  }

  async getCommit({ allowLargePatch = false, hash, metaOnly = false, path = null } = {}) {
    return this.historyService.getCommit({
      allowLargePatch,
      hash,
      metaOnly,
      path,
    });
  }

  async getFileSnapshot({ hash, path } = {}) {
    return this.historyService.getFileSnapshot({ hash, path });
  }

  async getHeadRef() {
    try {
      const output = await this.commandRunner.execGit(['rev-parse', 'HEAD']);
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  async pathExistsAtRef(ref, path) {
    try {
      await this.commandRunner.execGit(['cat-file', '-e', `${ref}:${path}`]);
      return true;
    } catch {
      return false;
    }
  }

  async resolveRef(ref) {
    try {
      const output = await this.commandRunner.execGit(['rev-parse', ref]);
      return output.trim() || null;
    } catch {
      return null;
    }
  }

  async fetchUpstream(upstreamRef) {
    const remoteName = String(upstreamRef ?? '').split('/')[0] || null;
    await this.commandRunner.execGit(remoteName
      ? ['fetch', '--prune', remoteName]
      : ['fetch', '--prune']);
  }

  async canFastForwardTo(targetRef) {
    const headRef = await this.getHeadRef();
    if (!headRef || !targetRef || headRef === targetRef) {
      return true;
    }

    try {
      await this.commandRunner.execGit(['merge-base', '--is-ancestor', headRef, targetRef]);
      return true;
    } catch (error) {
      if (error?.code === 1) {
        return false;
      }
      throw error;
    }
  }

  collectDirtyEntries(status = {}) {
    const entries = new Map();
    for (const section of status.sections ?? []) {
      for (const file of section.files ?? []) {
        if (!file?.path) {
          continue;
        }

        const existing = entries.get(file.path) ?? {
          hasStagedChanges: false,
          hasWorkingTreeChanges: false,
          hasTrackedChanges: false,
          isUntracked: false,
          oldPath: null,
          path: file.path,
          touchPaths: new Set(),
        };

        existing.isUntracked = existing.isUntracked || file.scope === 'untracked';
        existing.hasStagedChanges = existing.hasStagedChanges || file.scope === 'staged';
        existing.hasWorkingTreeChanges = existing.hasWorkingTreeChanges || file.scope === 'working-tree';
        existing.hasTrackedChanges = existing.hasTrackedChanges || file.scope === 'staged' || file.scope === 'working-tree';
        if (!existing.oldPath && file.oldPath) {
          existing.oldPath = file.oldPath;
        }
        existing.touchPaths.add(file.path);
        if (file.oldPath) {
          existing.touchPaths.add(file.oldPath);
        }
        entries.set(file.path, existing);
      }
    }

    return Array.from(entries.values());
  }

  findOverlappingDirtyEntries({ dirtyEntries = [], workspaceChange = createEmptyWorkspaceChange() } = {}) {
    const upstreamTouchedPaths = new Set([
      ...(workspaceChange.changedPaths ?? []),
      ...(workspaceChange.deletedPaths ?? []),
      ...((workspaceChange.renamedPaths ?? []).flatMap((entry) => [entry.oldPath, entry.newPath])),
    ].filter(Boolean));

    return dirtyEntries.filter((entry) => Array.from(entry.touchPaths).some((path) => upstreamTouchedPaths.has(path)));
  }

  async createPatchForEntry(entry, { cached = false } = {}) {
    const pathspecs = Array.from(entry?.touchPaths ?? []).filter(Boolean);
    if (pathspecs.length === 0) {
      return null;
    }

    const output = await this.commandRunner.execGit([
      'diff',
      '--binary',
      '--find-renames',
      ...(cached ? ['--cached'] : []),
      '--',
      ...pathspecs,
    ]);

    return output || null;
  }

  async backupAndClearOverlappingEntries({
    beforeRef,
    branchName = null,
    entries = [],
    targetRef = null,
  } = {}) {
    const backupEntries = await Promise.all(entries.map(async (entry) => ({
      ...entry,
      stagedPatchContent: entry.hasStagedChanges
        ? await this.createPatchForEntry(entry, { cached: true })
        : null,
      worktreePatchContent: entry.hasWorkingTreeChanges
        ? await this.createPatchForEntry(entry, { cached: false })
        : null,
    })));

    const pullBackup = await this.pullBackupStore.createBackup({
      branch: branchName,
      entries: backupEntries,
      headRef: beforeRef,
      targetRef,
    });

    for (const entry of backupEntries) {
      if (entry.isUntracked && !entry.hasTrackedChanges) {
        await this.commandRunner.execGit(['clean', '-f', '--', entry.path]);
        continue;
      }

      await this.restorePathToHead(entry.path);
    }

    return pullBackup;
  }

  async restorePathToHead(path) {
    const normalizedPath = normalizeRelativeGitPath(path);
    const sourceRef = 'HEAD';
    const existsOnSource = await this.pathExistsAtRef(sourceRef, normalizedPath);

    if (existsOnSource) {
      await this.commandRunner.execGit(['restore', '--source', sourceRef, '--staged', '--worktree', '--', normalizedPath]);
      return;
    }

    await this.commandRunner.execGit(['rm', '-f', '--ignore-unmatch', '--', normalizedPath]);
    await this.commandRunner.execGit(['clean', '-f', '--', normalizedPath]);
  }

  async hasConflictedStatus() {
    const status = await this.getStatus({ force: true });
    return (status.sections ?? [])
      .flatMap((section) => section.files ?? [])
      .some((file) => file?.status === 'conflicted');
  }

  async classifyPullError(error) {
    if (await this.hasConflictedStatus()) {
      return createGitRequestError(
        409,
        'Pull applied remote updates, but reapplying local changes caused conflicts. Review the conflicted files and the pull backup summary.',
        'pull_conflicted_after_autostash',
      );
    }

    return error;
  }

  async createWorkspaceChangeFromRefs(beforeRef, afterRef) {
    if (!afterRef || beforeRef === afterRef) {
      return createEmptyWorkspaceChange();
    }

    const args = beforeRef
      ? ['diff', '--name-status', '--find-renames', beforeRef, afterRef]
      : ['diff-tree', '--root', '--no-commit-id', '--name-status', '--find-renames', '-r', afterRef];
    const parsed = parseNameStatusOutput(await this.commandRunner.execGit(args));
    return createWorkspaceChange(parsed);
  }
}
