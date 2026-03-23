import {
  createEmptyWorkspaceChange as createSharedEmptyWorkspaceChange,
  createWorkspaceChange as createSharedWorkspaceChange,
} from '../../../domain/workspace-change.js';

const STATUS_MAP = {
  A: { code: 'A', label: 'added', status: 'added' },
  C: { code: 'C', label: 'copied', status: 'copied' },
  D: { code: 'D', label: 'deleted', status: 'deleted' },
  M: { code: 'M', label: 'modified', status: 'modified' },
  R: { code: 'R', label: 'renamed', status: 'renamed' },
  T: { code: 'T', label: 'type change', status: 'type-changed' },
  U: { code: 'U', label: 'conflicted', status: 'conflicted' },
  '?': { code: 'U', label: 'untracked', status: 'untracked' },
};

export function createStatusInfo(symbol) {
  return STATUS_MAP[symbol] ?? { code: symbol || 'M', label: 'modified', status: 'modified' };
}

export function createEmptyStats() {
  return {
    additions: 0,
    deletions: 0,
  };
}

export function createEmptySummary() {
  return {
    additions: 0,
    changedFiles: 0,
    deletions: 0,
    staged: 0,
    untracked: 0,
    workingTree: 0,
  };
}

export function createEmptyBranchStatus() {
  return {
    ahead: 0,
    behind: 0,
    detached: false,
    hasCommits: false,
    name: null,
    upstream: null,
  };
}

export function createEmptyWorkspaceChange() {
  return createSharedEmptyWorkspaceChange();
}

export function createEmptyStatusResponse() {
  return {
    branch: createEmptyBranchStatus(),
    isGitRepo: false,
    sections: [
      { files: [], key: 'staged', label: 'Staged Changes' },
      { files: [], key: 'working-tree', label: 'Changes' },
      { files: [], key: 'untracked', label: 'Untracked' },
    ],
    summary: createEmptySummary(),
  };
}

export function createDiffResponse({
  files = [],
  isGitRepo = true,
  metaOnly = false,
  path = null,
  scope = 'working-tree',
  summary = {
    additions: 0,
    deletions: 0,
    filesChanged: 0,
  },
} = {}) {
  return {
    files,
    isGitRepo,
    metaOnly,
    path,
    scope,
    summary,
  };
}

export function createHistoryResponse({
  commits = [],
  hasMore = false,
  isGitRepo = true,
  limit = 30,
  offset = 0,
} = {}) {
  return {
    commits,
    hasMore,
    isGitRepo,
    limit,
    offset,
  };
}

export function createFileHistoryResponse({
  commits = [],
  hasMore = false,
  isGitRepo = true,
  limit = 30,
  offset = 0,
  path = null,
} = {}) {
  return {
    commits,
    hasMore,
    isGitRepo,
    limit,
    offset,
    path,
  };
}

export function createCommitDiffResponse({
  commit = null,
  files = [],
  isGitRepo = true,
  metaOnly = false,
  path = null,
  summary = {
    additions: 0,
    deletions: 0,
    filesChanged: 0,
  },
} = {}) {
  return {
    commit,
    files,
    isGitRepo,
    metaOnly,
    path,
    source: 'commit',
    summary,
  };
}

export function createFileSnapshotResponse({
  content = '',
  fileKind = null,
  hash = null,
  isGitRepo = true,
  path = null,
} = {}) {
  return {
    content,
    fileKind,
    hash,
    isGitRepo,
    path,
  };
}

export function createWorkspaceChange({
  changedPaths = [],
  deletedPaths = [],
  refreshExplorer = true,
  renamedPaths = [],
} = {}) {
  return createSharedWorkspaceChange({
    changedPaths,
    deletedPaths,
    refreshExplorer,
    renamedPaths,
  });
}
