import { afterEach, describe, expect, it, vi } from 'vitest';

import { gitFeature } from '../../src/client/application/app-shell/git-feature.js';
import { uiFeatureIdentityMethods } from '../../src/client/application/app-shell/ui-feature-identity.js';
import { uiFeatureShellMethods } from '../../src/client/application/app-shell/ui-feature-shell.js';
import { uiFeatureSidebarMethods } from '../../src/client/application/app-shell/ui-feature-sidebar.js';
import { uiFeatureToolbarMethods } from '../../src/client/application/app-shell/ui-feature-toolbar.js';
import { ensureQuickSwitcherInstance } from '../../src/client/application/quick-switcher-loader.js';

function createSidebarContext({ gitRepoAvailable = true, mobile = false } = {}) {
  document.body.innerHTML = `
    <aside id="sidebar"><div id="sidebar-resizer"></div></aside>
    <button id="sidebar-backdrop" hidden></button>
    <button id="files-tab"></button>
    <button id="comments-tab"></button>
    <button id="git-tab"></button>
    <section id="fileTree"></section>
    <section id="commentOverviewPanel"></section>
    <section id="gitPanel"></section>
    <div id="file-search"></div>
    <div id="git-search"></div>
  `;

  const context = {
    activeSidebarTab: 'files',
    elements: {
      fileSearch: document.getElementById('file-search'),
      filesSidebarTab: document.getElementById('files-tab'),
      commentsSidebarTab: document.getElementById('comments-tab'),
      commentOverviewPanel: document.getElementById('commentOverviewPanel'),
      gitSearch: document.getElementById('git-search'),
      gitSidebarTab: document.getElementById('git-tab'),
      sidebar: document.getElementById('sidebar'),
      sidebarBackdrop: document.getElementById('sidebar-backdrop'),
      sidebarResizer: document.getElementById('sidebar-resizer'),
    },
    gitPanel: {
      setActive: vi.fn(),
    },
    refreshCommentOverviewForSidebarOpen: vi.fn(),
    gitRepoAvailable,
    mobileBreakpointQuery: { matches: mobile },
    preferences: {
      getSidebarVisible: () => null,
      setSidebarVisible: vi.fn(),
    },
  };

  Object.assign(context, uiFeatureSidebarMethods);
  return context;
}

