import { createWorkspaceChange } from '../../../domain/workspace-change.js';
import { createWorkspaceRequestId } from '../../domain/workspace-request-id.js';

function normalizeWorkspaceChange(workspaceChange = {}) {
  return createWorkspaceChange(workspaceChange);
}

export const gitFeature = {
  formatPullBackupToast(pullBackup = null) {
    const fileCount = Number(pullBackup?.fileCount || 0);
    if (fileCount === 1) {
      return 'Pulled latest changes. 1 overlapping local file was backed up.';
    }
    if (fileCount > 1) {
      return `Pulled latest changes. ${fileCount} overlapping local files were backed up.`;
    }
    return 'Pulled latest changes. Overlapping local changes were recorded in a pull backup.';
  },

  setGitOperationStatus(message = '') {
    const badge = this.elements.gitOperationStatus;
    if (!badge) {
      return;
    }

    const text = String(message ?? '').trim();
    badge.textContent = text;
    badge.classList.toggle('hidden', !text);
  },

  async runGitActionWithStatus(message, callback) {
    this.setGitOperationStatus(message);
    try {
      return await callback();
    } finally {
      this.setGitOperationStatus('');
    }
  },

  handleGitDiffSelection(filePath, { closeSidebarOnMobile = false, scope = 'working-tree' } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    this.navigation.navigateToGitDiff({ filePath, scope });
  },

  handleGitCommitSelection(hash, { closeSidebarOnMobile = false, historyFilePath = null, path = null } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    this.navigation.navigateToGitCommit({ hash, historyFilePath, path });
  },

  handleGitHistorySelection({ closeSidebarOnMobile = false } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    this.navigation.navigateToGitHistory();
  },

  handleGitFileHistorySelection(filePath = this.currentFilePath, { closeSidebarOnMobile = false } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    if (!filePath) {
      return;
    }

    this.navigation.navigateToGitFileHistory({ filePath });
  },

  handleGitFilePreviewSelection({ hash, path, currentFilePath = null, closeSidebarOnMobile = false } = {}) {
    if (closeSidebarOnMobile) {
      this.closeSidebarOnMobile();
    }

    if (!hash || !path) {
      return;
    }

    this.navigation.navigateToGitFilePreview({ hash, path, currentFilePath });
  },

  handleGitRepoChange(isGitRepo, status = null) {
    this.gitRepoAvailable = Boolean(isGitRepo);
    this.elements.sidebarTabs?.classList.toggle('hidden', !this.gitRepoAvailable);
    this.elements.gitSidebarTab?.classList.toggle('hidden', !this.gitRepoAvailable);
    
    const hasChanges = isGitRepo && status?.summary?.changedFiles > 0;
    this.elements.gitSidebarTab?.classList.toggle('has-changes', hasChanges);
    
    this.gitDiffView.setRepoStatus(this.gitRepoAvailable ? status : null);

    if (!this.gitRepoAvailable && this.activeSidebarTab === 'git') {
      this.syncFileHistoryButton({ mode: this.navigation.getHashRoute().type === 'git-file-preview' ? 'history-preview' : 'editor' });
      this.setSidebarTab('files');
      return;
    }

    const routeType = this.navigation.getHashRoute().type;
    if (
      this.gitRepoAvailable
      && (routeType === 'git-diff' || routeType === 'git-commit' || routeType === 'git-history')
      && this.activeSidebarTab !== 'git'
    ) {
      this.setSidebarTab('git');
    }

    this.syncFileHistoryButton({
      filePath: this.currentFilePath,
      mode: routeType === 'git-file-preview'
        ? 'history-preview'
        : routeType === 'file'
          ? 'editor'
          : 'empty',
    });
  },

  syncFileHistoryButton({ filePath = this.currentFilePath, mode = 'editor' } = {}) {
    const button = this.elements.fileHistoryButton;
    const label = this.elements.fileHistoryButtonLabel;
    if (!button || !label) {
      return;
    }

    const supported = this.gitRepoAvailable && this.supportsFileHistory?.(filePath);
    if (!supported) {
      button.classList.add('hidden');
      return;
    }

    button.classList.remove('hidden');
    if (mode === 'history-preview') {
      label.textContent = 'Back to History';
      button.setAttribute('aria-label', 'Back to file history');
      button.title = 'Back to file history';
      return;
    }

    if (mode !== 'editor') {
      button.classList.add('hidden');
      return;
    }

    label.textContent = 'History';
    button.setAttribute('aria-label', 'Open file history');
    button.title = 'View file history';
  },

  syncMainChrome({ badgeLabel = '', mode, title = null } = {}) {
    const isSpecialMode = mode === 'diff' || mode === 'history' || mode === 'history-preview';
    this.elements.toolbarCenter?.classList.toggle('hidden', isSpecialMode);
    this.elements.mobileViewToggle?.classList.toggle('hidden', isSpecialMode);
    this.elements.userCount?.classList.toggle('hidden', isSpecialMode);
    this.elements.toolbarDiffBadge?.classList.toggle('hidden', !badgeLabel);
    if (this.elements.toolbarDiffBadge) {
      this.elements.toolbarDiffBadge.textContent = badgeLabel;
    }

    if (title && this.elements.activeFileName) {
      this.elements.activeFileName.textContent = title;
    }

    this.syncFileHistoryButton({ filePath: this.currentFilePath, mode });
  },

  async showGitDiff({ filePath = null, scope = 'all' } = {}) {
    this.clearStaticPreviewDocument?.();
    this.gitPanel.setSelection(filePath ? { path: filePath, scope, source: 'workspace' } : {});
    this.gitPanel.setMode('changes');
    this.showDiffState();
    this.syncMainChrome({
      badgeLabel: 'Diff',
      mode: 'diff',
      title: this.gitDiffView.getToolbarTitle({ filePath, scope }),
    });
    this.syncFileHistoryButton({ filePath, mode: 'diff' });
    await this.gitDiffView.openWorkspaceDiff({ filePath, scope });
  },

  async showGitCommit({ hash, path = null, historyFilePath = null } = {}) {
    this.clearStaticPreviewDocument?.();
    this.gitPanel.setMode('history');
    this.gitPanel.setSelection(hash ? { commitHash: hash, path, source: 'commit' } : { source: 'commit' });
    this.showDiffState();
    this.syncMainChrome({
      badgeLabel: 'Diff',
      mode: 'diff',
      title: this.gitDiffView.getToolbarTitle({ commitHash: hash, path, source: 'commit' }),
    });
    this.syncFileHistoryButton({ filePath: path, mode: 'diff' });
    await this.gitDiffView.openCommitDiff({ hash, historyFilePath, path });
  },

  async showGitHistory() {
    this.clearStaticPreviewDocument?.();
    this.gitPanel.setMode('history');
    this.gitPanel.setSelection({ source: 'commit' });
    this.workspaceRouteController?.showEmptyState?.();
    this.syncMainChrome({
      mode: 'empty',
      title: 'Git History',
    });
    this.syncFileHistoryButton({ mode: 'empty' });
  },

  async showGitFileHistory({ filePath = null } = {}) {
    if (!filePath) {
      this.workspaceRouteController?.showEmptyState?.();
      return;
    }

    this.clearStaticPreviewDocument?.();
    this.commentUi?.attachSession?.(null);
    this.commentUi?.setCurrentFile?.(filePath, {
      fileKind: this.getCommentFileKind(filePath),
      supported: false,
    });
    this.handleCommentThreadsChange?.([]);
    this.handleCommentSelectionChange?.(null);
    this.workspaceRouteController?.showFileHistoryState?.(filePath);
    this.syncMainChrome({
      badgeLabel: 'History',
      mode: 'history',
      title: this.getDisplayName(filePath),
    });
    this.syncFileHistoryButton({ filePath, mode: 'history' });
    await this.fileHistoryView.openFileHistory({ filePath });
  },

  async _loadGitFileSnapshot({ hash, filePath, resolvedCurrentFilePath }) {
    const data = await this.gitApiClient.readFileSnapshot({
      hash,
      path: filePath,
    });
    this.setStaticPreviewDocument?.({
      ...data,
      currentFilePath: resolvedCurrentFilePath,
    });
    this.resetPreviewMode();
    this.elements.markdownToolbar?.classList.add('hidden');
    this.elements.outlineToggle?.classList.toggle('hidden', data.fileKind !== 'markdown');

    if (data.fileKind === 'markdown' || data.fileKind === 'mermaid' || data.fileKind === 'plantuml') {
      if (data.fileKind === 'mermaid') {
        this.elements.previewContent?.classList.add('is-mermaid-file-preview');
      } else if (data.fileKind === 'plantuml') {
        this.elements.previewContent?.classList.add('is-plantuml-file-preview');
      }
      this.previewRenderer.beginDocumentLoad();
      this.previewRenderer.queueRender();
      return;
    }

    this.elements.outlineToggle?.classList.add('hidden');
    this.renderTextFilePreview?.({
      content: data.content,
      filePath: resolvedCurrentFilePath,
    });
  },

  _handleGitFilePreviewError(error, resolvedCurrentFilePath) {
    console.error('[git-preview] Failed to load file snapshot:', error);
    this.clearStaticPreviewDocument?.();
    this.toastController.show('Failed to load historical file preview');
    this.renderTextFilePreview?.({
      content: 'Failed to load historical file preview.',
      filePath: resolvedCurrentFilePath,
    });
    this.elements.outlineToggle?.classList.add('hidden');
  },

  async showGitFilePreview({ hash, filePath = null, currentFilePath = null } = {}) {
    const resolvedCurrentFilePath = String(currentFilePath ?? '').trim() || filePath;
    if (!hash || !filePath || !resolvedCurrentFilePath) {
      this.workspaceRouteController?.showEmptyState?.();
      return;
    }

    this.commentUi?.attachSession?.(null);
    this.commentUi?.setCurrentFile?.(resolvedCurrentFilePath, {
      fileKind: this.getCommentFileKind(resolvedCurrentFilePath),
      supported: false,
    });
    this.handleCommentThreadsChange?.([]);
    this.handleCommentSelectionChange?.(null);
    this.workspaceRouteController?.showPreviewOnlyState?.(resolvedCurrentFilePath);
    this.layoutController.setView('preview', { persist: false });
    this.syncMainChrome({
      badgeLabel: 'History Preview',
      mode: 'history-preview',
      title: this.getDisplayName(resolvedCurrentFilePath),
    });
    this.syncFileHistoryButton({ filePath: resolvedCurrentFilePath, mode: 'history-preview' });

    try {
      await this._loadGitFileSnapshot({ hash, filePath, resolvedCurrentFilePath });
    } catch (error) {
      this._handleGitFilePreviewError(error, resolvedCurrentFilePath);
    }
  },

  async postGitAction(actionName, payload) {
    const requestId = createWorkspaceRequestId();
    this.pendingWorkspaceRequestIds?.add(requestId);
    try {
      switch (actionName) {
        case 'stage':
          return await this.gitApiClient.stageFile({ path: payload.path, requestId });
        case 'unstage':
          return await this.gitApiClient.unstageFile({ path: payload.path, requestId });
        case 'push':
          return await this.gitApiClient.pushBranch({ requestId });
        case 'pull':
          return await this.gitApiClient.pullBranch({ requestId });
        case 'reset-file':
          return await this.gitApiClient.resetFile({ path: payload.path, requestId });
        case 'commit':
          return await this.gitApiClient.commit({ message: payload.message, requestId });
        default:
          throw new Error(`Unsupported git action: ${actionName}`);
      }
    } catch (error) {
      this.pendingWorkspaceRequestIds?.delete(requestId);
      throw error;
    }
  },

  async refreshWorkspaceAfterGitAction({ filePath = null, preferredScope = null } = {}) {
    await this.fileExplorer.refresh();
    await this.refreshGitAfterAction({ filePath, preferredScope });
  },

  async refreshGitAfterAction({ filePath = null, preferredScope = null } = {}) {
    await this.gitPanel.refresh({ force: true });

    const route = this.navigation.getHashRoute();
    if (route.type === 'git-history') {
      await this.showGitHistory();
      return;
    }

    if (route.type === 'git-file-history') {
      await this.showGitFileHistory({ filePath: route.filePath });
      return;
    }

    if (route.type === 'git-file-preview') {
      await this.showGitFilePreview({
        hash: route.hash,
        filePath: route.filePath,
        currentFilePath: route.currentFilePath,
      });
      return;
    }

    if (route.type === 'git-commit') {
      await this.showGitCommit({ hash: route.hash, path: route.path, historyFilePath: route.historyFilePath });
      return;
    }

    if (route.type !== 'git-diff') {
      return;
    }

    const nextFilePath = filePath ?? route.filePath;
    const nextScope = preferredScope ?? route.scope;
    if (nextScope !== route.scope || nextFilePath !== route.filePath) {
      this.navigation.navigateToGitDiff({ filePath: nextFilePath, scope: nextScope });
      return;
    }

    await this.showGitDiff({ filePath: route.filePath, scope: route.scope });
  },

  async finalizeGitAction({
    action,
    filePath = null,
    preferredScope = null,
    result = {},
    showLocalFileToast = false,
  } = {}) {
    const workspaceChange = normalizeWorkspaceChange(result.workspaceChange);
    await this.refreshWorkspaceAfterGitAction({ filePath, preferredScope });
    this.handleWorkspaceChangeForCurrentFile(workspaceChange, { action, local: true, showToast: showLocalFileToast });
    return workspaceChange;
  },

  handleWorkspaceChangeForCurrentFile(workspaceChange, { action = 'git', local = false, showToast = true } = {}) {
    const currentFilePath = this.currentFilePath;
    if (!currentFilePath) {
      return false;
    }

    const wasDeleted = workspaceChange.deletedPaths.includes(currentFilePath);
    const renameEntry = workspaceChange.renamedPaths.find((entry) => entry.oldPath === currentFilePath);
    if (!wasDeleted && !renameEntry) {
      return false;
    }

    if (!showToast) {
      if (renameEntry) {
        this.navigation.navigateToFile(renameEntry.newPath);
      } else {
        this.navigation.navigateToFile(null);
      }
      return true;
    }

    const displayName = this.getDisplayName(currentFilePath);
    if (renameEntry) {
      this.navigation.navigateToFile(renameEntry.newPath);
      this.toastController.show(
        local
          ? `${displayName} moved to ${this.getDisplayName(renameEntry.newPath)}`
          : `${displayName} moved on disk`,
      );
      return true;
    }

    this.navigation.navigateToFile(null);
    this.toastController.show(
      local
        ? `${displayName} was removed by ${action}`
        : `${displayName} was removed after a ${action} operation`,
    );
    return true;
  },

  async handleIncomingWorkspaceEvent(event) {
    if (!this.isTabActive || !event) {
      return;
    }

    if (event.requestId && this.pendingWorkspaceRequestIds?.has(event.requestId)) {
      this.pendingWorkspaceRequestIds.delete(event.requestId);
      return;
    }

    const workspaceChange = normalizeWorkspaceChange(event.workspaceChange);
    if (event.origin === 'git') {
      await this.refreshGitAfterAction();
    }
    this.handleWorkspaceChangeForCurrentFile(workspaceChange, {
      action: event.action || event.origin || 'workspace',
      local: false,
      showToast: true,
    });

    if (
      event.origin === 'filesystem'
      && this.currentFilePath
      && workspaceChange.changedPaths.includes(this.currentFilePath)
    ) {
      const canUseInlineCue = workspaceChange.changedPaths.length === 1;
      const highlightRange = canUseInlineCue && Array.isArray(event.highlightRanges)
        ? event.highlightRanges.find((entry) => entry.path === this.currentFilePath)
        : null;
      const didFlash = highlightRange
        ? this.session?.flashExternalUpdate?.(highlightRange)
        : false;
      if (!didFlash) {
        this.toastController.show(`${this.getDisplayName(this.currentFilePath)} updated from disk`);
      }
    }

    if (
      this.currentFilePath
      && Array.isArray(event.reloadRequiredPaths)
      && event.reloadRequiredPaths.includes(this.currentFilePath)
    ) {
      this.toastController.show(`${this.getDisplayName(this.currentFilePath)} needs a manual reload`);
    }
  },

  async stageGitFile(filePath, { scope = 'working-tree' } = {}) {
    if (!filePath) {
      return;
    }

    await this.runGitActionWithStatus('Staging changes...', async () => {
      const result = await this.postGitAction('stage', { path: filePath });
      await this.finalizeGitAction({
        action: 'stage',
        filePath,
        preferredScope: scope === 'all' ? 'all' : 'staged',
        result,
      });
    });
  },

  async unstageGitFile(filePath, { scope = 'staged' } = {}) {
    if (!filePath) {
      return;
    }

    await this.runGitActionWithStatus('Unstaging changes...', async () => {
      const result = await this.postGitAction('unstage', { path: filePath });
      await this.finalizeGitAction({
        action: 'unstage',
        filePath,
        preferredScope: scope === 'all' ? 'all' : 'working-tree',
        result,
      });
    });
  },

  async pushGitBranch() {
    await this.runGitActionWithStatus('Pushing branch...', async () => {
      try {
        const result = await this.postGitAction('push', {});
        if (result.rebased) {
          this.toastController.show('Remote had new commits — rebased and pushed successfully.', 4000);
        }
        await this.finalizeGitAction({
          action: 'push',
          result,
        });
      } catch (error) {
        if (error?.code === 'push_rebase_conflict') {
          this.toastController.show('Push failed: the remote has conflicting changes. Pull first to review the differences.', 6000);
          return;
        }
        this.toastController.show(error.message || 'Failed to push branch');
      }
    });
  },

  async pullGitBranch() {
    await this.runGitActionWithStatus('Pulling branch...', async () => {
      try {
        const result = await this.postGitAction('pull', {});
        await this.finalizeGitAction({
          action: 'pull',
          result,
          showLocalFileToast: true,
        });
        if (result.pullBackup) {
          this.toastController.show(this.formatPullBackupToast(result.pullBackup), 5000);
        }
      } catch (error) {
        if (error?.code === 'pull_diverged_ff_only') {
          this.toastController.show('Cannot pull because local and remote commits have diverged. Fast-forward only pull is not possible.', 5000);
          return;
        }

        if (error?.code === 'pull_conflicted_after_autostash') {
          this.toastController.show('Pull updated the branch, but reapplying local changes caused conflicts. Review the conflicted files and the pull backup summary.', 6000);
          return;
        }

        this.toastController.show(error.message || 'Failed to pull branch');
      }
    });
  },

  openGitResetDialog(filePath) {
    if (!this.isTabActive || !filePath) {
      return;
    }

    const dialog = this.elements.gitResetDialog;
    if (!dialog || !this.elements.gitResetFileName) {
      return;
    }

    this.pendingGitResetPath = filePath;
    if (this.elements.gitResetTitle) {
      this.elements.gitResetTitle.textContent = 'Reset file to current branch';
    }
    if (this.elements.gitResetCopy) {
      this.elements.gitResetCopy.textContent = 'Restore this file from the current checked-out branch. If this branch does not contain the file, the file will be deleted locally.';
    }
    this.elements.gitResetFileName.value = filePath;
    if (this.elements.gitResetSubmit) {
      this.elements.gitResetSubmit.textContent = 'Reset File';
    }
    this.elements.gitResetSubmit?.toggleAttribute('disabled', false);

    if (dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
  },

  async handleGitResetSubmit() {
    const filePath = this.pendingGitResetPath;
    const dialog = this.elements.gitResetDialog;
    const submit = this.elements.gitResetSubmit;
    if (!filePath || !dialog) {
      return;
    }

    submit?.toggleAttribute('disabled', true);
    if (submit) {
      submit.textContent = 'Resetting...';
    }
    try {
      await this.runGitActionWithStatus('Resetting file...', async () => {
        const result = await this.postGitAction('reset-file', { path: filePath });
        await this.finalizeGitAction({
          action: 'reset',
          filePath,
          result,
          showLocalFileToast: true,
        });
      });
      dialog.close();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to reset file');
    } finally {
      if (submit) {
        submit.textContent = 'Reset File';
      }
      submit?.toggleAttribute('disabled', false);
    }
  },

  openGitCommitDialog() {
    if (!this.isTabActive) {
      return;
    }

    const dialog = this.elements.gitCommitDialog;
    const input = this.elements.gitCommitInput;
    if (!dialog || !input) {
      return;
    }

    if (this.elements.gitCommitTitle) {
      this.elements.gitCommitTitle.textContent = 'Commit staged changes';
    }
    if (this.elements.gitCommitCopy) {
      const stagedCount = Number(this.gitPanel.status?.summary?.staged || 0);
      this.elements.gitCommitCopy.textContent = stagedCount > 0
        ? `${stagedCount} staged file${stagedCount === 1 ? '' : 's'} will be included.`
        : 'All staged changes will be included.';
    }
    if (this.elements.gitCommitSubmit) {
      this.elements.gitCommitSubmit.textContent = 'Commit staged changes';
    }
    input.value = '';

    if (dialog.open) {
      return;
    }
    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }
    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  },

  async handleGitCommitSubmit() {
    const dialog = this.elements.gitCommitDialog;
    const input = this.elements.gitCommitInput;
    const submit = this.elements.gitCommitSubmit;
    const message = String(input?.value ?? '').trim();
    if (!dialog || !input) {
      return;
    }
    if (!message) {
      input.focus();
      this.toastController.show('Commit message cannot be empty');
      return;
    }

    submit?.toggleAttribute('disabled', true);
    if (submit) {
      submit.textContent = 'Committing...';
    }
    try {
      await this.runGitActionWithStatus('Committing changes...', async () => {
        const result = await this.postGitAction('commit', {
          message,
        });
        await this.finalizeGitAction({
          action: 'commit',
          result,
        });
      });
      dialog.close();
    } catch (error) {
      this.toastController.show(error.message || 'Failed to commit staged changes');
    } finally {
      if (submit) {
        submit.textContent = 'Commit staged changes';
      }
      submit?.toggleAttribute('disabled', false);
    }
  },
};
