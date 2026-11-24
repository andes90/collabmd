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

export function summarizeFileStats(files = []) {
  return files.reduce((summary, file) => ({
    additions: summary.additions + Number(file.stats?.additions || 0),
    deletions: summary.deletions + Number(file.stats?.deletions || 0),
    filesChanged: summary.filesChanged + 1,
  }), {
    additions: 0,
    deletions: 0,
    filesChanged: 0,
  });
}

export async function dedupeInFlight(pendingMap, key, callback) {
  if (pendingMap.has(key)) {
    return pendingMap.get(key);
  }
  const promise = callback();
  pendingMap.set(key, promise);
  try {
    return await promise;
  } finally {
    if (pendingMap.get(key) === promise) {
      pendingMap.delete(key);
    }
  }
}

function createEmptySummary() {
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
