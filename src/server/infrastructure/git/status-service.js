import { parseNumstatOutput, parseStatusOutput } from './parsers.js';
import { createEmptyStatusResponse } from './responses.js';

export class GitStatusService {
  constructor({
    commandRunner,
    statusCacheTtlMs = 2_000,
    untrackedFileService,
  }) {
    this.commandRunner = commandRunner;
    this.statusCacheTtlMs = statusCacheTtlMs;
    this.untrackedFileService = untrackedFileService;
    this.statusCache = {
      expiresAt: 0,
      value: null,
    };
    this.pendingStatusPromise = null;
  }

  invalidate() {
    this.statusCache = {
      expiresAt: 0,
      value: null,
    };
    this.pendingStatusPromise = null;
  }

  async getStatus({ force = false } = {}) {
    const isGitRepo = await this.commandRunner.isGitRepo();
    if (!isGitRepo) {
      return createEmptyStatusResponse();
    }

    const now = Date.now();
    if (!force && this.statusCache.value && now < this.statusCache.expiresAt) {
      return this.statusCache.value;
    }

    if (this.pendingStatusPromise) {
      return this.pendingStatusPromise;
    }

    const statusPromise = (async () => {
      const parsed = parseStatusOutput(
        await this.commandRunner.execGit(['status', '--porcelain=v1', '-z', '--branch', '--untracked-files=all']),
      );
      const sections = [
        { files: parsed.sections.staged, key: 'staged', label: 'Staged Changes' },
        { files: parsed.sections['working-tree'], key: 'working-tree', label: 'Changes' },
        { files: parsed.sections.untracked, key: 'untracked', label: 'Untracked' },
      ];
      const localSummary = await this.getLocalChangeSummary({
        hasHeadCommit: parsed.branch.hasCommits,
        untrackedFiles: parsed.sections.untracked,
      });
      const response = {
        branch: parsed.branch,
        isGitRepo: true,
        sections,
        summary: {
          ...parsed.summary,
          additions: localSummary.additions,
          deletions: localSummary.deletions,
        },
      };

      this.statusCache = {
        expiresAt: Date.now() + this.statusCacheTtlMs,
        value: response,
      };

      return response;
    })();

    this.pendingStatusPromise = statusPromise;

    try {
      return await statusPromise;
    } finally {
      if (this.pendingStatusPromise === statusPromise) {
        this.pendingStatusPromise = null;
      }
    }
  }

  async getLocalChangeSummary({ hasHeadCommit = false, untrackedFiles = [] } = {}) {
    // The diff spawn and the untracked file scan are independent: overlap them.
    const trackedSummaryPromise = this.commandRunner.execGit(hasHeadCommit
      ? ['diff', '--numstat', 'HEAD']
      : ['diff', '--cached', '--numstat']).then((output) => parseNumstatOutput(output));
    const untrackedAdditionsPromise = this.untrackedFileService.countAdditions(untrackedFiles);

    const [trackedSummary, untrackedAdditions] = await Promise.all([
      trackedSummaryPromise,
      untrackedAdditionsPromise,
    ]);

    return {
      additions: trackedSummary.additions + untrackedAdditions,
      deletions: trackedSummary.deletions,
    };
  }
}