describe('uiFeature browser helpers', () => {
  afterEach(() => {
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('keeps Vim mode off by default and persists the opt-in toggle', () => {
    document.body.innerHTML = '<button id="vim-toggle"></button><span id="vim-label"></span>';
    const context = {
      elements: {
        toggleVimModeButton: document.getElementById('vim-toggle'),
        vimModeToggleLabel: document.getElementById('vim-label'),
      },
      preferences: {
        getVimModeEnabled: () => false,
        setVimModeEnabled: vi.fn(),
      },
      session: {
        isVimModeEnabled: () => false,
        setVimMode: vi.fn(),
      },
    };
    Object.assign(context, uiFeatureShellMethods);

    context.syncVimModeToggle();
    expect(context.elements.vimModeToggleLabel.textContent).toBe('Off');
    expect(context.elements.toggleVimModeButton.getAttribute('aria-pressed')).toBe('false');

    context.toggleVimMode();

    expect(context.session.setVimMode).toHaveBeenCalledWith(true);
    expect(context.preferences.setVimModeEnabled).toHaveBeenCalledWith(true);
    expect(context.elements.vimModeToggleLabel.textContent).toBe('On');
    expect(context.elements.toggleVimModeButton.getAttribute('aria-pressed')).toBe('true');
  });

  it('defers preview rendering until a file is open', () => {
    const queueRender = vi.fn();
    const context = {
      currentFilePath: '',
      drawioEmbed: { updateTheme: vi.fn() },
      excalidrawEmbed: { updateTheme: vi.fn() },
      isExcalidrawFile: () => false,
      isImageFile: () => false,
      isPdfFile: () => false,
      isStructurizrWorkspaceFile: () => false,
      pdfPreview: { setTheme: vi.fn() },
      previewRenderer: {
        applyTheme: vi.fn(),
        queueRender,
      },
      session: null,
    };

    uiFeatureShellMethods.handleThemeChange.call(context, 'dark');
    context.currentFilePath = 'README.md';
    uiFeatureShellMethods.handleThemeChange.call(context, 'light');

    expect(queueRender).toHaveBeenCalledTimes(1);
  });

  it('switches sidebar tabs and updates visibility state', () => {
    const context = createSidebarContext();

    context.setSidebarTab('git');

    expect(context.activeSidebarTab).toBe('git');
    expect(context.elements.gitSidebarTab.classList.contains('active')).toBe(true);
    expect(context.elements.gitSidebarTab).toHaveAttribute('aria-selected', 'true');
    expect(context.elements.gitSidebarTab).toHaveAttribute('tabindex', '0');
    expect(context.elements.filesSidebarTab).toHaveAttribute('aria-selected', 'false');
    expect(context.elements.filesSidebarTab).toHaveAttribute('tabindex', '-1');
    expect(document.getElementById('gitPanel').classList.contains('hidden')).toBe(false);
    expect(context.gitPanel.setActive).toHaveBeenCalledWith(true);
  });

  it('switches to the comments sidebar tab and refreshes the overview', () => {
    const context = createSidebarContext();

    context.setSidebarTab('comments');

    expect(context.activeSidebarTab).toBe('comments');
    expect(context.elements.commentsSidebarTab.classList.contains('active')).toBe(true);
    expect(document.getElementById('commentOverviewPanel').classList.contains('hidden')).toBe(false);
    expect(document.getElementById('fileTree').classList.contains('hidden')).toBe(true);
    expect(context.gitPanel.setActive).toHaveBeenCalledWith(false);
    expect(context.refreshCommentOverviewForSidebarOpen).toHaveBeenCalledTimes(1);
  });

  it('reveals the Git tab on startup without forcing a status refresh', async () => {
    document.body.innerHTML = `
      <div id="sidebar-tabs" class="hidden"></div>
      <button id="git-tab" class="hidden"></button>
    `;
    const status = { isGitRepo: true, summary: { changedFiles: 0 } };
    const handleHashChange = vi.fn();
    let context;
    const refreshGitStatus = vi.fn(async () => {
      context.handleGitRepoChange(true, status);
      return status;
    });
    context = {
      activeSidebarTab: 'files',
      bindEvents: vi.fn(),
      createResizeHandler: () => vi.fn(),
      currentFilePath: 'README.md',
      elements: {
        chatInput: document.createElement('textarea'),
        gitSidebarTab: document.getElementById('git-tab'),
        sidebarTabs: document.getElementById('sidebar-tabs'),
      },
      fileExplorer: {
        initialize: vi.fn(),
        refresh: vi.fn(async () => {}),
      },
      fileHistoryView: {
        initialize: vi.fn(),
      },
      gitDiffView: {
        initialize: vi.fn(),
        setRepoStatus: vi.fn(),
      },
      gitPanel: {
        initialize: vi.fn(),
        refresh: refreshGitStatus,
      },
      gitRepoAvailable: false,
      handleGitRepoChange: gitFeature.handleGitRepoChange,
      initializeExportBridge: vi.fn(),
      initializePreviewLayoutObserver: vi.fn(),
      initializeVersionMonitoring: vi.fn(),
      initializeVisualViewportBinding: vi.fn(),
      isTabActive: true,
      layoutController: {
        initialize: vi.fn(),
      },
      lobbyChatMessageMaxLength: 500,
      navigation: {
        getHashRoute: () => ({ type: 'file' }),
      },
      outlineController: {
        initialize: vi.fn(),
      },
      previewRenderer: {
        applyTheme: vi.fn(),
      },
      renderChat: vi.fn(),
      restoreSidebarState: vi.fn(),
      runtimeConfig: { gitEnabled: true },
      scrollSyncController: {
        initialize: vi.fn(),
      },
      syncCurrentUserName: vi.fn(),
      syncFileHistoryButton: vi.fn(),
      syncReviewFileChangesButton: vi.fn(),
      syncIdentityManagementUi: vi.fn(),
      syncToolbarOverflowVisibility: vi.fn(),
      syncVimModeToggle: vi.fn(),
      syncWrapToggle: vi.fn(),
      tabActivityLock: {
        initialize: vi.fn(),
        tryActivate: vi.fn(),
      },
      themeController: {
        getTheme: () => 'dark',
        initialize: vi.fn(),
      },
      workspaceRouteController: {
        handleHashChange,
      },
    };
    uiFeatureShellMethods.initialize.call(context);
    await context.fileExplorerReadyPromise;

    expect(context.fileExplorer.refresh).toHaveBeenCalledTimes(1);
    expect(context.gitPanel.initialize).toHaveBeenCalledTimes(1);
    expect(context.gitPanel.refresh).not.toHaveBeenCalled();
    expect(context.gitRepoAvailable).toBe(true);
    expect(context.gitDiffView.initialize).toHaveBeenCalledTimes(1);
    expect(context.fileHistoryView.initialize).toHaveBeenCalledTimes(1);
    expect(context.elements.sidebarTabs.classList.contains('hidden')).toBe(false);
    expect(context.elements.gitSidebarTab.classList.contains('hidden')).toBe(false);
    expect(handleHashChange).toHaveBeenCalledTimes(1);
  });

  it('reveals the Git tab when repo status detection reports a Git repository', () => {
    document.body.innerHTML = `
      <div id="sidebar-tabs" class="hidden"></div>
      <button id="git-tab" class="hidden"></button>
    `;
    const status = { summary: { changedFiles: 2 } };
    const context = {
      activeSidebarTab: 'files',
      currentFilePath: 'README.md',
      elements: {
        gitSidebarTab: document.getElementById('git-tab'),
        sidebarTabs: document.getElementById('sidebar-tabs'),
      },
      gitDiffView: {
        setRepoStatus: vi.fn(),
      },
      navigation: {
        getHashRoute: () => ({ type: 'file' }),
      },
      setSidebarTab: vi.fn(),
      syncFileHistoryButton: vi.fn(),
      syncReviewFileChangesButton: vi.fn(),
    };
    Object.assign(context, {
      handleGitRepoChange: gitFeature.handleGitRepoChange,
    });

    context.handleGitRepoChange(true, status);

    expect(context.gitRepoAvailable).toBe(true);
    expect(context.elements.sidebarTabs.classList.contains('hidden')).toBe(false);
    expect(context.elements.gitSidebarTab.classList.contains('hidden')).toBe(false);
    expect(context.elements.gitSidebarTab.classList.contains('has-changes')).toBe(true);
    expect(context.gitDiffView.setRepoStatus).toHaveBeenCalledWith(status);
  });

  it('shows Review changes for an open file in a Git repository', () => {
    document.body.innerHTML = '<button id="review-file-changes" class="hidden"></button>';
    const button = document.getElementById('review-file-changes');
    const context = {
      currentFilePath: 'README.md',
      elements: { reviewFileChangesButton: button },
      gitRepoAvailable: true,
    };

    gitFeature.syncReviewFileChangesButton.call(context);
    expect(button.classList.contains('hidden')).toBe(false);

    gitFeature.syncReviewFileChangesButton.call(context, { mode: 'diff' });
    expect(button.classList.contains('hidden')).toBe(true);
  });

  it('collapses the sidebar for mobile restores', () => {
    const context = createSidebarContext({ mobile: true });

    context.restoreSidebarState();

    expect(context.elements.sidebar.classList.contains('collapsed')).toBe(true);
    expect(context.elements.sidebar.hidden).toBe(true);
    expect(context.elements.sidebarBackdrop.hidden).toBe(true);
  });

  it('syncs the mobile sidebar backdrop with drawer visibility', () => {
    const context = createSidebarContext({ mobile: true });

    context.applySidebarVisibility(true);

    expect(context.elements.sidebar.hidden).toBe(false);
    expect(context.elements.sidebarBackdrop.hidden).toBe(false);
    expect(context.elements.sidebarBackdrop.getAttribute('aria-hidden')).toBe('false');

    context.applySidebarVisibility(false);

    expect(context.elements.sidebarBackdrop.hidden).toBe(true);
    expect(context.elements.sidebarBackdrop.getAttribute('aria-hidden')).toBe('true');
  });

  it('resizes the desktop sidebar from the keyboard', () => {
    const context = createSidebarContext();
    context.initializeSidebarResizer();

    context.elements.sidebarResizer.dispatchEvent(new KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true }));

    expect(context.elements.sidebar.style.getPropertyValue('--sidebar-width')).toBe('276px');
    expect(context.elements.sidebarResizer.getAttribute('aria-valuenow')).toBe('276');
  });

  it('opens the display name dialog and persists submitted names', () => {
    document.body.innerHTML = `
      <dialog id="display-name-dialog"></dialog>
      <input id="display-name-input">
      <h2 id="display-name-title"></h2>
      <p id="display-name-copy"></p>
      <button id="display-name-cancel"></button>
      <button id="display-name-submit"></button>
      <span id="current-user-name"></span>
      <button id="edit-name-button"></button>
    `;

    const dialog = document.getElementById('display-name-dialog');
    dialog.showModal = () => {
      dialog.open = true;
    };
    dialog.close = () => {
      dialog.open = false;
    };

    const context = {
      _hasPromptedForDisplayName: false,
      elements: {
        currentUserName: document.getElementById('current-user-name'),
        displayNameCancel: document.getElementById('display-name-cancel'),
        displayNameCopy: document.getElementById('display-name-copy'),
        displayNameDialog: dialog,
        displayNameInput: document.getElementById('display-name-input'),
        displayNameSubmit: document.getElementById('display-name-submit'),
        displayNameTitle: document.getElementById('display-name-title'),
        editNameButton: document.getElementById('edit-name-button'),
      },
      excalidrawEmbed: { updateLocalUser: vi.fn() },
      globalUsers: [],
      getCurrentUser: () => ({ name: 'Alice' }),
      getCurrentUserName: () => 'Alice',
      getStoredUserName: () => '',
      isIdentityManagedByAuth: () => false,
      isTabActive: true,
      lobby: {
        getLocalUser: () => ({ name: 'Bob' }),
        setUserName: vi.fn(),
      },
      preferences: {
        getUserName: () => 'Bob',
        setUserName: vi.fn(),
      },
      renderChat: vi.fn(),
      session: {
        getLocalUser: () => ({ name: 'Bob' }),
        setUserName: () => 'Bob',
      },
      syncCurrentUserName: uiFeatureIdentityMethods.syncCurrentUserName,
      toastController: { show: vi.fn() },
    };

    Object.assign(context, uiFeatureIdentityMethods);

    context.openDisplayNameDialog({ mode: 'onboarding' });
    expect(dialog.open).toBe(true);
    expect(context.elements.displayNameSubmit.textContent).toBe('Continue');

    context.elements.displayNameInput.value = 'Bob';
    context.handleDisplayNameSubmit();

    expect(context.preferences.setUserName).toHaveBeenCalledWith('Bob');
    expect(context.lobby.setUserName).toHaveBeenCalledWith('Bob');
    expect(dialog.open).toBe(false);
  });

  it('dispatches markdown toolbar actions and image uploads through the toolbar helpers', async () => {
    document.body.innerHTML = '<div id="editor-container"></div><div id="markdown-toolbar"></div>';
    const context = {
      currentFilePath: 'README.md',
      elements: {
        editorContainer: document.getElementById('editor-container'),
        markdownToolbar: document.getElementById('markdown-toolbar'),
      },
      fileExplorer: { refresh: vi.fn(async () => {}) },
      handleToolbarImageInsert: uiFeatureToolbarMethods.handleToolbarImageInsert,
      session: {
        applyMarkdownToolbarAction: vi.fn(() => true),
        insertText: vi.fn(),
        runEditorCommand: vi.fn(() => true),
      },
      toastController: { show: vi.fn() },
      vaultApiClient: {
        uploadImageAttachment: vi.fn(async () => ({ markdown: '![img](image.png)', path: 'image.png' })),
      },
    };

    Object.assign(context, uiFeatureToolbarMethods);
    context.renderMarkdownToolbar();

    expect(document.querySelector('.markdown-toolbar-popover [data-markdown-block-action="paragraph"]')).not.toBeNull();
    expect(document.querySelector('.markdown-toolbar-popover [data-markdown-block-action="heading-6"]')).not.toBeNull();
    expect(document.querySelector('[data-editor-command="undo"]')).not.toBeNull();
    expect(document.querySelector('[data-editor-command="indentMore"]')).not.toBeNull();

    context.applyMarkdownToolbarAction('bold');
    expect(context.session.applyMarkdownToolbarAction).toHaveBeenCalledWith('bold');

    const undoButton = context.elements.markdownToolbar.querySelector('[data-editor-command="undo"]');
    context.handleMarkdownToolbarClick({ preventDefault() {}, target: undoButton });
    expect(context.session.runEditorCommand).toHaveBeenCalledWith('undo');

    const inserted = await context.handleEditorImageInsert(new File(['x'], 'image.png', { type: 'image/png' }));
    expect(inserted).toBe(true);
    expect(context.fileExplorer.refresh).toHaveBeenCalled();
    expect(context.session.insertText).toHaveBeenCalledWith('![img](image.png)');
  });

  it('opens the block menu and dispatches explicit heading actions from the rendered toolbar', () => {
    document.body.innerHTML = '<div id="editor-container"></div><div id="markdown-toolbar"></div>';

    const context = {
      currentFilePath: 'README.md',
      elements: {
        editorContainer: document.getElementById('editor-container'),
        markdownToolbar: document.getElementById('markdown-toolbar'),
      },
      session: {
        applyMarkdownToolbarAction: vi.fn(() => true),
        insertText: vi.fn(),
      },
      toastController: { show: vi.fn() },
    };

    Object.assign(context, uiFeatureToolbarMethods);
    context.elements.markdownToolbar.addEventListener('click', (event) => {
      context.handleMarkdownToolbarClick(event);
    });
    context.renderMarkdownToolbar();

    const toggle = context.elements.markdownToolbar.querySelector('[data-markdown-block-menu-toggle]');
    toggle.click();
    expect(context.isMarkdownBlockMenuOpen()).toBe(true);
    expect(document.querySelector('.markdown-toolbar-popover')).not.toBeNull();

    const headingItem = document.querySelector('.markdown-toolbar-popover [data-markdown-block-action="heading-3"]');
    headingItem.click();

    expect(context.session.applyMarkdownToolbarAction).toHaveBeenCalledWith('heading-3');
    expect(context.elements.markdownToolbar.querySelector('[data-markdown-block-trigger-label]').textContent).toBe('H3');
    expect(context.isMarkdownBlockMenuOpen()).toBe(false);
  });

  it('uses a native popover for toolbar overflow', () => {
    document.body.innerHTML = `
      <div class="toolbar-right">
        <button id="toolbar-overflow-toggle" popovertarget="toolbar-overflow-menu"></button>
        <div id="toolbar-overflow-menu" popover="auto"></div>
      </div>
    `;

    const context = {
      elements: {
        toolbarOverflowMenu: document.getElementById('toolbar-overflow-menu'),
        toolbarOverflowToggle: document.getElementById('toolbar-overflow-toggle'),
      },
    };

    Object.assign(context, uiFeatureShellMethods);
    context.elements.toolbarOverflowToggle.click();
    expect(context.elements.toolbarOverflowMenu.matches(':popover-open')).toBe(true);

    context.closeToolbarOverflowMenu();
    expect(context.elements.toolbarOverflowMenu.matches(':popover-open')).toBe(false);
  });

  it('keeps the overflow popover open when toggling Vim mode', () => {
    document.body.innerHTML = `
      <div class="toolbar-right">
        <button id="toolbar-overflow-toggle" popovertarget="toolbar-overflow-menu"></button>
        <div id="toolbar-overflow-menu" popover="auto">
          <button id="vim-toggle"><span id="vim-label">Off</span></button>
        </div>
      </div>
    `;

    const context = {
      elements: {
        toolbarOverflowMenu: document.getElementById('toolbar-overflow-menu'),
        toolbarOverflowToggle: document.getElementById('toolbar-overflow-toggle'),
        toggleVimModeButton: document.getElementById('vim-toggle'),
        vimModeToggleLabel: document.getElementById('vim-label'),
      },
      preferences: {
        getVimModeEnabled: () => false,
        setVimModeEnabled: vi.fn(),
      },
      session: {
        isVimModeEnabled: () => false,
        setVimMode: vi.fn(),
      },
      toggleQuickSwitcher: vi.fn(),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();
    context.elements.toolbarOverflowToggle.click();
    context.elements.toggleVimModeButton.click();

    expect(context.elements.toolbarOverflowMenu.matches(':popover-open')).toBe(true);
    expect(context.elements.vimModeToggleLabel.textContent).toBe('On');
  });

  it('opens quick switcher from the mobile overflow search files action', () => {
    document.body.innerHTML = '<button id="search-files"></button>';

    const context = {
      elements: {
        searchFilesButton: document.getElementById('search-files'),
      },
      toggleQuickSwitcher: vi.fn(async () => {}),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.closeToolbarOverflowMenu = vi.fn();
    context.bindEvents();

    context.elements.searchFilesButton.click();

    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(context.closeToolbarOverflowMenu).toHaveBeenCalledTimes(1);
  });

  it('opens quick switcher from the top toolbar search action', () => {
    document.body.innerHTML = '<button id="toolbar-search"></button>';

    const context = {
      elements: {
        toolbarSearchButton: document.getElementById('toolbar-search'),
      },
      toggleQuickSwitcher: vi.fn(async () => {}),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.closeToolbarOverflowMenu = vi.fn();
    context.bindEvents();

    context.elements.toolbarSearchButton.click();

    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(1);
    expect(context.closeToolbarOverflowMenu).toHaveBeenCalledTimes(1);
  });

  it('opens editor search from the mobile find button', () => {
    document.body.innerHTML = '<button id="editor-find"></button>';

    const context = {
      elements: {
        editorFindButton: document.getElementById('editor-find'),
      },
      runEditorCommand: vi.fn(),
      toggleQuickSwitcher: vi.fn(async () => {}),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();

    context.elements.editorFindButton.click();

    expect(context.runEditorCommand).toHaveBeenCalledWith('openSearch');
  });

  it('formats the current document from the editor button', async () => {
    document.body.innerHTML = '<button id="editor-format"></button>';
    const formatDocument = vi.fn(async () => 'formatted');
    const show = vi.fn();
    const context = {
      currentFilePath: 'README.md',
      elements: {
        editorFormatButton: document.getElementById('editor-format'),
      },
      session: { formatDocument },
      toastController: { show },
      toggleQuickSwitcher: vi.fn(async () => {}),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();
    context.elements.editorFormatButton.click();
    await vi.waitFor(() => expect(show).toHaveBeenCalledWith('Document formatted'));

    expect(formatDocument).toHaveBeenCalledWith('README.md');
    expect(context.elements.editorFormatButton.disabled).toBe(false);
  });

  it('syncs app shell viewport css vars from visualViewport metrics', () => {
    const context = {};

    Object.assign(context, uiFeatureShellMethods);

    const originalVisualViewport = window.visualViewport;
    Object.defineProperty(window, 'visualViewport', {
      configurable: true,
      value: {
        height: 512,
        offsetTop: 24,
      },
    });

    try {
      context.syncVisualViewportBounds();
      expect(document.documentElement.style.getPropertyValue('--app-viewport-height')).toBe('512px');
      expect(document.documentElement.style.getPropertyValue('--app-viewport-offset-top')).toBe('24px');
    } finally {
      Object.defineProperty(window, 'visualViewport', {
        configurable: true,
        value: originalVisualViewport,
      });
      document.documentElement.style.removeProperty('--app-viewport-height');
      document.documentElement.style.removeProperty('--app-viewport-offset-top');
    }
  });

  it('binds global handlers for chat dismissal and keyboard shortcuts', () => {
    document.body.innerHTML = `
      <div id="chat-container"><button id="chat-inner"></button></div>
      <form id="chat-form"></form>
      <button id="chat-toggle"></button>
      <button id="share-button"></button>
      <button id="file-history"></button>
      <button id="review-file-changes"></button>
      <button id="edit-name"></button>
      <button id="display-name-cancel"></button>
      <button id="git-commit-cancel"></button>
      <button id="git-reset-cancel"></button>
      <button id="git-reset-submit"></button>
      <dialog id="git-commit-dialog"></dialog>
      <dialog id="git-reset-dialog"></dialog>
      <div id="markdown-toolbar"></div>
      <form id="display-name-form"></form>
      <form id="git-commit-form"></form>
      <button id="tab-lock-takeover"></button>
      <button id="toggle-wrap"></button>
      <div id="preview-content"></div>
      <button id="sidebar-toggle"></button>
      <button id="sidebar-close"></button>
      <button id="files-tab"></button>
      <button id="git-tab"></button>
    `;

    const context = {
      chatIsOpen: true,
      closeChatPanel: vi.fn(),
      currentFilePath: 'README.md',
      elements: {
        chatContainer: document.getElementById('chat-container'),
        chatForm: document.getElementById('chat-form'),
        chatToggleButton: document.getElementById('chat-toggle'),
        displayNameCancel: document.getElementById('display-name-cancel'),
        displayNameForm: document.getElementById('display-name-form'),
        editNameButton: document.getElementById('edit-name'),
        emptyStateNewFileBtn: null,
        emptyStateSearchBtn: null,
        fileHistoryButton: document.getElementById('file-history'),
        filesSidebarTab: document.getElementById('files-tab'),
        gitCommitCancel: document.getElementById('git-commit-cancel'),
        gitCommitDialog: document.getElementById('git-commit-dialog'),
        gitCommitForm: document.getElementById('git-commit-form'),
        gitCommitInput: document.createElement('input'),
        gitCommitSubmit: document.createElement('button'),
        gitResetCancel: document.getElementById('git-reset-cancel'),
        gitResetDialog: document.getElementById('git-reset-dialog'),
        gitResetFileName: document.createElement('input'),
        gitResetSubmit: document.getElementById('git-reset-submit'),
        gitSearch: document.createElement('div'),
        gitSidebarTab: document.getElementById('git-tab'),
        markdownToolbar: document.getElementById('markdown-toolbar'),
        previewContent: document.getElementById('preview-content'),
        reviewFileChangesButton: document.getElementById('review-file-changes'),
        shareButton: document.getElementById('share-button'),
        sidebarClose: document.getElementById('sidebar-close'),
        sidebarToggle: document.getElementById('sidebar-toggle'),
        tabLockTakeoverButton: document.getElementById('tab-lock-takeover'),
        toggleWrapButton: document.getElementById('toggle-wrap'),
      },
      gitRepoAvailable: true,
      handleChatSubmit: vi.fn(),
      handleDisplayNameSubmit: vi.fn(),
      handleFileHistorySelection: vi.fn(),
      handleGitCommitSubmit: vi.fn(),
      handleGitDiffSelection: vi.fn(),
      handleGitFileHistorySelection: vi.fn(),
      handleGitResetSubmit: vi.fn(),
      handleHashChange: vi.fn(),
      handleTabTakeover: vi.fn(),
      handleToolbarImageInsert: vi.fn(),
      handleWikiLinkClick: vi.fn(),
      navigation: { getHashRoute: () => ({ type: 'empty' }) },
      openDisplayNameDialog: vi.fn(),
      setSidebarTab: vi.fn(),
      toggleLineWrapping: vi.fn(),
      toggleQuickSwitcher: vi.fn(async () => {}),
      toggleSidebar: vi.fn(),
      copyCurrentLink: vi.fn(async () => {}),
      closeSidebarOnMobile: vi.fn(),
      applyMarkdownToolbarAction: vi.fn(),
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();

    context.elements.reviewFileChangesButton.click();
    expect(context.handleGitDiffSelection).toHaveBeenCalledWith('README.md', {
      closeSidebarOnMobile: true,
      scope: 'all',
    });


    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'k' }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(1);

    document.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, ctrlKey: true, key: 'K' }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(2);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      code: 'KeyK',
      key: 'Unidentified',
      metaKey: true,
    }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(3);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      key: 'K',
      metaKey: true,
      shiftKey: true,
    }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(3);

    document.dispatchEvent(new KeyboardEvent('keydown', {
      bubbles: true,
      ctrlKey: true,
      key: 'k',
      repeat: true,
    }));
    expect(context.toggleQuickSwitcher).toHaveBeenCalledTimes(3);
  });

  it('resets the quick switcher loader after a lazy import failure', async () => {
    const loadError = new Error('chunk failed');
    class TestQuickSwitcher {
      constructor(options) {
        this.options = options;
      }
    }

    const context = {
      fileExplorer: { flatFiles: ['README.md'] },
      isMobileViewport: () => true,
      loadQuickSwitcherController: vi.fn()
        .mockRejectedValueOnce(loadError)
        .mockResolvedValueOnce(TestQuickSwitcher),
      quickSwitcher: null,
      quickSwitcherModulePromise: null,
      toastController: { show: vi.fn() },
      workspaceRouteController: {
        handleFileSelection: vi.fn(),
      },
    };
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(ensureQuickSwitcherInstance(context)).rejects.toThrow('chunk failed');

    expect(context.quickSwitcherModulePromise).toBeNull();
    expect(context.toastController.show).toHaveBeenCalledWith('Failed to load file search. Try again.', {
      dismissible: true,
    });
    expect(consoleError).toHaveBeenCalled();

    const quickSwitcher = await ensureQuickSwitcherInstance(context);

    expect(context.loadQuickSwitcherController).toHaveBeenCalledTimes(2);
    expect(quickSwitcher).toBeInstanceOf(TestQuickSwitcher);
    expect(quickSwitcher.options.getFileList()).toEqual(['README.md']);
    quickSwitcher.options.onFileSelect('docs/guide.md');
    expect(context.workspaceRouteController.handleFileSelection).toHaveBeenCalledWith('docs/guide.md', {
      closeSidebarOnMobile: true,
      revealInTree: false,
    });
  });

  it('toggles preview task items from preview clicks without hijacking wiki links', () => {
    document.body.innerHTML = `
      <div id="preview-content">
        <ul>
          <li class="task-list-item" data-source-line="7">
            <input type="checkbox" data-task-checkbox="true">
            First todo
          </li>
          <li class="task-list-item" data-source-line="8">
            <input type="checkbox" data-task-checkbox="true">
            Read <a href="https://example.com/docs">docs</a>
          </li>
        </ul>
        <a class="wiki-link" data-wiki-target="README" href="#README">README</a>
      </div>
    `;

    const context = {
      elements: {
        previewContent: document.getElementById('preview-content'),
      },
      handlePreviewContentClick: uiFeatureShellMethods.handlePreviewContentClick,
      session: {
        toggleTaskListItem: vi.fn(() => true),
      },
      wikiLinkFileController: {
        handleWikiLinkClick: vi.fn(),
      },
    };

    Object.assign(context, uiFeatureShellMethods);
    context.bindEvents();

    const checkbox = context.elements.previewContent.querySelector('input[type="checkbox"]');
    checkbox.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(context.session.toggleTaskListItem).toHaveBeenCalledWith(7);
    expect(checkbox.checked).toBe(false);

    const externalLink = context.elements.previewContent.querySelector('li[data-source-line="8"] a');
    const externalClick = {
      preventDefault: vi.fn(),
      target: externalLink,
    };
    context.handlePreviewContentClick(externalClick);

    expect(context.session.toggleTaskListItem).toHaveBeenCalledTimes(1);
    expect(externalClick.preventDefault).not.toHaveBeenCalled();

    const wikiLink = context.elements.previewContent.querySelector('a.wiki-link');
    wikiLink.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(context.wikiLinkFileController.handleWikiLinkClick).toHaveBeenCalledWith('README');
    expect(context.session.toggleTaskListItem).toHaveBeenCalledTimes(1);

    context.session.toggleTaskListItem.mockClear();
    const taskItem = context.elements.previewContent.querySelector('li[data-source-line="7"]');
    const taskText = Array.from(taskItem.childNodes)
      .find((node) => node.nodeType === Node.TEXT_NODE && node.textContent.includes('First todo'));
    const range = document.createRange();
    const start = taskText.textContent.indexOf('First todo');
    range.setStart(taskText, start);
    range.setEnd(taskText, start + 'First todo'.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);

    taskItem.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));

    expect(context.session.toggleTaskListItem).not.toHaveBeenCalled();
  });

  it('scrolls preview fragment links through shared heading navigation without intercepting app hash routes', () => {
    document.body.innerHTML = `
      <div id="previewContainer">
        <div id="preview-content">
          <p>
            <a id="jump-link" href="#section-a">Jump</a>
            <a id="top-link" href="#top">Top</a>
            <a id="route-link" href="#file=other.md">Route</a>
            <a id="reserved-heading-link" href="#file">File heading</a>
          </p>
          <h2 id="section-a">Section A</h2>
          <h2 id="file">File</h2>
        </div>
      </div>
    `;

    const previewContainer = document.getElementById('previewContainer');
    const previewContent = document.getElementById('preview-content');
    const targetHeading = document.getElementById('section-a');
    const reservedHeading = document.getElementById('file');
    const scrollTo = vi.fn();
    previewContainer.scrollTo = scrollTo;

    const context = {
      elements: {
        previewContainer,
        previewContent,
      },
      outlineController: {
        navigateToHeading: vi.fn(() => true),
      },
      scrollSyncController: {
        suspendSync: vi.fn(),
      },
      session: {
        toggleTaskListItem: vi.fn(),
      },
    };

    Object.assign(context, uiFeatureShellMethods);

    const fragmentClick = {
      preventDefault: vi.fn(),
      target: document.getElementById('jump-link'),
    };
    context.handlePreviewContentClick(fragmentClick);

    expect(fragmentClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.outlineController.navigateToHeading).toHaveBeenCalledWith(targetHeading, 'section-a', { behavior: 'smooth' });
    expect(context.scrollSyncController.suspendSync).not.toHaveBeenCalled();
    expect(scrollTo).not.toHaveBeenCalled();

    const reservedHeadingClick = {
      preventDefault: vi.fn(),
      target: document.getElementById('reserved-heading-link'),
    };
    context.handlePreviewContentClick(reservedHeadingClick);

    expect(reservedHeadingClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.outlineController.navigateToHeading).toHaveBeenCalledWith(reservedHeading, 'file', { behavior: 'smooth' });

    const topClick = {
      preventDefault: vi.fn(),
      target: document.getElementById('top-link'),
    };
    context.handlePreviewContentClick(topClick);

    expect(topClick.preventDefault).toHaveBeenCalledTimes(1);
    expect(context.scrollSyncController.suspendSync).toHaveBeenCalledWith(250);
    expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' });

    const routeClick = {
      preventDefault: vi.fn(),
      target: document.getElementById('route-link'),
    };
    context.handlePreviewContentClick(routeClick);

    expect(routeClick.preventDefault).not.toHaveBeenCalled();
    expect(scrollTo).toHaveBeenCalledTimes(1);
  });

  it('adds preview code copy buttons and copies only the code content', async () => {
    document.body.innerHTML = `
      <div id="preview-content">
        <pre><code class="language-json"><span>{</span>\n  "customerId": "string"\n}</code></pre>
      </div>
    `;

    const previewContent = document.getElementById('preview-content');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });
    const context = {
      elements: { previewContent },
      toastController: { show: vi.fn() },
    };
    Object.assign(context, uiFeatureShellMethods);

    context.attachPreviewCodeCopyButton(previewContent.querySelector('pre'));

    const button = previewContent.querySelector('.preview-code-copy-button');
    expect(previewContent.querySelectorAll('.preview-code-copy-button')).toHaveLength(1);
    expect(button.getAttribute('aria-label')).toBe('Copy code');


    const clickEvent = { preventDefault: vi.fn(), target: button };
    context.handlePreviewContentClick(clickEvent);
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('{\n  "customerId": "string"\n}');
      expect(context.toastController.show).toHaveBeenCalledWith('Code copied');
    });

    expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1);
  });

  it('folds heading sections while preserving nested folds', () => {
    document.body.innerHTML = `
      <div id="preview-content" class="preview-content">
        <h1>Document</h1>
        <h2>Section A</h2>
        <p id="section-a-content">A content</p>
        <h3>Section B</h3>
        <p id="section-b-content">B content</p>
        <h2>Section C</h2>
        <p id="section-c-content">C content</p>
      </div>
    `;

    const previewContent = document.getElementById('preview-content');
    const context = {
      elements: { previewContent },
      refreshCommentUiLayout: vi.fn(),
      schedulePreviewLayoutSync: vi.fn(),
      scrollSyncController: { invalidatePreviewBlocks: vi.fn() },
    };
    Object.assign(context, uiFeatureShellMethods);
    context.syncPreviewHeadingFoldButtons();
    expect(previewContent.querySelectorAll('.preview-heading-fold-button')).toHaveLength(0);

    const [sectionA, sectionB, sectionC] = previewContent.querySelectorAll('h2, h3');

    const clickFold = (heading) => {
      context.attachPreviewHeadingControls(heading);
      context.handlePreviewContentClick({
        preventDefault: vi.fn(),
        target: heading.querySelector('.preview-heading-fold-button'),
      });
    };
    clickFold(sectionB);
    const sectionBButton = context._previewHeadingFoldButton;


    expect(sectionBButton.getAttribute('aria-expanded')).toBe('false');
    expect(sectionBButton.getAttribute('aria-label')).toBe('Expand Section B');
    expect(document.getElementById('section-b-content').hidden).toBe(true);
    expect(sectionC.hidden).toBe(false);

    clickFold(sectionA);

    expect(document.getElementById('section-a-content').hidden).toBe(true);
    expect(sectionB.hidden).toBe(true);
    expect(sectionC.hidden).toBe(false);

    clickFold(sectionA);

    expect(document.getElementById('section-a-content').hidden).toBe(false);
    expect(sectionB.hidden).toBe(false);
    expect(document.getElementById('section-b-content').hidden).toBe(true);

    clickFold(sectionA);
    expect(sectionB.hidden).toBe(true);

    expect(context.unfoldPreviewHeading(sectionB)).toBe(true);
    expect(sectionA.dataset.previewHeadingCollapsed).toBeUndefined();
    expect(sectionB.dataset.previewHeadingCollapsed).toBeUndefined();
    expect(document.getElementById('section-a-content').hidden).toBe(false);
    expect(document.getElementById('section-b-content').hidden).toBe(false);
    expect(context.scrollSyncController.invalidatePreviewBlocks).toHaveBeenCalledTimes(5);
  });

  it('copies preview heading links and applies pending route anchors', async () => {
    document.body.innerHTML = `
      <div id="previewContainer">
        <div id="preview-content" data-render-phase="ready">
          <h2 id="section-a" data-source-line="12">Section A</h2>
          <h3 id="section-b">Approach E: Push MongoDB to enable <code>Live Migration Service</code> on Jakarta cluster</h3>
        </div>
      </div>
    `;

    const previewContainer = document.getElementById('previewContainer');
    const previewContent = document.getElementById('preview-content');
    const targetHeading = document.getElementById('section-a');
    const writeText = vi.fn(async () => {});
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: { writeText },
    });

    const context = {
      _pendingPreviewRouteAnchor: null,
      currentDrawioMode: null,
      currentFilePath: 'MongoDB/migration-plan.md',
      elements: {
        previewContainer,
        previewContent,
      },
      outlineController: {
        navigateToHeading: vi.fn(() => true),
      },
      scrollSyncController: {
        suspendSync: vi.fn(),
      },
      session: {
        scrollToLine: vi.fn(),
        toggleTaskListItem: vi.fn(),
      },
      toastController: {
        show: vi.fn(),
      },
    };

    Object.assign(context, uiFeatureShellMethods);
    window.location.hash = 'file=MongoDB%2Fmigration-plan.md';

    context.attachPreviewHeadingControls(document.getElementById('section-a'));
    const button = previewContent.querySelector('#section-a .preview-heading-link-button');
    expect(button).not.toBeNull();
    expect(button.getAttribute('aria-label')).toBe('Copy link to Section A');

    context.attachPreviewHeadingControls(document.getElementById('section-b'));
    const complexHeadingButton = previewContent.querySelector('#section-b .preview-heading-link-button');
    expect(complexHeadingButton).not.toBeNull();
    expect(complexHeadingButton.getAttribute('aria-label')).toBe('Copy link to Approach E: Push MongoDB to enable Live Migration Service on Jakarta cluster');

    context.attachPreviewHeadingControls(document.getElementById('section-a'));
    const sectionAButton = previewContent.querySelector('#section-a .preview-heading-link-button');
    const clickEvent = {
      preventDefault: vi.fn(),
      target: sectionAButton,
    };
    context.handlePreviewContentClick(clickEvent);

    expect(clickEvent.preventDefault).toHaveBeenCalledTimes(1);
    const expectedUrl = new URL(window.location.href);
    expectedUrl.hash = '#file=MongoDB%2Fmigration-plan.md&anchor=section-a';
    expect(writeText).toHaveBeenCalledWith(expectedUrl.toString());

    writeText.mockClear();
    await context.copyPreviewHeadingLink('section-a');
    expect(writeText).toHaveBeenCalledWith(expectedUrl.toString());
    expect(context.toastController.show).toHaveBeenCalledWith('Section link copied');

    context.requestPreviewRouteAnchor('section-a', 'MongoDB/migration-plan.md');
    expect(context.outlineController.navigateToHeading).toHaveBeenCalledWith(targetHeading, 'section-a', { behavior: 'auto' });
    expect(context.session.scrollToLine).not.toHaveBeenCalled();
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      anchorId: 'section-a',
      applied: true,
      filePath: 'MongoDB/migration-plan.md',
    });
  });

  it('keeps pending route anchors until the first preview render commits', () => {
    document.body.innerHTML = `
      <div id="previewContainer">
        <div id="preview-content" data-render-phase="shell"></div>
      </div>
    `;

    const previewContainer = document.getElementById('previewContainer');
    const previewContent = document.getElementById('preview-content');
    const scrollTo = vi.fn();
    previewContainer.scrollTo = scrollTo;
    previewContainer.getBoundingClientRect = () => ({ top: 100 });

    const context = {
      _pendingPreviewRouteAnchor: null,
      currentFilePath: 'MongoDB/migration-plan.md',
      elements: {
        previewContainer,
        previewContent,
      },
      scrollSyncController: {
        suspendSync: vi.fn(),
      },
      session: {
        scrollToLine: vi.fn(),
      },
    };

    Object.assign(context, uiFeatureShellMethods);

    expect(context.requestPreviewRouteAnchor('section-a', 'MongoDB/migration-plan.md')).toBe(false);
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      anchorId: 'section-a',
      applied: false,
      filePath: 'MongoDB/migration-plan.md',
    });

    previewContent.dataset.renderPhase = 'ready';
    previewContent.innerHTML = '<h2 id="section-a" data-source-line="12">Section A</h2>';
    const targetHeading = document.getElementById('section-a');
    targetHeading.getBoundingClientRect = () => ({ top: 340, height: 28 });

    expect(context.applyPendingPreviewRouteAnchor({ behavior: 'auto' })).toBe(true);
    expect(context.session.scrollToLine).toHaveBeenCalledWith(12, 0);
    expect(scrollTo).toHaveBeenCalled();
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      anchorId: 'section-a',
      applied: true,
      appliedCount: 1,
      filePath: 'MongoDB/migration-plan.md',
    });
  });

  it('reapplies active route anchors after delayed preview layout changes', () => {
    document.body.innerHTML = `
      <div id="previewContainer">
        <div id="preview-content" data-render-phase="ready">
          <h2 id="section-a" data-source-line="12">Section A</h2>
        </div>
      </div>
    `;

    const previewContainer = document.getElementById('previewContainer');
    const targetHeading = document.getElementById('section-a');
    const scrollTo = vi.fn();
    previewContainer.scrollTo = scrollTo;
    previewContainer.scrollTop = 0;
    previewContainer.getBoundingClientRect = () => ({ top: 100 });
    targetHeading.getBoundingClientRect = () => ({ top: 340, height: 28 });

    const context = {
      _pendingPreviewRouteAnchor: null,
      currentFilePath: 'MongoDB/migration-plan.md',
      elements: {
        previewContainer,
        previewContent: document.getElementById('preview-content'),
      },
      scrollSyncController: {
        suspendSync: vi.fn(),
      },
      session: {
        scrollToLine: vi.fn(),
      },
    };

    Object.assign(context, uiFeatureShellMethods);

    expect(context.requestPreviewRouteAnchor('section-a', 'MongoDB/migration-plan.md')).toBe(true);
    targetHeading.getBoundingClientRect = () => ({ top: 580, height: 28 });

    expect(context.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: false })).toBe(true);
    expect(scrollTo).toHaveBeenCalledTimes(2);
    expect(scrollTo).toHaveBeenLastCalledWith({ behavior: 'auto', top: 480 });
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      anchorId: 'section-a',
      applied: true,
      appliedCount: 2,
    });
  });

  it('allows render completion to correct slow route anchor hydration once the settle window expired', () => {
    document.body.innerHTML = `
      <div id="previewContainer">
        <div id="preview-content" data-render-phase="ready">
          <h2 id="section-a" data-source-line="12">Section A</h2>
        </div>
      </div>
    `;

    const previewContainer = document.getElementById('previewContainer');
    const targetHeading = document.getElementById('section-a');
    const scrollTo = vi.fn();
    previewContainer.scrollTo = scrollTo;
    previewContainer.scrollTop = 0;
    previewContainer.getBoundingClientRect = () => ({ top: 100 });
    targetHeading.getBoundingClientRect = () => ({ top: 420, height: 28 });

    const context = {
      _pendingPreviewRouteAnchor: {
        anchorId: 'section-a',
        applied: true,
        appliedCount: 1,
        filePath: 'MongoDB/migration-plan.md',
        stabilizeUntil: 0,
      },
      currentFilePath: 'MongoDB/migration-plan.md',
      elements: {
        previewContainer,
        previewContent: document.getElementById('preview-content'),
      },
      scrollSyncController: {
        suspendSync: vi.fn(),
      },
      session: {
        scrollToLine: vi.fn(),
      },
    };

    Object.assign(context, uiFeatureShellMethods);

    expect(context.applyPendingPreviewRouteAnchor({ behavior: 'auto' })).toBe(false);
    expect(scrollTo).not.toHaveBeenCalled();

    context._pendingPreviewRouteAnchor = {
      anchorId: 'section-a',
      applied: true,
      appliedCount: 1,
      filePath: 'MongoDB/migration-plan.md',
      stabilizeUntil: 0,
    };

    expect(context.applyPendingPreviewRouteAnchor({ allowExpired: true, behavior: 'auto' })).toBe(true);
    expect(scrollTo).toHaveBeenCalledWith({ behavior: 'auto', top: 320 });
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      applied: true,
      appliedCount: 2,
      anchorId: 'section-a',
    });
  });

  it('clears missing pending route anchors only after a committed preview render', () => {
    document.body.innerHTML = `
      <div id="previewContainer">
        <div id="preview-content" data-render-phase="ready"></div>
      </div>
    `;

    const context = {
      _pendingPreviewRouteAnchor: null,
      currentFilePath: 'MongoDB/migration-plan.md',
      elements: {
        previewContent: document.getElementById('preview-content'),
      },
    };

    Object.assign(context, uiFeatureShellMethods);

    expect(context.requestPreviewRouteAnchor('missing-section', 'MongoDB/migration-plan.md')).toBe(false);
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      anchorId: 'missing-section',
      applied: false,
      filePath: 'MongoDB/migration-plan.md',
    });

    expect(context.applyPendingPreviewRouteAnchor({ behavior: 'auto' })).toBe(false);
    expect(context._pendingPreviewRouteAnchor).toMatchObject({
      anchorId: 'missing-section',
      applied: false,
      filePath: 'MongoDB/migration-plan.md',
    });

    expect(context.applyPendingPreviewRouteAnchor({ behavior: 'auto', clearMissing: true })).toBe(false);
    expect(context._pendingPreviewRouteAnchor).toBeNull();
  });
});
