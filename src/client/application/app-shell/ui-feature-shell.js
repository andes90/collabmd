import { getVaultFileKind, supportsBacklinksForFilePath } from '../../../domain/file-kind.js';
import { isPlainQuickSwitcherShortcut } from '../../domain/keyboard-shortcuts.js';
import { createFileRouteHash, isCollabMdHashRoute, isGitHashRouteType } from '../../domain/hash-routes.js';

const VERSION_RELOAD_TOAST_DURATION_MS = 0;
const PREVIEW_ROUTE_ANCHOR_STABILIZE_MS = 2000;
const PREVIEW_ROUTE_ANCHOR_MAX_APPLICATIONS = 8;
const PREVIEW_CODE_COPY_ICON = `
  <svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true" focusable="false">
    <rect x="8" y="8" width="11" height="11" rx="2" fill="none" stroke="currentColor" stroke-width="2"/>
    <path d="M16 8V6a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h2" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`;
const PREVIEW_HEADING_LINK_ICON = `
  <svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true" focusable="false">
    <path d="M10 13.5 14 9.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="M9.35 7.55 10.6 6.3a4.2 4.2 0 0 1 5.95 5.95l-1.25 1.25" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
    <path d="m14.65 16.45-1.25 1.25a4.2 4.2 0 0 1-5.95-5.95L8.7 10.5" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
  </svg>
`;

/**
 * @typedef {object} UiShellContext
 * @property {boolean} chatIsOpen
 * @property {boolean} gitRepoAvailable
 * @property {boolean} isTabActive
 * @property {boolean} presencePanelOpen
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
 * @property {any} notifications
 * @property {any} toastController
 * @property {any} versionMonitor
 */

/** @this {UiShellContext} */
function initialize() {
  this.initializeExportBridge?.();
  this.renderMarkdownToolbar?.();
  this.initializeVisualViewportBinding?.();
  this.themeController.initialize();
  this.previewRenderer.applyTheme(this.themeController.getTheme());
  this.outlineController.initialize();
  this.layoutController.initialize();
  this.scrollSyncController.initialize();
  this.fileExplorer.initialize();
  this.gitPanel.initialize();
  this.gitDiffView.initialize();
  this.fileHistoryView.initialize();
  this.commentsOverview?.initialize?.();
  this.initializePreviewLayoutObserver();
  this.syncIdentityManagementUi();
  this.syncCurrentUserName();
  this.syncWrapToggle();
  this.syncVimModeToggle();
  this.syncToolbarOverflowVisibility?.();
  this.syncFileHistoryButton({ mode: 'empty' });
  this.renderChat();
  this.elements.chatInput?.setAttribute('maxlength', String(this.lobbyChatMessageMaxLength));
  this.bindEvents();
  this.initializeSidebarResizer?.();
  this.restoreSidebarState();
  this.initializeVersionMonitoring();
  this.tabActivityLock.initialize();
  this.tabActivityLock.tryActivate();

  window.addEventListener('hashchange', () => this.workspaceRouteController.handleHashChange());
  const handleResize = this.createResizeHandler();
  window.addEventListener('resize', () => {
    handleResize();
    this.syncToolbarOverflowVisibility?.();
  });

  if (this.runtimeConfig?.gitEnabled !== false) {
    this.gitRepoAvailable = true;
    this.elements.gitSidebarTab?.classList.remove('hidden');
    this.elements.sidebarTabs?.classList.remove('hidden');
  }

  this.fileExplorerReadyPromise = this.fileExplorer.refresh().then(() => {
    this.fileExplorerReady = true;
    void this.commentsOverview?.refresh?.();
    if (isGitHashRouteType(this.navigation.getHashRoute().type)) {
      void this.gitPanel.refresh({ force: false });
    }
    if (this.isTabActive) {
      return this.workspaceRouteController.handleHashChange();
    }
    return undefined;
  });

}

/** @this {UiShellContext} */
function initializeVersionMonitoring() {
  this.versionMonitor?.start();
}

/** @this {UiShellContext} */
function syncVisualViewportBounds() {
  const root = document.documentElement;
  const viewport = window.visualViewport;

  if (!root) {
    return;
  }

  if (!viewport) {
    root.style.setProperty('--app-viewport-height', '100dvh');
    root.style.setProperty('--app-viewport-offset-top', '0px');
    return;
  }

  root.style.setProperty('--app-viewport-height', `${Math.round(viewport.height)}px`);
  root.style.setProperty('--app-viewport-offset-top', `${Math.round(viewport.offsetTop)}px`);
}

