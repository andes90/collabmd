import { supportsBacklinksForFilePath } from '../../../domain/file-kind.js';

const VERSION_RELOAD_TOAST_DURATION_MS = 0;

/**
 * @typedef {object} UiShellContext
 * @property {boolean} chatIsOpen
 * @property {boolean} gitRepoAvailable
 * @property {boolean} isTabActive
 * @property {string | null} currentFilePath
 * @property {number} lobbyChatMessageMaxLength
 * @property {any} runtimeConfig
 * @property {any} navigation
 * @property {any} session
 * @property {any} commentUi
 * @property {any} elements
 * @property {any} fileExplorer
 * @property {any} gitPanel
 * @property {any} gitDiffView
 * @property {any} fileHistoryView
 * @property {any} outlineController
 * @property {any} layoutController
 * @property {any} scrollSyncController
 * @property {any} themeController
 * @property {any} previewRenderer
 * @property {any} tabActivityLock
 * @property {any} toastController
 * @property {any} versionMonitor
 */

/** @this {UiShellContext} */
function initialize() {
  this.renderMarkdownToolbar?.();
  this.themeController.initialize();
  this.previewRenderer.applyTheme(this.themeController.getTheme());
  this.previewRenderer.scheduleWorkerPrewarm();
  this.scheduleEditorSessionPrewarm?.();
  this.outlineController.initialize();
  this.layoutController.initialize();
  this.scrollSyncController.initialize();
  this.fileExplorer.initialize();
  this.gitPanel.initialize();
  this.gitDiffView.initialize();
  this.fileHistoryView.initialize();
  this.initializePreviewLayoutObserver();
  this.syncIdentityManagementUi();
  this.syncCurrentUserName();
  this.syncWrapToggle();
  this.syncChatNotificationButton();
  this.syncFileHistoryButton({ mode: 'empty' });
  this.renderChat();
  void this.gitPanel.refresh({ force: true });
  this.elements.chatInput?.setAttribute('maxlength', String(this.lobbyChatMessageMaxLength));
  this.bindEvents();
  this.restoreSidebarState();
  this.initializeVersionMonitoring();
  this.tabActivityLock.initialize();
  this.tabActivityLock.tryActivate();

  window.addEventListener('hashchange', () => this.handleHashChange());
  window.addEventListener('resize', this.createResizeHandler());

  this.fileExplorerReadyPromise = this.fileExplorer.refresh().then(() => {
    this.fileExplorerReady = true;
    if (this.isTabActive) {
      return this.handleHashChange();
    }
    return undefined;
  });
}

/** @this {UiShellContext} */
function initializeVersionMonitoring() {
  this.versionMonitor?.start();
}

/** @this {UiShellContext} */
function promptForVersionReload(payload = null) {
  if (this._reloadPromptShown) {
    return;
  }

  this._reloadPromptShown = true;
  const packageVersion = String(payload?.build?.packageVersion ?? this.runtimeConfig?.build?.packageVersion ?? '').trim();
  const message = packageVersion
    ? `Version ${packageVersion} is available. Reload to update.`
    : 'A new version is available. Reload to update.';

  this.toastController.show(message, {
    actionLabel: 'Reload',
    dismissible: true,
    duration: VERSION_RELOAD_TOAST_DURATION_MS,
    onAction: () => window.location.reload(),
  });
}

