import { escapeHtml } from '../domain/vault-utils.js';
import { resolveApiUrl } from '../domain/runtime-paths.js';

const HISTORY_PAGE_SIZE = 30;
const REFRESH_INTERVAL_MS = 10_000;

function getPathDir(pathValue) {
  const parts = String(pathValue ?? '').split('/');
  parts.pop();
  return parts.join('/');
}

function getPathLeaf(pathValue) {
  return String(pathValue ?? '').split('/').pop() || '';
}

function fileIconSvg() {
  return '<svg class="git-file-icon" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>';
}

function branchIconSvg() {
  return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18" cy="18" r="3"/><circle cx="6" cy="6" r="3"/><path d="M13 6h3a2 2 0 0 1 2 2v7"/><path d="M6 9v12"/></svg>';
}

function chevronSvg(collapsed) {
  return `<svg class="git-section-chevron${collapsed ? ' collapsed' : ''}" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
}

function actionIconSvg(action) {
  switch (action) {
    case 'commit':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 6 9 17l-5-5"/></svg>';
    case 'pull':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="m18 13-6 6-6-6"/></svg>';
    case 'push':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 19V5"/><path d="m6 11 6-6 6 6"/></svg>';
    case 'unstage':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 12H8"/><path d="m12 16-4-4 4-4"/></svg>';
    case 'reset':
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 12a9 9 0 1 0 3-6.7"/><path d="M3 4v5h5"/></svg>';
    default:
      return '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
  }
}

function badgeClass(status) {
  switch (status) {
    case 'added':
      return 'ui-status-badge--success';
    case 'deleted':
      return 'ui-status-badge--danger';
    case 'renamed':
      return 'ui-status-badge--accent';
    case 'untracked':
      return 'ui-status-badge--muted';
    default:
      return 'ui-status-badge--warning';
  }
}

function renderBranchMetrics(summary = {}, branch = {}) {
  const additions = Number(summary.additions || 0);
  const deletions = Number(summary.deletions || 0);
  const changedFiles = Number(summary.changedFiles || 0);

  if (changedFiles > 0 || additions > 0 || deletions > 0) {
    return `
      <span class="git-change-stats" aria-label="Local diff summary">
        <span class="git-change-add">+${additions}</span>
        <span class="git-change-del">-${deletions}</span>
      </span>
    `;
  }

  if (branch.upstream || Number(branch.ahead || 0) > 0 || Number(branch.behind || 0) > 0) {
    return `
      <span class="git-sync-info" aria-label="Remote sync status">
        <span class="git-sync-metric git-sync-metric--ahead">&#8593;${Number(branch.ahead || 0)}</span>
        <span class="git-sync-metric git-sync-metric--behind">&#8595;${Number(branch.behind || 0)}</span>
      </span>
    `;
  }

  return '<span class="git-sync-info git-sync-info-muted">Clean</span>';
}

function renderHistoryRowTitle(commit = {}) {
  const subject = String(commit.subject || '').trim() || commit.shortHash || 'Commit';
  return escapeHtml(subject);
}

export class GitPanelController {
  constructor({
    enabled = true,
    onCommitStaged = () => {},
    onOpenPullBackup = () => {},
    onPullBranch = () => {},
    onPushBranch = () => {},
    onRepoChange = () => {},
    onResetFile = () => {},
    onSelectCommit = () => {},
    onSelectDiff = () => {},
    onStageFile = () => {},
    onUnstageFile = () => {},
    onViewAllDiff = () => {},
    searchInput = null,
    toastController = null,
  } = {}) {
    this.enabled = enabled;
    this.onCommitStaged = onCommitStaged;
    this.onOpenPullBackup = onOpenPullBackup;
    this.onPullBranch = onPullBranch;
    this.onPushBranch = onPushBranch;
    this.onRepoChange = onRepoChange;
    this.onResetFile = onResetFile;
    this.onSelectCommit = onSelectCommit;
    this.onSelectDiff = onSelectDiff;
    this.onStageFile = onStageFile;
    this.onUnstageFile = onUnstageFile;
    this.onViewAllDiff = onViewAllDiff;
    this.searchInput = searchInput;
    this.toastController = toastController;
    this.panel = document.getElementById('gitPanel');
    this.pullBackups = [];
    this.status = null;
    this.active = false;
    this.refreshTimer = null;
    this.searchQuery = '';
    this.panelMode = 'changes';
    this.collapsedSections = new Set();
    this.selection = {
      commitHash: null,
      path: null,
      scope: null,
      source: 'workspace',
    };
    this.pendingActionKey = null;
    this.history = {
      commits: [],
      error: '',
      hasMore: false,
      loaded: false,
      loading: false,
      loadingMore: false,
      offset: 0,
    };
  }

  initialize() {
    this.panel?.addEventListener('click', (event) => {
      const modeButton = event.target instanceof Element
        ? event.target.closest('[data-git-panel-mode]')
        : null;
      if (modeButton) {
        const nextMode = modeButton.getAttribute('data-git-panel-mode');
        if (nextMode === 'changes' || nextMode === 'history') {
          void this.setMode(nextMode);
        }
        return;
      }

      const toggleButton = event.target instanceof Element
        ? event.target.closest('[data-git-section-toggle]')
        : null;
      if (toggleButton) {
        const sectionKey = toggleButton.getAttribute('data-git-section-toggle');
        this.toggleSection(sectionKey);
        return;
      }

      const historyButton = event.target instanceof Element
        ? event.target.closest('[data-git-commit-hash]')
        : null;
      if (historyButton && !event.target.closest('[data-git-history-load-more]')) {
        const hash = historyButton.getAttribute('data-git-commit-hash');
        if (!hash) {
          return;
        }
        this.onSelectCommit(hash, { path: this.selection.commitHash === hash ? this.selection.path : null });
        return;
      }

      const loadMoreButton = event.target instanceof Element
        ? event.target.closest('[data-git-history-load-more]')
        : null;
      if (loadMoreButton) {
        void this.loadMoreHistory();
        return;
      }

      const fileButton = event.target instanceof Element
        ? event.target.closest('[data-git-path]')
        : null;
      if (fileButton && !event.target.closest('[data-git-file-action]')) {
        const filePath = fileButton.getAttribute('data-git-path');
        const scope = fileButton.getAttribute('data-git-scope') || 'working-tree';
        if (!filePath) {
          return;
        }
        this.onSelectDiff(filePath, { scope });
        return;
      }

      const pullBackupButton = event.target instanceof Element
        ? event.target.closest('[data-git-pull-backup-path]')
        : null;
      if (pullBackupButton) {
        const summaryPath = pullBackupButton.getAttribute('data-git-pull-backup-path');
        if (!summaryPath) {
          return;
        }
        this.onOpenPullBackup(summaryPath);
        return;
      }

      const actionButton = event.target instanceof Element
        ? event.target.closest('[data-git-file-action]')
        : null;
      if (actionButton) {
        const action = actionButton.getAttribute('data-git-file-action');
        const filePath = actionButton.getAttribute('data-git-path');
        const scope = actionButton.getAttribute('data-git-scope') || 'working-tree';
        if (!action || !filePath) {
          return;
        }

        event.preventDefault();
        event.stopPropagation();
        void this.handleFileAction(action, filePath, scope);
        return;
      }

      const viewAllButton = event.target instanceof Element
        ? event.target.closest('[data-git-view-all]')
        : null;
      if (viewAllButton) {
        this.onViewAllDiff();
        return;
      }

      const commitStagedButton = event.target instanceof Element
        ? event.target.closest('[data-git-commit-staged]')
        : null;
      if (commitStagedButton) {
        void this.handleCommitStaged();
        return;
      }

      const syncButton = event.target instanceof Element
        ? event.target.closest('[data-git-sync-action]')
        : null;
      if (syncButton) {
        const action = syncButton.getAttribute('data-git-sync-action');
        if (action === 'pull' || action === 'push') {
          void this.handleSyncAction(action);
        }
      }
    });

    this.searchInput?.addEventListener('input', (event) => {
      this.searchQuery = String(event.target?.value ?? '').trim().toLowerCase();
      this.render();
    });
    this.syncSearchUi();
  }

  setActive(active) {
    const nextActive = Boolean(active);
    if (this.active === nextActive && (!nextActive || this.refreshTimer || this.panelMode === 'history')) {
      return;
    }

    this.active = nextActive;
    if (!this.active) {
      this.stopStatusPolling();
      return;
    }

    this.syncSearchUi();
    void this.refresh({ force: false, includeHistory: this.panelMode === 'history' });
    if (this.panelMode === 'changes') {
      this.ensureStatusPolling();
    } else {
      this.stopStatusPolling();
    }
  }

  async setMode(mode, { forceHistoryRefresh = false } = {}) {
    const normalizedMode = mode === 'history' ? 'history' : 'changes';
    const modeChanged = this.panelMode !== normalizedMode;
    this.panelMode = normalizedMode;
    this.syncSearchUi();
    this.render();

    if (!this.active) {
      return;
    }

    if (this.panelMode === 'changes') {
      this.ensureStatusPolling();
      if (modeChanged) {
        await this.refresh({ force: false, includeHistory: false });
      }
      return;
    }

    this.stopStatusPolling();
    if (forceHistoryRefresh || modeChanged || !this.history.loaded) {
      await this.refreshHistory({ force: forceHistoryRefresh || modeChanged });
    }
  }

  setSelection({
    commitHash = null,
    path = null,
    scope = null,
    source = 'workspace',
  } = {}) {
    this.selection = {
      commitHash,
      path,
      scope,
      source,
    };
    if (source === 'commit' || commitHash) {
      this.panelMode = 'history';
      this.syncSearchUi();
    }
    this.render();
  }

  toggleSection(sectionKey) {
    if (!sectionKey) {
      return;
    }

    if (this.collapsedSections.has(sectionKey)) {
      this.collapsedSections.delete(sectionKey);
    } else {
      this.collapsedSections.add(sectionKey);
    }
    this.render();
  }

  ensureStatusPolling() {
    if (this.refreshTimer || !this.active || this.panelMode !== 'changes') {
      return;
    }
    this.refreshTimer = setInterval(() => {
      void this.refresh({ force: false, includeHistory: false });
    }, REFRESH_INTERVAL_MS);
  }

  stopStatusPolling() {
    clearInterval(this.refreshTimer);
    this.refreshTimer = null;
  }

  syncSearchUi() {
    if (!this.searchInput) {
      return;
    }
    this.searchInput.setAttribute(
      'placeholder',
      this.panelMode === 'history' ? 'Filter loaded commits...' : 'Search changes...',
    );
    this.searchInput.setAttribute(
      'aria-label',
      this.panelMode === 'history' ? 'Filter loaded commits' : 'Search changed files',
    );
  }

  async refresh({ force = false, includeHistory = this.panelMode === 'history' } = {}) {
    const status = await this.refreshStatus({ force });
    if (includeHistory && status.isGitRepo) {
      await this.refreshHistory({ force });
    }
    return status;
  }

  async refreshStatus({ force = false } = {}) {
    if (!this.enabled) {
      this.status = {
        isGitRepo: false,
        sections: [],
        summary: { changedFiles: 0 },
      };
      this.pullBackups = [];
      this.history = {
        ...this.history,
        commits: [],
        error: '',
        hasMore: false,
        loaded: false,
        loading: false,
        loadingMore: false,
        offset: 0,
      };
      this.onRepoChange(false, this.status);
      this.render();
      return this.status;
    }

    try {
      const response = await fetch(resolveApiUrl(`/git/status${force ? '?force=true' : ''}`));
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git status');
      }

      this.status = data;
      this.pullBackups = [];
      if (data.isGitRepo) {
        try {
          const backupResponse = await fetch(resolveApiUrl('/git/pull-backups'));
          const backupData = await backupResponse.json();
          if (!backupResponse.ok) {
            throw new Error(backupData.error || 'Failed to load pull backups');
          }
          this.pullBackups = Array.isArray(backupData.backups) ? backupData.backups : [];
        } catch (backupError) {
          console.error('[git-panel] Failed to load pull backups:', backupError);
        }
      } else {
        this.history = {
          ...this.history,
          commits: [],
          error: '',
          hasMore: false,
          loaded: false,
          loading: false,
          loadingMore: false,
          offset: 0,
        };
      }
      this.onRepoChange(Boolean(data.isGitRepo), data);
      this.render();
      return data;
    } catch (error) {
      console.error('[git-panel] Failed to load git status:', error);
      this.toastController?.show('Failed to load git status');
      this.status = {
        isGitRepo: false,
        sections: [],
        summary: { changedFiles: 0 },
      };
      this.pullBackups = [];
      this.history = {
        ...this.history,
        commits: [],
        error: '',
        hasMore: false,
        loaded: false,
        loading: false,
        loadingMore: false,
        offset: 0,
      };
      this.onRepoChange(false, this.status);
      this.render();
      return this.status;
    }
  }

  async refreshHistory({ force = false } = {}) {
    if (!this.status?.isGitRepo) {
      this.history = {
        ...this.history,
        commits: [],
        error: '',
        hasMore: false,
        loaded: false,
        loading: false,
        loadingMore: false,
        offset: 0,
      };
      this.render();
      return this.history;
    }

    if (this.history.loading && !force) {
      return this.history;
    }

    this.history = {
      ...this.history,
      error: '',
      loading: true,
      loadingMore: false,
    };
    if (force) {
      this.history = {
        ...this.history,
        commits: [],
        hasMore: false,
        loaded: false,
        offset: 0,
      };
    }
    this.render();

    try {
      const query = new URLSearchParams();
      query.set('limit', String(HISTORY_PAGE_SIZE));
      query.set('offset', '0');
      const response = await fetch(resolveApiUrl(`/git/history?${query.toString()}`));
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git history');
      }

      this.history = {
        commits: Array.isArray(data.commits) ? data.commits : [],
        error: '',
        hasMore: Boolean(data.hasMore),
        loaded: true,
        loading: false,
        loadingMore: false,
        offset: Array.isArray(data.commits) ? data.commits.length : 0,
      };
      this.render();
      return this.history;
    } catch (error) {
      console.error('[git-panel] Failed to load git history:', error);
      this.toastController?.show('Failed to load git history');
      this.history = {
        ...this.history,
        error: 'Failed to load git history',
        loading: false,
        loadingMore: false,
      };
      this.render();
      return this.history;
    }
  }

  async loadMoreHistory() {
    if (
      !this.status?.isGitRepo
      || this.history.loading
      || this.history.loadingMore
      || !this.history.hasMore
    ) {
      return;
    }

    this.history = {
      ...this.history,
      error: '',
      loadingMore: true,
    };
    this.render();

    try {
      const query = new URLSearchParams();
      query.set('limit', String(HISTORY_PAGE_SIZE));
      query.set('offset', String(this.history.offset));
      const response = await fetch(resolveApiUrl(`/git/history?${query.toString()}`));
      const data = await response.json();
      if (!response.ok) {
        throw new Error(data.error || 'Failed to load git history');
      }

      const nextCommits = Array.isArray(data.commits) ? data.commits : [];
      this.history = {
        commits: [...this.history.commits, ...nextCommits],
        error: '',
        hasMore: Boolean(data.hasMore),
        loaded: true,
        loading: false,
        loadingMore: false,
        offset: this.history.offset + nextCommits.length,
      };
      this.render();
    } catch (error) {
      console.error('[git-panel] Failed to load more git history:', error);
      this.toastController?.show('Failed to load git history');
      this.history = {
        ...this.history,
        error: 'Failed to load git history',
        loadingMore: false,
      };
      this.render();
    }
  }

  filterFiles(files = []) {
    if (!this.searchQuery) {
      return files;
    }

    return files.filter((file) => (
      file.path.toLowerCase().includes(this.searchQuery)
      || String(file.oldPath || '').toLowerCase().includes(this.searchQuery)
    ));
  }

  filterCommits(commits = []) {
    if (!this.searchQuery) {
      return commits;
    }

    return commits.filter((commit) => (
      String(commit.subject || '').toLowerCase().includes(this.searchQuery)
      || String(commit.shortHash || '').toLowerCase().includes(this.searchQuery)
      || String(commit.authorName || '').toLowerCase().includes(this.searchQuery)
    ));
  }

  async handleFileAction(action, filePath, scope) {
    const actionKey = `${action}:${scope}:${filePath}`;
    if (this.pendingActionKey === actionKey) {
      return;
    }

    this.pendingActionKey = actionKey;
    this.render();

    try {
      if (action === 'stage') {
        await this.onStageFile(filePath, { scope });
      } else if (action === 'unstage') {
        await this.onUnstageFile(filePath, { scope });
      } else if (action === 'reset') {
        await this.onResetFile(filePath, { scope });
      }
    } finally {
      this.pendingActionKey = null;
      this.render();
    }
  }

  async handleCommitStaged() {
    const actionKey = 'commit-staged';
    if (this.pendingActionKey === actionKey) {
      return;
    }

    this.pendingActionKey = actionKey;
    this.render();

    try {
      await this.onCommitStaged();
    } finally {
      this.pendingActionKey = null;
      this.render();
    }
  }

  async handleSyncAction(action) {
    const actionKey = `sync:${action}`;
    if (this.pendingActionKey === actionKey) {
      return;
    }

    this.pendingActionKey = actionKey;
    this.render();

    try {
      if (action === 'pull') {
        await this.onPullBranch();
      } else if (action === 'push') {
        await this.onPushBranch();
      }
    } finally {
      this.pendingActionKey = null;
      this.render();
    }
  }

  renderSection(section) {
    const files = this.filterFiles(section.files);
    if (files.length === 0) {
      return '';
    }

    const isCollapsed = this.collapsedSections.has(section.key);

    return `
      <section class="git-section">
        <button class="git-section-header" type="button" data-git-section-toggle="${escapeHtml(section.key)}">
          ${chevronSvg(isCollapsed)}
          ${escapeHtml(section.label)}
          <span class="ui-pill-badge ui-pill-badge--count ui-pill-badge--muted git-section-count">${files.length}</span>
        </button>
        <div class="git-file-list${isCollapsed ? ' hidden' : ''}">
          ${files.map((file) => this.renderFile(file)).join('')}
        </div>
      </section>
    `;
  }

  renderPullBackupsSection() {
    if (!Array.isArray(this.pullBackups) || this.pullBackups.length === 0) {
      return '';
    }

    return `
      <section class="git-section">
        <button class="git-section-header" type="button" data-git-section-toggle="pull-backups">
          ${chevronSvg(this.collapsedSections.has('pull-backups'))}
          Pull Backups
          <span class="ui-pill-badge ui-pill-badge--count ui-pill-badge--muted git-section-count">${this.pullBackups.length}</span>
        </button>
        <div class="git-file-list${this.collapsedSections.has('pull-backups') ? ' hidden' : ''}">
          ${this.pullBackups.map((backup) => this.renderPullBackup(backup)).join('')}
        </div>
      </section>
    `;
  }

  renderPullBackup(backup) {
    const createdAt = String(backup?.createdAt || '').replace('T', ' ').replace(/\.\d+Z?$/u, 'Z');
    const fileCount = Number(backup?.fileCount || 0);

    return `
      <div class="ui-item-row git-file-row">
        <button
          class="ui-item-main git-file-item"
          type="button"
          data-git-pull-backup-path="${escapeHtml(backup.summaryPath || '')}"
        >
          ${fileIconSvg()}
          <span class="ui-item-copy git-file-copy">
            <span class="ui-item-title git-file-name">Pull backup ${escapeHtml(backup.id || '')}</span>
            <span class="ui-item-subtitle git-file-path">${escapeHtml(`${createdAt} · ${backup.branch || 'HEAD'} · ${fileCount} file${fileCount === 1 ? '' : 's'}`)}</span>
          </span>
          <span class="ui-status-badge ui-status-badge--warning">BK</span>
        </button>
      </div>
    `;
  }

  renderFile(file) {
    const isActive = this.selection.source === 'workspace'
      && this.selection.path === file.path
      && this.selection.scope === file.scope;
    const dirPath = getPathDir(file.path);
    const displayName = getPathLeaf(file.path);
    const statusClass = badgeClass(file.status);
    const stageAction = file.scope === 'staged'
      ? { label: 'Unstage', value: 'unstage' }
      : { label: 'Stage', value: 'stage' };
    const actionKey = `${stageAction.value}:${file.scope}:${file.path}`;
    const isPending = this.pendingActionKey === actionKey;
    const resetActionKey = `reset:${file.scope}:${file.path}`;
    const isResetPending = this.pendingActionKey === resetActionKey;

    return `
      <div class="ui-item-row git-file-row${isActive ? ' active' : ''}">
        <button
          class="ui-item-main git-file-item${isActive ? ' active' : ''}"
          type="button"
          data-git-path="${escapeHtml(file.path)}"
          data-git-scope="${escapeHtml(file.scope)}"
        >
          ${fileIconSvg()}
          <span class="ui-item-copy git-file-copy">
            <span class="ui-item-title git-file-name">${escapeHtml(displayName)}</span>
            ${dirPath ? `<span class="ui-item-subtitle git-file-path">${escapeHtml(dirPath)}</span>` : ''}
          </span>
          <span class="ui-status-badge ${statusClass}">${escapeHtml(file.code)}</span>
        </button>
        <div class="ui-item-actions git-file-actions">
          <button
            class="ui-icon-button ui-action-icon ui-action-icon--surface"
            type="button"
            data-git-file-action="reset"
            data-git-path="${escapeHtml(file.path)}"
            data-git-scope="${escapeHtml(file.scope)}"
            aria-label="Reset ${escapeHtml(displayName)}"
            title="Reset to current branch"
            ${isResetPending ? 'disabled' : ''}
          >
            ${isResetPending ? '...' : actionIconSvg('reset')}
          </button>
          <button
            class="ui-icon-button ui-action-icon ui-action-icon--surface"
            type="button"
            data-git-file-action="${stageAction.value}"
            data-git-path="${escapeHtml(file.path)}"
            data-git-scope="${escapeHtml(file.scope)}"
            aria-label="${escapeHtml(stageAction.label)} ${escapeHtml(displayName)}"
            title="${escapeHtml(stageAction.label)}"
            ${isPending ? 'disabled' : ''}
          >
            ${isPending ? '...' : actionIconSvg(stageAction.value)}
          </button>
        </div>
      </div>
    `;
  }

  renderPanelModes() {
    return `
      <div class="ui-segmented-control ui-segmented-control--pill git-panel-mode-switch" role="tablist" aria-label="Git panel modes">
        <button
          class="ui-segmented-btn git-panel-mode-btn${this.panelMode === 'changes' ? ' active' : ''}"
          type="button"
          data-git-panel-mode="changes"
          aria-selected="${this.panelMode === 'changes'}"
        >
          Changes
        </button>
        <button
          class="ui-segmented-btn git-panel-mode-btn${this.panelMode === 'history' ? ' active' : ''}"
          type="button"
          data-git-panel-mode="history"
          aria-selected="${this.panelMode === 'history'}"
        >
          History
        </button>
      </div>
    `;
  }

  renderHistoryRow(commit) {
    const isActive = this.selection.source === 'commit' && this.selection.commitHash === commit.hash;
    const fileCount = Number(commit.filesChanged || 0);

    return `
      <button
        class="ui-record-surface git-history-row${isActive ? ' active' : ''}"
        type="button"
        data-git-commit-hash="${escapeHtml(commit.hash || '')}"
        title="${escapeHtml(commit.authoredAt || '')}"
      >
        <span class="ui-record-header git-history-row-top">
          <span class="ui-record-title git-history-subject">${renderHistoryRowTitle(commit)}</span>
          <span class="ui-pill-badge ui-pill-badge--code git-history-hash">${escapeHtml(commit.shortHash || '')}</span>
        </span>
        <span class="ui-record-meta git-history-row-meta">
          <span>${escapeHtml(commit.authorName || 'Unknown')}</span>
          <span>${escapeHtml(commit.relativeDateLabel || '')}</span>
          <span>${fileCount} file${fileCount === 1 ? '' : 's'}</span>
          ${commit.isMergeCommit ? '<span>Merge</span>' : ''}
        </span>
        <span class="ui-record-meta git-history-row-stats">
          <span class="git-change-add">+${Number(commit.additions || 0)}</span>
          <span class="git-change-del">-${Number(commit.deletions || 0)}</span>
        </span>
      </button>
    `;
  }

  renderHistoryPanel() {
    const commits = this.filterCommits(this.history.commits);

    if (this.history.loading && !this.history.loaded) {
      return '<div class="git-panel-empty">Loading git history...</div>';
    }

    if (this.history.error && !this.history.loaded) {
      return `<div class="git-panel-empty">${escapeHtml(this.history.error)}</div>`;
    }

    if (this.history.loaded && commits.length === 0 && this.history.commits.length === 0) {
      return '<div class="git-panel-empty">No commits yet on this branch.</div>';
    }

    if (this.history.loaded && commits.length === 0) {
      return '<div class="git-panel-empty">No loaded commits match your filter.</div>';
    }

    return `
      <div class="git-history-list">
        ${commits.map((commit) => this.renderHistoryRow(commit)).join('')}
      </div>
      ${this.history.hasMore ? `
        <div class="git-history-footer">
            <button
              class="ui-button ui-button--compact ui-action-button ui-action-button--surface btn btn-secondary git-history-load-more"
            type="button"
            data-git-history-load-more
            ${this.history.loadingMore ? 'disabled' : ''}
          >
            ${this.history.loadingMore ? 'Loading...' : 'Load More'}
          </button>
        </div>
      ` : ''}
    `;
  }

  renderChangesPanel() {
    const pullBackupsMarkup = this.renderPullBackupsSection();
    const sectionMarkup = (this.status.sections ?? [])
      .map((section) => this.renderSection(section))
      .filter(Boolean)
      .join('');
    const hasChanges = Boolean(this.status.summary?.changedFiles);
    const hasStagedChanges = Number(this.status.summary?.staged || 0) > 0;
    const isCommitPending = this.pendingActionKey === 'commit-staged';

    return `
      ${pullBackupsMarkup}
      ${sectionMarkup || '<div class="git-panel-empty">No local changes</div>'}
      ${hasChanges ? `
        <div class="git-panel-footer">
          <div class="git-panel-footer-actions">
            <button class="ui-button ui-button--compact ui-action-button ui-action-button--surface btn btn-secondary" type="button" data-git-view-all>
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><path d="M2 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>
              View Full Diff
            </button>
            <button
              class="ui-button ui-action-button ui-action-button--wide btn btn-primary git-footer-commit-btn"
              type="button"
              data-git-commit-staged
              ${!hasStagedChanges || isCommitPending ? 'disabled' : ''}
            >
              ${isCommitPending ? 'Working...' : 'Commit Staged'}
            </button>
          </div>
        </div>
      ` : ''}
    `;
  }

  renderEmpty(message) {
    if (!this.panel) {
      return;
    }

    this.panel.innerHTML = `<div class="git-panel-empty">${escapeHtml(message)}</div>`;
  }

  render() {
    if (!this.panel) {
      return;
    }

    if (!this.status) {
      this.renderEmpty('Loading git status...');
      return;
    }

    if (!this.status.isGitRepo) {
      this.renderEmpty('Git is unavailable for this vault.');
      return;
    }

    const branch = this.status.branch ?? {};
    const hasUpstream = Boolean(branch.upstream);
    const isPullPending = this.pendingActionKey === 'sync:pull';
    const isPushPending = this.pendingActionKey === 'sync:push';

    this.panel.innerHTML = `
      <div class="git-branch-bar">
        <div class="git-branch-meta">
          <span class="git-branch-name">
            ${branchIconSvg()}
            ${escapeHtml(branch.name || 'HEAD')}
          </span>
          ${renderBranchMetrics(this.status.summary, branch)}
        </div>
        <div class="git-branch-actions" role="group" aria-label="Remote sync actions">
          <button
            class="ui-button ui-button--compact ui-pill-button ui-action-pill ui-action-pill--surface btn btn-secondary"
            type="button"
            data-git-sync-action="pull"
            title="${hasUpstream ? 'Pull remote changes (fast-forward only)' : 'No upstream branch configured'}"
            aria-label="Pull branch"
            ${!hasUpstream || isPullPending ? 'disabled' : ''}
          >
            ${isPullPending ? '...' : `${actionIconSvg('pull')}<span>Pull</span>`}
          </button>
          <button
            class="ui-button ui-button--compact ui-pill-button ui-action-pill ui-action-pill--surface btn btn-secondary"
            type="button"
            data-git-sync-action="push"
            title="${hasUpstream ? 'Push local commits' : 'No upstream branch configured'}"
            aria-label="Push branch"
            ${!hasUpstream || isPushPending ? 'disabled' : ''}
          >
            ${isPushPending ? '...' : `${actionIconSvg('push')}<span>Push</span>`}
          </button>
        </div>
        ${this.renderPanelModes()}
      </div>
      ${this.panelMode === 'history' ? this.renderHistoryPanel() : this.renderChangesPanel()}
    `;
  }
}