/** @this {UiShellContext} */
function initializeVisualViewportBinding() {
  this.syncVisualViewportBounds?.();

  const viewport = window.visualViewport;
  if (!viewport) {
    return;
  }

  const handler = () => this.syncVisualViewportBounds?.();
  viewport.addEventListener('resize', handler, { passive: true });
  viewport.addEventListener('scroll', handler, { passive: true });
  window.addEventListener('orientationchange', handler);
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
function bindToolbarEvents() {
  const openQuickSwitcher = () => {
    void this.toggleQuickSwitcher();
    this.closeToolbarOverflowMenu?.();
  };

  this.elements.shareButton?.addEventListener('click', () => {
    void this.copyCurrentLink();
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.toolbarSearchButton?.addEventListener('click', openQuickSwitcher);
  this.elements.searchFilesButton?.addEventListener('click', openQuickSwitcher);

  this.elements.exportHtmlButton?.addEventListener('click', () => {
    void this.handleExportRequest?.('html');
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.exportDocxButton?.addEventListener('click', () => {
    void this.handleExportRequest?.('docx');
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.exportPdfButton?.addEventListener('click', () => {
    void this.handleExportRequest?.('pdf');
    this.closeToolbarOverflowMenu?.();
  });

  this.elements.reviewFileChangesButton?.addEventListener('click', () => {
    this.handleGitDiffSelection(this.currentFilePath, {
      closeSidebarOnMobile: true,
      scope: 'all',
    });
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
}

/** @this {UiShellContext} */
function bindDialogEvents() {
  this.elements.displayNameCancel?.addEventListener('click', () => {
    this.handleDisplayNameCancel();
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
      this.elements.gitCommitSubmit.textContent = 'Commit included files';
    }
  });

  this.elements.gitResetDialog?.addEventListener('close', () => {
    this.pendingGitResetPath = null;
    if (this.elements.gitResetFileName) {
      this.elements.gitResetFileName.value = '';
    }
    if (this.elements.gitResetSubmit) {
      this.elements.gitResetSubmit.textContent = 'Reset file';
    }
  });

  this.elements.displayNameForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleDisplayNameSubmit();
  });

  this.elements.gitCommitForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    void this.handleGitCommitSubmit();
  });
}

/** @this {UiShellContext} */
function focusEditor(event) {
  event?.preventDefault?.();
  const container = this.elements.editorContainer;
  if (!container) return;

  const target = container.querySelector('.cm-content, iframe, [contenteditable="true"]') ?? container;
  if (target === container && !container.hasAttribute('tabindex')) {
    container.setAttribute('tabindex', '-1');
  }
  target.focus();
}

/** @this {UiShellContext} */
function bindEvents() {
  const stopFollowing = () => this.stopFollowingUser?.();
  this.elements.editorContainer?.addEventListener('pointerdown', stopFollowing);
  this.elements.editorContainer?.addEventListener('keydown', stopFollowing);
  this.elements.editorContainer?.addEventListener('wheel', stopFollowing, { passive: true });
  this.elements.previewContainer?.addEventListener('pointerdown', stopFollowing);
  this.elements.previewContainer?.addEventListener('wheel', stopFollowing, { passive: true });
  this.elements.skipToEditor?.addEventListener('click', (event) => this.focusEditor(event));

  this.elements.emptyStateNewFileBtn?.addEventListener('click', () => {
    this.fileExplorer.actionController.openRootCreateMenu({
      anchor: this.elements.emptyStateNewFileBtn,
    });
  });

  this.elements.emptyStateSearchBtn?.addEventListener('click', () => {
    void this.toggleQuickSwitcher();
  });
  this.elements.presencePanel?.addEventListener('toggle', (event) => {
    this.presencePanelOpen = event.newState === 'open';
    this.renderAvatars?.();
    this.renderPresence?.();
  });

  this.elements.chatPanel?.addEventListener('toggle', (event) => {
    this.chatIsOpen = event.newState === 'open';
    if (this.chatIsOpen) {
      this.chatUnreadCount = 0;
    }
    this.renderChat?.({ messagesChanged: this.chatIsOpen, stickToBottom: this.chatIsOpen });
    if (this.chatIsOpen) {
      requestAnimationFrame(() => this.elements.chatInput?.focus());
    }
  });


  this.elements.chatNotificationButton?.addEventListener('click', () => {
    void this.handleChatNotificationToggle();
  });

  this.elements.chatNotificationMuteButton?.addEventListener('click', () => {
    this.toggleChatNotificationMute();
  });


  this.elements.chatForm?.addEventListener('submit', (event) => {
    event.preventDefault();
    this.handleChatSubmit();
  });

  bindToolbarEvents.call(this);
  bindDialogEvents.call(this);

  this.elements.markdownToolbar?.addEventListener('click', (event) => {
    this.handleMarkdownToolbarClick?.(event);
  });

  this.elements.markdownToolbar?.addEventListener('keydown', (event) => {
    this.handleMarkdownToolbarKeydown?.(event);
  });

  this.elements.tabLockTakeoverButton?.addEventListener('click', () => {
    this.handleTabTakeover();
  });

  this.elements.toggleWrapButton?.addEventListener('click', () => {
    this.toggleLineWrapping();
  });

  this.elements.toggleVimModeButton?.addEventListener('click', () => {
    this.toggleVimMode();
  });


  this.elements.editorFindButton?.addEventListener('click', () => {
    this.runEditorCommand?.('openSearch');
  });

  this.elements.editorFormatButton?.addEventListener('click', () => {
    void this.formatCurrentDocument();
  });


  this.elements.toolbarOverflowMenu?.addEventListener('click', (event) => {
    const button = event.target instanceof Element ? event.target.closest('button') : null;
    if (button && button !== this.elements.toggleVimModeButton) {
      this.closeToolbarOverflowMenu();
    }
  });

  this.elements.toolbarOverflowMenu?.addEventListener('toggle', (event) => {
    if (event.newState === 'closed') {
      this.elements.toolbarOverflowMenu.querySelectorAll('details[open]').forEach((detail) => {
        detail.removeAttribute('open');
      });
    }
  });

  this.elements.previewContent?.addEventListener('click', (event) => {
    this.handlePreviewContentClick?.(event);
  });
  this.elements.previewContent?.addEventListener('pointerover', (event) => {
    this.handlePreviewContentPointerOver?.(event);
  });
  this.elements.previewContent?.addEventListener('focusin', (event) => {
    this.handlePreviewContentPointerOver?.(event);
  });

  this.elements.sidebarToggle?.addEventListener('click', () => {
    this.closeToolbarOverflowMenu();
    this.toggleSidebar();
  });

  this.elements.sidebarClose?.addEventListener('click', () => {
    this.closeSidebarOnMobile();
  });

  this.elements.sidebarBackdrop?.addEventListener('click', () => {
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

  this.elements.commentsSidebarTab?.addEventListener('click', () => {
    this.setSidebarTab('comments');
  });

  this.elements.sidebarTabs?.addEventListener('keydown', (event) => {
    this.handleSidebarTabsKeydown(event);
  });


  document.addEventListener('keydown', (event) => {
    this.handleDocumentKeydown(event);
  }, { capture: true });
}


/** @this {UiShellContext} */
function handleDocumentKeydown(event) {
  if (event.key === 'Escape') {
    this.stopFollowingUser?.();
  }


  if (isPlainQuickSwitcherShortcut(event)) {
    event.preventDefault();
    event.stopPropagation();
    void this.toggleQuickSwitcher();
  }
}

function isNestedTaskListClickTarget(target, taskItem) {
  const nestedList = target.closest('ul, ol');
  return nestedList instanceof Element && nestedList.parentElement === taskItem;
}

function isInteractiveTaskListDescendant(target) {
  const taskCheckbox = target.closest('input[data-task-checkbox="true"]');
  if (taskCheckbox) {
    return false;
  }

  return Boolean(target.closest('a, button, input, select, textarea, summary, [contenteditable="true"], [role="button"], [role="link"]'));
}

function hasTaskListTextSelection(taskItem) {
  const selection = window.getSelection();
  return Boolean(
    !selection?.isCollapsed
    && taskItem.contains(selection.anchorNode)
    && taskItem.contains(selection.focusNode)
  );
}

function normalizeFragmentTargetId(rawTarget = '') {
  const normalizedTarget = String(rawTarget ?? '').trim();
  if (!normalizedTarget) {
    return '';
  }

  try {
    return decodeURIComponent(normalizedTarget);
  } catch {
    return normalizedTarget;
  }
}

function scrollPreviewToTarget(previewContainer, target, { behavior = 'smooth' } = {}) {
  if (!previewContainer || !target) {
    return;
  }

  const previewRect = previewContainer.getBoundingClientRect();
  const targetRect = target.getBoundingClientRect();
  const nextScrollTop = previewContainer.scrollTop + (targetRect.top - previewRect.top);
  previewContainer.scrollTo({
    behavior,
    top: Math.max(nextScrollTop, 0),
  });
}

async function copyTextToClipboard(text) {
  await navigator.clipboard.writeText(text);
}

function getHeadingLinkLabel(heading) {
  if (!(heading instanceof HTMLElement)) {
    return '';
  }

  const headingClone = heading.cloneNode(true);
  if (!(headingClone instanceof HTMLElement)) {
    return heading.textContent.trim();
  }

  headingClone.querySelectorAll('.preview-heading-fold-button, .preview-heading-link-button').forEach((button) => button.remove());
  return headingClone.textContent.replace(/\s+/g, ' ').trim();
}

function nowMs() {
  return globalThis.performance?.now?.() ?? Date.now();
}

/** @this {UiShellContext} */
function navigatePreviewHeading(target, headingId, { behavior = 'auto' } = {}) {
  if (!(target instanceof HTMLElement) || !headingId) {
    return false;
  }

  const handledByOutlineNavigation = this.outlineController?.navigateToHeading?.(target, headingId, { behavior });
  if (handledByOutlineNavigation) {
    return true;
  }

  const previewContainer = this.elements.previewContainer ?? document.getElementById('previewContainer');
  if (!previewContainer) {
    return false;
  }

  this.scrollSyncController?.suspendSync?.(250);
  scrollPreviewToTarget(previewContainer, target, { behavior });
  this.attachPreviewHeadingControls?.(target);

  const sourceLine = Number.parseInt(target.getAttribute('data-source-line') || '', 10);
  if (Number.isFinite(sourceLine)) {
    this.session?.scrollToLine?.(sourceLine, 0);
  }

  return true;
}

/** @this {UiShellContext} */
function createPreviewHeadingLinkUrl(anchorId) {
  if (!this.currentFilePath || !anchorId) {
    return '';
  }

  // pi-lens-ignore: unchecked-throwing-call-js
  const url = new URL(window.location.href);
  url.hash = createFileRouteHash(this.currentFilePath, {
    anchor: anchorId,
    drawioMode: this.currentDrawioMode ?? null,
  });
  return url.toString();
}

/** @this {UiShellContext} */
async function copyPreviewHeadingLink(anchorId) {
  const url = this.createPreviewHeadingLinkUrl(anchorId);
  if (!url) {
    this.toastController.show('Failed to copy section link');
    return;
  }

  try {
    await copyTextToClipboard(url);
    this.toastController.show('Section link copied');
  } catch {
    this.toastController.show('Failed to copy section link');
  }
}

/** @this {UiShellContext} */
async function copyPreviewCodeBlock(button) {
  const code = button?.closest('pre')?.querySelector(':scope > code');
  if (!(code instanceof HTMLElement)) {
    return;
  }

  try {
    await copyTextToClipboard(code.textContent);
    this.toastController.show('Code copied');
  } catch {
    this.toastController.show('Failed to copy code');
  }
}


function syncHeadingFoldButtonState(heading, button) {
  if (!(heading instanceof HTMLElement) || !(button instanceof HTMLButtonElement)) {
    return;
  }

  const headingLabel = getHeadingLinkLabel(heading);
  const collapsed = heading.dataset.previewHeadingCollapsed === 'true';
  heading.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-expanded', String(!collapsed));
  button.setAttribute('aria-label', `${collapsed ? 'Expand' : 'Collapse'} ${headingLabel}`);
  button.setAttribute('title', `${collapsed ? 'Expand' : 'Collapse'} section`);
}

/** @this {UiShellContext} */
function attachPreviewHeadingControls(heading) {
  if (!(heading instanceof HTMLElement) || !/^H[1-6]$/.test(heading.tagName)) {
    return;
  }

  if (!this._previewHeadingFoldButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-icon-button preview-heading-fold-button';
    this._previewHeadingFoldButton = button;
  }
  if (!this._previewHeadingLinkButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-icon-button preview-heading-link-button';
    // pi-lens-ignore: no-inner-html-js
    button.innerHTML = PREVIEW_HEADING_LINK_ICON;
    this._previewHeadingLinkButton = button;
  }

  const foldButton = this._previewHeadingFoldButton;
  const linkButton = this._previewHeadingLinkButton;

  if (foldButton.parentElement !== heading) {
    heading.prepend(foldButton);
  }
  syncHeadingFoldButtonState(heading, foldButton);

  if (!heading.id) {
    linkButton.remove();
    return;
  }

  const headingLabel = getHeadingLinkLabel(heading);
  linkButton.dataset.previewHeadingAnchor = heading.id;
  linkButton.setAttribute('aria-label', `Copy link to ${headingLabel}`);
  linkButton.setAttribute('title', 'Copy link to this section');
  if (linkButton.parentElement !== heading) {
    heading.append(linkButton);
  }
}

/** @this {UiShellContext} */
function attachPreviewCodeCopyButton(pre) {
  if (!(pre instanceof HTMLElement) || pre.tagName !== 'PRE' || !pre.querySelector(':scope > code')) {
    return;
  }

  if (!this._previewCodeCopyButton) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-button ui-button--secondary ui-button--compact preview-code-copy-button';
    button.setAttribute('aria-label', 'Copy code');
    button.title = 'Copy code';
    // pi-lens-ignore: no-inner-html-js
    button.innerHTML = `${PREVIEW_CODE_COPY_ICON}<span data-preview-code-copy-label>Copy</span>`;
    this._previewCodeCopyButton = button;
  }

  const button = this._previewCodeCopyButton;
  if (button.parentElement !== pre) {
    pre.append(button);
  }
}

/** @this {UiShellContext} */
function handlePreviewContentPointerOver(event) {
  if (!(event.target instanceof Element) || !this.elements.previewContent) {
    return;
  }

  const heading = event.target.closest('h1, h2, h3, h4, h5, h6');
  if (heading instanceof HTMLElement && this.elements.previewContent.contains(heading)) {
    this.attachPreviewHeadingControls(heading);
  }

  const pre = event.target.closest('pre');
  if (pre instanceof HTMLElement && this.elements.previewContent.contains(pre)) {
    this.attachPreviewCodeCopyButton(pre);
  }
}


function applyPreviewHeadingFolds(previewContent) {
  const parents = new Set(Array.from(previewContent?.querySelectorAll?.('h1, h2, h3, h4, h5, h6') ?? [])
    .map((heading) => heading.parentElement)
    .filter(Boolean));

  parents.forEach((parent) => {
    const collapsedLevels = [];
    Array.from(parent.children).forEach((child) => {
      const level = /^H([1-6])$/.exec(child.tagName)?.[1];
      if (level) {
        const headingLevel = Number(level);
        while (collapsedLevels.at(-1) >= headingLevel) {
          collapsedLevels.pop();
        }
        child.hidden = collapsedLevels.length > 0;
        if (child.dataset.previewHeadingCollapsed === 'true') {
          collapsedLevels.push(headingLevel);
        }
      } else {
        child.hidden = collapsedLevels.length > 0;
      }
    });
  });
}

/** @this {UiShellContext} */
function unfoldPreviewHeading(target) {
  if (!(target instanceof HTMLElement) || !/^H[1-6]$/.test(target.tagName)) {
    return false;
  }

  const collapsedHeadings = [];
  let ancestorLevel = Number(target.tagName[1]) + 1;
  for (let heading = target; heading; heading = heading.previousElementSibling) {
    const level = Number(/^H([1-6])$/.exec(heading.tagName)?.[1]);
    if (!level || level >= ancestorLevel) {
      continue;
    }

    ancestorLevel = level;
    if (heading.dataset.previewHeadingCollapsed === 'true') {
      collapsedHeadings.push(heading);
    }
  }

  if (collapsedHeadings.length === 0) {
    return false;
  }

  collapsedHeadings.forEach((heading) => delete heading.dataset.previewHeadingCollapsed);
  this.syncPreviewHeadingFoldButtons();
  this.scrollSyncController?.invalidatePreviewBlocks?.();
  this.schedulePreviewLayoutSync?.({ delayMs: 0 });
  this.refreshCommentUiLayout?.();
  return true;
}

/** @this {UiShellContext} */
function syncPreviewHeadingFoldButtons() {
  const headings = this.elements.previewContent?.querySelectorAll?.('h1, h2, h3, h4, h5, h6') ?? [];

  Array.from(headings).forEach((heading) => {
    if (!(heading instanceof HTMLElement)) {
      return;
    }

    const collapsed = heading.dataset.previewHeadingCollapsed === 'true';
    heading.setAttribute('aria-expanded', String(!collapsed));
    const button = heading.querySelector(':scope > .preview-heading-fold-button');
    if (button instanceof HTMLButtonElement) {
      syncHeadingFoldButtonState(heading, button);
    }
  });

  applyPreviewHeadingFolds(this.elements.previewContent);
}

/** @this {UiShellContext} */
function syncPreviewHeadingLinkButtons() {
  const linkButton = this._previewHeadingLinkButton;
  const heading = linkButton?.parentElement;
  if (!(heading instanceof HTMLElement) || !heading.id) {
    return;
  }

  const headingLabel = getHeadingLinkLabel(heading);
  linkButton.dataset.previewHeadingAnchor = heading.id;
  linkButton.setAttribute('aria-label', `Copy link to ${headingLabel}`);
  linkButton.setAttribute('title', 'Copy link to this section');
}


/** @this {UiShellContext} */
function requestPreviewRouteAnchor(anchorId, filePath = this.currentFilePath) {
  const normalizedAnchor = String(anchorId ?? '').trim();
  this._pendingPreviewRouteAnchor = normalizedAnchor
    ? {
      applied: false,
      appliedCount: 0,
      anchorId: normalizedAnchor,
      filePath: filePath ?? this.currentFilePath ?? null,
      stabilizeUntil: nowMs() + PREVIEW_ROUTE_ANCHOR_STABILIZE_MS,
    }
    : null;

  if (!this._pendingPreviewRouteAnchor) {
    return false;
  }

  return this.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: false });
}

/** @this {UiShellContext} */
function applyPendingPreviewRouteAnchor({ allowExpired = false, behavior = 'auto', clearMissing = false } = {}) {
  const pendingAnchor = this._pendingPreviewRouteAnchor;
  if (!pendingAnchor) {
    return false;
  }

  if (!allowExpired && pendingAnchor.applied && pendingAnchor.stabilizeUntil <= nowMs()) {
    this._pendingPreviewRouteAnchor = null;
    return false;
  }

  if (pendingAnchor.filePath && this.currentFilePath && pendingAnchor.filePath !== this.currentFilePath) {
    return false;
  }

  const target = document.getElementById(pendingAnchor.anchorId);
  if (!(target instanceof HTMLElement) || !this.elements.previewContent?.contains(target)) {
    if (!pendingAnchor.applied && clearMissing && pendingAnchor.filePath && pendingAnchor.filePath === this.currentFilePath) {
      this._pendingPreviewRouteAnchor = null;
    }
    return false;
  }

  if (!this.navigatePreviewHeading(target, pendingAnchor.anchorId, { behavior })) {
    return false;
  }

  pendingAnchor.applied = true;
  pendingAnchor.appliedCount = (pendingAnchor.appliedCount ?? 0) + 1;
  pendingAnchor.stabilizeUntil = nowMs() + PREVIEW_ROUTE_ANCHOR_STABILIZE_MS;
  if (pendingAnchor.appliedCount >= PREVIEW_ROUTE_ANCHOR_MAX_APPLICATIONS) {
    this._pendingPreviewRouteAnchor = null;
  }
  return true;
}

/** @this {UiShellContext} */
function handlePreviewContentClick(event) {
  if (!(event.target instanceof Element)) {
    return;
  }

  const foldButton = event.target.closest('button.preview-heading-fold-button');
  const heading = foldButton?.closest('h1, h2, h3, h4, h5, h6');
  if (foldButton instanceof HTMLButtonElement && heading instanceof HTMLElement) {
    event.preventDefault();
    heading.dataset.previewHeadingCollapsed = String(heading.dataset.previewHeadingCollapsed !== 'true');
    this.syncPreviewHeadingFoldButtons();
    this.scrollSyncController?.invalidatePreviewBlocks?.();
    this.schedulePreviewLayoutSync?.({ delayMs: 0 });
    this.refreshCommentUiLayout?.();
    return;
  }

  const codeCopyButton = event.target.closest('button.preview-code-copy-button');
  if (codeCopyButton instanceof HTMLButtonElement) {
    event.preventDefault();
    void this.copyPreviewCodeBlock(codeCopyButton);
    return;
  }

  const headingLinkButton = event.target.closest('button.preview-heading-link-button[data-preview-heading-anchor]');
  if (headingLinkButton instanceof HTMLButtonElement) {
    event.preventDefault();
    void this.copyPreviewHeadingLink(headingLinkButton.dataset.previewHeadingAnchor || '');
    return;
  }

  const wikiLink = event.target.closest('a.wiki-link[data-wiki-target]');
  if (wikiLink) {
    event.preventDefault();
    this.wikiLinkFileController.handleWikiLinkClick(wikiLink.dataset.wikiTarget);
    return;
  }

  const anchorLink = event.target.closest('a[href]');
  const href = anchorLink?.getAttribute('href')?.trim() || '';
  if (anchorLink && href.startsWith('#') && !isCollabMdHashRoute(href)) {
    event.preventDefault();

    if (href === '#' || href.toLowerCase() === '#top') {
      this.scrollSyncController?.suspendSync?.(250);
      const previewContainer = this.elements.previewContainer ?? document.getElementById('previewContainer');
      previewContainer?.scrollTo({ top: 0, behavior: 'smooth' });
      return;
    }

    const targetId = normalizeFragmentTargetId(href.slice(1));
    if (!targetId) {
      return;
    }

    const target = document.getElementById(targetId);
    if (!target || !this.elements.previewContent?.contains(target)) {
      return;
    }

    this.navigatePreviewHeading(target, targetId, { behavior: 'smooth' });
    return;
  }

  const taskItem = event.target.closest('.task-list-item[data-source-line]');
  if (!taskItem || isNestedTaskListClickTarget(event.target, taskItem) || isInteractiveTaskListDescendant(event.target)) {
    return;
  }

  if (hasTaskListTextSelection(taskItem)) {
    return;
  }

  event.preventDefault();

  const sourceLine = Number.parseInt(taskItem.getAttribute('data-source-line') || '', 10);
  if (!Number.isFinite(sourceLine)) {
    return;
  }

  this.session?.toggleTaskListItem?.(sourceLine);
}

/** @this {UiShellContext} */
function syncToolbarOverflowVisibility() {
  const toggle = this.elements.toolbarOverflowToggle;
  if (!toggle) {
    return;
  }

  toggle.classList.remove('hidden');
  toggle.hidden = false;
  toggle.setAttribute('aria-hidden', 'false');
}

/** @this {UiShellContext} */
function closeToolbarOverflowMenu() {
  if (this.elements.toolbarOverflowMenu?.matches(':popover-open')) {
    this.elements.toolbarOverflowMenu.hidePopover();
  }
}

/** @this {UiShellContext} */
function handleThemeChange(theme) {
  this.previewRenderer.applyTheme(theme);
  if (
    this.currentFilePath
    && !this.isExcalidrawFile(this.currentFilePath)
    && !this.isImageFile?.(this.currentFilePath)
    && !this.isPdfFile?.(this.currentFilePath)
    && !this.isStructurizrWorkspaceFile?.(this.currentFilePath)
  ) {
    this.previewRenderer.queueRender();
  }
  this.session?.applyTheme(theme);
  this.excalidrawEmbed.updateTheme(theme);
  this.drawioEmbed.updateTheme(theme);
  this.pdfPreview?.setTheme(theme);
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
  this.renderChat({ messagesChanged: false });

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
async function formatCurrentDocument() {
  const button = this.elements.editorFormatButton;
  button?.setAttribute('disabled', '');

  try {
    const result = await this.session?.formatDocument?.(this.currentFilePath);
    const messages = {
      changed: 'Document changed while formatting. Try again.',
      formatted: getVaultFileKind(this.currentFilePath) === 'plantuml'
        ? 'PlantUML indentation applied'
        : 'Document formatted',
      unchanged: 'Document is already formatted',
      unsupported: 'Formatting is unavailable for this file type',
    };
    this.toastController.show(messages[result] ?? messages.unsupported);
  } catch (error) {
    this.toastController.show(`Formatting failed: ${error?.message || 'Unknown error'}`, 5000);
  } finally {
    button?.removeAttribute('disabled');
  }
}

/** @this {UiShellContext} */
function toggleVimMode() {
  const currentState = this.session?.isVimModeEnabled?.() ?? this.getStoredVimMode();
  const nextState = !currentState;

  this.session?.setVimMode?.(nextState);
  this.preferences.setVimModeEnabled(nextState);
  this.syncVimModeToggle(nextState);
}

/** @this {UiShellContext} */
function getStoredVimMode() {
  return this.preferences.getVimModeEnabled();
}

/** @this {UiShellContext} */
function syncVimModeToggle(state) {
  const enabled = state ?? this.session?.isVimModeEnabled?.() ?? this.getStoredVimMode();
  const label = this.elements.vimModeToggleLabel;
  const button = this.elements.toggleVimModeButton;
  const nextLabel = enabled ? 'On' : 'Off';
  if (label) label.textContent = nextLabel;
  if (button) {
    button.setAttribute('aria-label', `${enabled ? 'Disable' : 'Enable'} Vim keybindings`);
    button.setAttribute('title', `${enabled ? 'Disable' : 'Enable'} Vim keybindings`);
    button.setAttribute('aria-pressed', String(enabled));
  }
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
      <div class="editor-loading" id="editorLoading" role="status" aria-live="polite" aria-label="Loading file…">
        <div class="skeleton-line skeleton-line--title skeleton-line--break"></div>
        <div class="skeleton-line skeleton-line--full"></div>
        <div class="skeleton-line skeleton-line--ninety"></div>
        <div class="skeleton-line skeleton-line--ninety-five"></div>
        <div class="skeleton-line skeleton-line--eighty"></div>
      </div>`;
}

/** @this {UiShellContext} */
function hideEditorLoading() {
  if (!this.elements.editorContainer) return;
  this.elements.editorContainer.classList.remove('is-loading-editor');
  this.elements.editorContainer.querySelector('#editorLoading')?.remove();
}

/** @this {UiShellContext} */
function showEditorLoadError(message = 'Failed to load file') {
  if (!this.elements.editorContainer) return;
  const loading = document.createElement('div');
  const text = document.createElement('span');
  loading.className = 'editor-loading';
  loading.id = 'editorLoading';
  text.className = 'loading-text';
  text.textContent = message;
  loading.appendChild(text);
  this.elements.editorContainer.classList.remove('is-loading-editor');
  this.elements.editorContainer.replaceChildren(loading);
}

/** @this {UiShellContext} */
function clearInitialFileBootstrap() {
  document.documentElement.removeAttribute('data-initial-file-requested');
}

export const uiFeatureShellMethods = {
  applyPendingPreviewRouteAnchor,
  attachPreviewCodeCopyButton,
  attachPreviewHeadingControls,
  bindEvents,
  clearInitialFileBootstrap,
  closeToolbarOverflowMenu,
  copyPreviewCodeBlock,
  copyPreviewHeadingLink,
  createPreviewHeadingLinkUrl,
  focusEditor,
  formatCurrentDocument,
  getStoredLineWrapping,
  getStoredVimMode,
  handleConnectionChange,
  handleDocumentKeydown,
  handlePreviewContentClick,
  handlePreviewContentPointerOver,
  handleThemeChange,
  hideEditorLoading,
  initialize,
  initializeVisualViewportBinding,
  initializeVersionMonitoring,
  isPlainQuickSwitcherShortcut,
  navigatePreviewHeading,
  promptForVersionReload,
  requestPreviewRouteAnchor,
  scheduleBacklinkRefresh,
  showEditorLoadError,
  showEditorLoading,
  syncPreviewHeadingFoldButtons,
  syncPreviewHeadingLinkButtons,
  syncVisualViewportBounds,
  syncToolbarOverflowVisibility,
  syncVimModeToggle,
  syncWrapToggle,
  toggleLineWrapping,
  unfoldPreviewHeading,
  toggleVimMode,
};