/** @this {UiShellContext} */
function bindEvents() {
  this.elements.emptyStateNewFileBtn?.addEventListener('click', () => {
    this.fileExplorer.actionController.handleNewFile();
  });

  this.elements.emptyStateSearchBtn?.addEventListener('click', () => {
    void this.toggleQuickSwitcher();
  });

  this.elements.chatToggleButton?.addEventListener('click', () => {
    this.toggleChatPanel();
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleChatSubmit();
  });

  this.elements.chatNotificationButton?.addEventListener('click', () => {
    void this.handleChatNotificationToggle();
  });

  this.elements.shareButton?.addEventListener('click', () => {
    void this.copyCurrentLink();
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.fileHistoryButton?.addEventListener('click', () => {
    const route = this.navigation.getHashRoute();
    if (route.type === 'git-file-preview') {
      this.handleGitFileHistorySelection(route.currentFilePath ?? route.filePath, { closeSidebarOnMobile: true });
      this.closeToolbarOverflowMenu?.();
      return;
    }

    this.handleGitFileHistorySelection(this.currentFilePath, { closeSidebarOnMobile: true });
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.editNameButton?.addEventListener('click', () => {
    this.openDisplayNameDialog();
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.displayNameCancel?.addEventListener('click', () => {
    this.elements.displayNameDialog?.close();
  });

  this.elements.gitCommitCancel?.addEventListener('click', () => {
    this.elements.gitCommitDialog?.close();
  });

  this.elements.gitResetCancel?.addEventListener('click', () => {
    this.elements.gitResetDialog?.close();
  });

  this.elements.gitResetSubmit?.addEventListener('click', () => {
    void this.handleGitResetSubmit();
  });

  this.elements.gitCommitDialog?.addEventListener('close', () => {
    if (this.elements.gitCommitInput) {
      this.elements.gitCommitInput.value = '';
    }
    if (this.elements.gitCommitSubmit) {
      this.elements.gitCommitSubmit.textContent = 'Commit staged changes';
    }
  });

  this.elements.gitResetDialog?.addEventListener('close', () => {
    this.pendingGitResetPath = null;
    if (this.elements.gitResetFileName) {
      this.elements.gitResetFileName.value = '';
    }
    if (this.elements.gitResetSubmit) {
      this.elements.gitResetSubmit.textContent = 'Reset File';
    }
  });

  this.elements.markdownToolbar?.addEventListener('click', (event) => {
    this.handleMarkdownToolbarClick?.(event);
  });

  this.elements.markdownToolbar?.addEventListener('keydown', (event) => {
    this.handleMarkdownToolbarKeydown?.(event);
  });

  this.elements.displayNameForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleDisplayNameSubmit();
  });

  this.elements.gitCommitForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void this.handleGitCommitSubmit();
  });

  this.elements.tabLockTakeoverButton?.addEventListener('click', () => {
    this.handleTabTakeover();
  });

  this.elements.toggleWrapButton?.addEventListener('click', () => {
    this.toggleLineWrapping();
  });

  this.elements.toolbarOverflowToggle?.addEventListener('click', (event) => {
    event.preventDefault();
    this.toggleToolbarOverflowMenu();
  });

  this.elements.toolbarOverflowMenu?.addEventListener('click', (event) => {
    if (event.target instanceof Element && event.target.closest('button')) {
      this.closeToolbarOverflowMenu();
    }
  });

  this.elements.previewContent?.addEventListener('click', (event) => {
    const wikiLink = event.target.closest('a.wiki-link[data-wiki-target]');
    if (!wikiLink) {
      return;
    }

    event.preventDefault();
    this.handleWikiLinkClick(wikiLink.dataset.wikiTarget);
  });

  this.elements.sidebarToggle?.addEventListener('click', () => {
    this.closeToolbarOverflowMenu();
    this.toggleSidebar();
  });

  this.elements.sidebarClose?.addEventListener('click', () => {
    this.closeSidebarOnMobile();
  });

  this.elements.filesSidebarTab?.addEventListener('click', () => {
    this.setSidebarTab('files');
  });

  this.elements.gitSidebarTab?.addEventListener('click', () => {
    if (!this.gitRepoAvailable) {
      return;
    }
    this.setSidebarTab('git');
  });

  document.addEventListener('pointerdown', (event) => {
    this.handleMarkdownToolbarDocumentPointerDown?.(event);

    if (
      this.toolbarOverflowOpen
      && !this.elements.toolbarOverflowMenu?.contains(event.target)
      && !this.elements.toolbarOverflowToggle?.contains(event.target)
    ) {
      this.closeToolbarOverflowMenu();
    }

    if (!this.chatIsOpen) {
      return;
    }

    if (this.elements.chatContainer?.contains(event.target)) {
      return;
    }

    this.closeChatPanel();
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && this.toolbarOverflowOpen) {
      this.closeToolbarOverflowMenu();
      return;
    }

    if (event.key === 'Escape' && this.chatIsOpen) {
      this.closeChatPanel();
      return;
    }

    if ((event.metaKey || event.ctrlKey) && event.key === 'k') {
      event.preventDefault();
      void this.toggleQuickSwitcher();
    }
  });
}

/** @this {UiShellContext} */
function setToolbarOverflowOpen(nextState) {
  this.toolbarOverflowOpen = Boolean(nextState) && this.isMobileViewport?.();
  this.elements.toolbarOverflowToggle?.setAttribute('aria-expanded', String(this.toolbarOverflowOpen));
  this.elements.toolbarOverflowToggle?.classList.toggle('active', this.toolbarOverflowOpen);
  this.elements.toolbarOverflowToggle?.closest('.toolbar-right')?.classList.toggle('is-overflow-open', this.toolbarOverflowOpen);
}

/** @this {UiShellContext} */
function closeToolbarOverflowMenu() {
  this.setToolbarOverflowOpen(false);
}

/** @this {UiShellContext} */
function toggleToolbarOverflowMenu() {
  this.setToolbarOverflowOpen(!this.toolbarOverflowOpen);
}

/** @this {UiShellContext} */
function handleThemeChange(theme) {
  this.previewRenderer.applyTheme(theme);
  if (!this.isExcalidrawFile(this.currentFilePath) && !this.isImageFile?.(this.currentFilePath)) {
    this.previewRenderer.queueRender();
  }
  this.session?.applyTheme(theme);
  this.excalidrawEmbed.updateTheme(theme);
  this.drawioEmbed.updateTheme(theme);
}

/** @this {UiShellContext} */
function handleConnectionChange(state) {
  this.connectionState = state;
  if (state?.firstConnection) {
    this.recordFileOpenMetric?.('ws_connected', {
      status: state.status,
    });
  }
  this.renderPresence();

  if (state.unreachable && !this.connectionHelpShown) {
    this.connectionHelpShown = true;
    this.toastController.show(`Cannot reach server at ${state.wsBaseUrl}`, 6000);
  }
}

/** @this {UiShellContext} */
function toggleLineWrapping() {
  const currentState = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
  const nextState = !currentState;

  this.session?.setLineWrapping(nextState);
  this.preferences.setLineWrappingEnabled(nextState);
  this.syncWrapToggle(nextState);
  this.session?.requestMeasure();
  this.scrollSyncController.syncPreviewToEditor();
}

/** @this {UiShellContext} */
function getStoredLineWrapping() {
  return this.preferences.getLineWrappingEnabled();
}

/** @this {UiShellContext} */
function syncWrapToggle(state) {
  const enabled = state ?? this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
  const label = this.elements.wrapToggleLabel;
  const button = this.elements.toggleWrapButton;
  const nextLabel = enabled ? 'Wrap on' : 'Wrap off';
  if (label) label.textContent = nextLabel;
  if (button) {
    button.setAttribute('aria-label', `${nextLabel}. ${enabled ? 'Disable line wrap' : 'Enable line wrap'}`);
  }
}

/** @this {UiShellContext} */
function scheduleBacklinkRefresh() {
  clearTimeout(this._backlinkRefreshTimer);
  this._backlinkRefreshTimer = setTimeout(() => {
    if (supportsBacklinksForFilePath(this.currentFilePath)) {
      this.backlinksPanel.load(this.currentFilePath);
    }
  }, 2000);
}

/** @this {UiShellContext} */
function showEditorLoading() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.add('is-loading-editor');
  this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading file...</span>
      </div>`;
}

/** @this {UiShellContext} */
function hideEditorLoading() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.remove('is-loading-editor');
  this.elements.editorContainer.querySelector('#editorLoading')?.remove();
}

/** @this {UiShellContext} */
function showEditorLoadError() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.remove('is-loading-editor');
  this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <span class="loading-text">Failed to load file</span>
      </div>`;
}

/** @this {UiShellContext} */
function clearInitialFileBootstrap() {
  document.documentElement.removeAttribute('data-initial-file-requested');
}

export const uiFeatureShellMethods = {
  bindEvents,
  clearInitialFileBootstrap,
  closeToolbarOverflowMenu,
  getStoredLineWrapping,
  handleConnectionChange,
  handleThemeChange,
  hideEditorLoading,
  initialize,
  initializeVersionMonitoring,
  setToolbarOverflowOpen,
  promptForVersionReload,
  scheduleBacklinkRefresh,
  showEditorLoadError,
  showEditorLoading,
  syncWrapToggle,
  toggleToolbarOverflowMenu,
  toggleLineWrapping,
};
