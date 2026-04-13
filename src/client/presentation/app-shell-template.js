import { html } from 'lit-html';

import { badgeClassNames } from './components/ui/badge.js';
import { buttonClassNames, iconButtonClassNames } from './components/ui/button.js';
import { inputClassNames } from './components/ui/input.js';
import { segmentedButtonClassNames, segmentedControlClassNames } from './components/ui/segmented-control.js';

export function appShellTemplate() {
  return html`
    <a href="#editorContainer" class="sr-only skip-link">Skip to editor</a>

    <div class="app-shell">
      <aside id="sidebar" class="sidebar">
        <div class="sidebar-header">
          <div class="sidebar-brand">
            <svg width="20" height="20" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">
              <rect x="6" y="8" width="28" height="38" rx="4" stroke="var(--color-primary)" stroke-width="2" fill="var(--color-primary)" fill-opacity="0.12"></rect>
              <rect x="22" y="10" width="28" height="38" rx="4" stroke="var(--color-primary)" stroke-width="2" fill="var(--color-primary)" fill-opacity="0.25"></rect>
              <path d="M14 20l4 10 1.5-4 4-1.5L14 20z" fill="var(--color-primary)" opacity="0.7"></path>
              <path d="M38 28l-4-10-1.5 4-4 1.5L38 28z" fill="var(--color-primary)"></path>
            </svg>
            <span class="sidebar-title">CollabMD</span>
          </div>
          <div class="sidebar-actions">
            <button class=${iconButtonClassNames({ extra: 'sidebar-close-btn' })} id="sidebarClose" aria-label="Close sidebar" title="Close sidebar">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="18" y1="6" x2="6" y2="18"></line>
                <line x1="6" y1="6" x2="18" y2="18"></line>
              </svg>
            </button>
            <div class="sidebar-create-shell">
              <button
                class=${buttonClassNames({ variant: 'secondary', size: 'compact', pill: true, extra: 'sidebar-create-btn' })}
                id="sidebarCreateBtn"
                aria-label="Create"
                aria-expanded="false"
                aria-haspopup="menu"
                title="Create file or folder"
              >
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                <span class="sidebar-create-btn-label">Create</span>
              </button>
            </div>
            <button class=${iconButtonClassNames()} id="refreshFilesBtn" aria-label="Refresh" title="Refresh file list">
              <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <polyline points="23 4 23 10 17 10"></polyline>
                <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10"></path>
              </svg>
            </button>
          </div>
        </div>
        <div class="ui-nav-tabs hidden" id="sidebarTabs">
          <button class="ui-nav-tab active" id="filesSidebarTab" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
              <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path>
            </svg>
            Files
          </button>
          <button class="ui-nav-tab hidden" id="gitSidebarTab" type="button">
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
              <circle cx="18" cy="18" r="3"></circle>
              <circle cx="6" cy="6" r="3"></circle>
              <path d="M13 6h3a2 2 0 0 1 2 2v7"></path>
              <path d="M6 9v12"></path>
            </svg>
            Git
          </button>
        </div>
        <div class="sidebar-search" id="fileSearch">
          <input
            type="text"
            class=${inputClassNames({ extra: 'sidebar-search-input' })}
            id="fileSearchInput"
            placeholder="Search files..."
            autocomplete="off"
            spellcheck="false"
            aria-label="Search files"
          >
        </div>
        <div class="sidebar-search hidden" id="gitSearch">
          <input
            type="text"
            class=${inputClassNames({ extra: 'sidebar-search-input' })}
            id="gitSearchInput"
            placeholder="Search changes..."
            autocomplete="off"
            spellcheck="false"
            aria-label="Search changed files"
          >
        </div>
        <nav id="fileTree" class="file-tree" aria-label="File explorer"></nav>
        <div id="gitPanel" class="git-panel hidden" aria-label="Git changes"></div>
      </aside>

      <main class="main-area" id="mainContent">
        <header class="toolbar" role="banner">
          <div class="toolbar-left">
            <button class=${buttonClassNames({ variant: 'ghost', toolbar: true })} id="sidebarToggle" aria-label="Toggle sidebar" title="Toggle sidebar">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                <line x1="3" y1="6" x2="21" y2="6"></line>
                <line x1="3" y1="12" x2="21" y2="12"></line>
                <line x1="3" y1="18" x2="21" y2="18"></line>
              </svg>
            </button>
            <div class="toolbar-room-info">
              <span class="toolbar-room-name" id="activeFileName">CollabMD</span>
              <span class=${badgeClassNames({ tone: 'accent', extra: 'toolbar-badge' })} id="userCount"></span>
              <span class=${badgeClassNames({ tone: 'accent', hidden: true, extra: 'toolbar-badge' })} id="toolbarDiffBadge">Diff</span>
              <span class=${badgeClassNames({ tone: 'accent', hidden: true, extra: 'toolbar-badge' })} id="gitOperationStatus" aria-live="polite" aria-atomic="true"></span>
            </div>
          </div>

          <div class="toolbar-center" id="toolbarCenter">
            <div class=${segmentedControlClassNames({ extra: 'view-toggle' })} role="group" aria-label="View mode">
              <button class=${segmentedButtonClassNames({ active: true, extra: 'view-btn' })} data-view="split" aria-label="Split view" aria-pressed="true" title="Split view">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                  <line x1="12" y1="3" x2="12" y2="21"></line>
                </svg>
              </button>
              <button class=${segmentedButtonClassNames({ extra: 'view-btn' })} data-view="editor" aria-label="Editor only" aria-pressed="false" title="Editor only">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <rect x="3" y="3" width="18" height="18" rx="2"></rect>
                  <line x1="8" y1="8" x2="16" y2="8"></line>
                  <line x1="8" y1="12" x2="14" y2="12"></line>
                  <line x1="8" y1="16" x2="12" y2="16"></line>
                </svg>
              </button>
              <button class=${segmentedButtonClassNames({ extra: 'view-btn' })} data-view="preview" aria-label="Preview only" aria-pressed="false" title="Preview only">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                  <circle cx="12" cy="12" r="3"></circle>
                </svg>
              </button>
            </div>
          </div>

          <div class="toolbar-right">
            <button class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'mobile-view-toggle' })} id="mobileViewToggle" aria-label="Toggle editor/preview" title="Toggle view">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"></path>
                <circle cx="12" cy="12" r="3"></circle>
              </svg>
              <span class="ui-toolbar-button-label">Preview</span>
            </button>

            <div class="user-avatars toolbar-presence-cluster" id="userAvatars"></div>

            <div class="chat-container" id="chatContainer">
              <button class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'chat-toggle-btn' })} id="chatToggleBtn" aria-label="Open team chat" aria-expanded="false" title="Team chat">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                </svg>
                <span class="ui-toolbar-button-label">Chat</span>
                <span class=${badgeClassNames({ tone: 'solid', count: true, hidden: true, extra: 'chat-toggle-badge' })} id="chatToggleBadge">0</span>
              </button>
              <div class="toast-container chat-toast-container" id="chatToastContainer" aria-live="polite" aria-atomic="true"></div>

              <section class="chat-panel hidden" id="chatPanel" aria-label="Team chat">
                <div class="chat-panel-header">
                  <div>
                    <h2 class="chat-panel-title">Team chat</h2>
                    <p class="chat-panel-status" id="chatStatus">Syncing...</p>
                  </div>
                  <button
                    class=${buttonClassNames({
                      variant: 'secondary',
                      size: 'compact',
                      pill: true,
                      surface: true,
                      action: true,
                      extra: 'chat-notification-action',
                    })}
                    id="chatNotificationBtn"
                    type="button"
                  >
                    Enable alerts
                  </button>
                </div>

                <div class="chat-empty-state" id="chatEmptyState">
                  Temporary room chat for whoever is online right now.
                </div>
                <div class="chat-messages hidden" id="chatMessages" role="log" aria-live="polite" aria-relevant="additions text"></div>

                <form class="chat-form" id="chatForm">
                  <input
                    type="text"
                    class=${inputClassNames({ extra: 'chat-input' })}
                    id="chatInput"
                    placeholder="Send a quick update..."
                    autocomplete="off"
                    spellcheck="true"
                    maxlength="280"
                    aria-label="Team chat message"
                  >
                  <button type="submit" class=${buttonClassNames({ variant: 'primary', extra: 'chat-send-btn' })}>Send</button>
                </form>
              </section>
            </div>

            <button
              class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'toolbar-overflow-toggle' })}
              id="toolbarOverflowToggle"
              aria-label="Open more actions"
              aria-expanded="false"
              title="More actions"
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                <circle cx="12" cy="12" r="1"></circle>
                <circle cx="19" cy="12" r="1"></circle>
                <circle cx="5" cy="12" r="1"></circle>
              </svg>
            </button>

            <div class="toolbar-overflow-menu" id="toolbarOverflowMenu">
              <button class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'hidden' })} id="fileHistoryBtn" aria-label="Open file history" title="View file history">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                  <path d="M3 12a9 9 0 1 0 3-6.7"></path>
                  <path d="M3 4v5h5"></path>
                  <path d="M12 7v5l3 3"></path>
                </svg>
                <span class="ui-toolbar-button-label" id="fileHistoryBtnLabel">History</span>
              </button>

              <button class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'ui-toolbar-button--name' })} id="editNameBtn" aria-label="Set name. Change display name" title="Change display name">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
                  <path d="M12 20h9"></path>
                  <path d="M16.5 3.5a2.12 2.12 0 1 1 3 3L7 19l-4 1 1-4Z"></path>
                </svg>
                <span class="ui-toolbar-button-label ui-toolbar-button-text" id="currentUserName">Set name</span>
              </button>

              <button class=${buttonClassNames({ variant: 'ghost', toolbar: true })} id="shareBtn" aria-label="Share. Copy link" title="Share link">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"></path>
                  <path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"></path>
                </svg>
                <span class="ui-toolbar-button-label">Share</span>
              </button>

              <button class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'toolbar-search-files-btn' })} id="searchFilesBtn" aria-label="Search files" title="Search files">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                  <circle cx="11" cy="11" r="7"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                <span class="ui-toolbar-button-label">Search files</span>
              </button>

              <details class="toolbar-overflow-group hidden" id="exportMenuGroup">
                <summary class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'toolbar-overflow-group-toggle' })} aria-label="Export options" title="Export">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                    <polyline points="14 2 14 8 20 8"></polyline>
                    <path d="M12 18v-6"></path>
                    <path d="m9 15 3 3 3-3"></path>
                  </svg>
                  <span class="ui-toolbar-button-label">Export</span>
                </summary>
                <div class="toolbar-overflow-submenu">
                  <button class=${buttonClassNames({ variant: 'ghost', toolbar: true })} id="exportDocxBtn" aria-label="Export DOCX" title="Export DOCX">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
                      <polyline points="14 2 14 8 20 8"></polyline>
                      <path d="M8 13h2l1.2 2 1.6-4 1.2 2H18"></path>
                    </svg>
                    <span class="ui-toolbar-button-label">Export DOCX</span>
                  </button>
                  <button class=${buttonClassNames({ variant: 'ghost', toolbar: true })} id="exportPdfBtn" aria-label="Print or save PDF" title="Print / Save PDF">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M6 9V2h12v7"></path>
                      <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2"></path>
                      <rect x="6" y="14" width="12" height="8"></rect>
                    </svg>
                    <span class="ui-toolbar-button-label">Print / Save PDF</span>
                  </button>
                </div>
              </details>

              <button class=${buttonClassNames({ variant: 'ghost', toolbar: true, extra: 'toolbar-theme-button' })} id="themeToggleBtn" data-theme-toggle aria-label="Toggle theme" title="Toggle theme">
                <span class="toolbar-theme-icon" data-theme-toggle-icon aria-hidden="true">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                    <circle cx="12" cy="12" r="5"></circle>
                    <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"></path>
                  </svg>
                </span>
                <span class="ui-toolbar-button-label">Theme</span>
                <span class=${badgeClassNames({ tone: 'muted', extra: 'toolbar-theme-state' })} data-theme-toggle-state>Dark</span>
              </button>
            </div>
          </div>
        </header>

        <div id="emptyState" class="empty-state">
          <div class="empty-state-content">
            <div class="empty-state-logo" aria-hidden="true">
              <svg width="48" height="48" viewBox="0 0 56 56" fill="none" xmlns="http://www.w3.org/2000/svg">
                <rect x="6" y="8" width="28" height="38" rx="4" stroke="var(--color-primary)" stroke-width="2" fill="var(--color-primary)" fill-opacity="0.12"></rect>
                <rect x="22" y="10" width="28" height="38" rx="4" stroke="var(--color-primary)" stroke-width="2" fill="var(--color-primary)" fill-opacity="0.25"></rect>
                <path d="M14 20l4 10 1.5-4 4-1.5L14 20z" fill="var(--color-primary)" opacity="0.7"></path>
                <path d="M38 28l-4-10-1.5 4-4 1.5L38 28z" fill="var(--color-primary)"></path>
              </svg>
            </div>
            <h2 class="empty-state-title">Welcome to CollabMD</h2>
            <p class="empty-state-desc">Open a file from the sidebar, or get started quickly:</p>
            <div class="empty-state-actions">
              <button class=${buttonClassNames({ variant: 'secondary', extra: 'empty-state-btn' })} id="emptyStateNewFileBtn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <line x1="12" y1="5" x2="12" y2="19"></line>
                  <line x1="5" y1="12" x2="19" y2="12"></line>
                </svg>
                Create
              </button>
              <button class=${buttonClassNames({ variant: 'secondary', extra: 'empty-state-btn' })} id="emptyStateSearchBtn">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                  <circle cx="11" cy="11" r="8"></circle>
                  <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                </svg>
                Search Everything
                <kbd class="empty-state-kbd">⌘K</kbd>
              </button>
            </div>
          </div>
        </div>

        <div id="editor-page" class="editor-page hidden">
          <div class="editor-layout" id="editorLayout" data-view="split">
            <div class="editor-pane" id="editorPane">
              <div class="pane-header">
                <div class="pane-header-meta">
                  <span class="pane-label">Editor</span>
                  <span class="pane-label-meta" id="lineInfo">Ln 1, Col 1</span>
                </div>
                <div class="pane-header-actions">
                  <button class=${buttonClassNames({ variant: 'ghost', size: 'compact', toggle: true, extra: 'mobile-editor-find-btn' })} id="editorFindBtn" aria-label="Find in file" title="Find in file">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                      <circle cx="11" cy="11" r="7"></circle>
                      <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
                    </svg>
                    <span class="ui-action-label">Find</span>
                  </button>
                  <button class=${buttonClassNames({ variant: 'ghost', size: 'compact', toggle: true, extra: 'hidden' })} id="commentSelectionBtn" aria-label="Comment current line or selection" title="Comment current line or selection">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span class="ui-action-label">Comment</span>
                  </button>
                  <button class=${buttonClassNames({ variant: 'ghost', size: 'compact', toggle: true })} id="toggleWrapBtn" aria-label="Disable line wrap" title="Disable line wrap">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M3 6h14a4 4 0 1 1 0 8H9"></path>
                      <path d="m9 10-4 4 4 4"></path>
                      <path d="M3 18h7"></path>
                    </svg>
                    <span id="wrapToggleLabel">Wrap on</span>
                  </button>
                </div>
              </div>
              <div id="markdownToolbar" class="markdown-toolbar hidden" role="toolbar" aria-label="Markdown formatting"></div>
              <div id="editorContainer" class="editor-container">
                <div class="editor-loading" id="editorLoading">
                  <div class="skeleton-line skeleton-line--title skeleton-line--break"></div>
                  <div class="skeleton-line skeleton-line--full"></div>
                  <div class="skeleton-line skeleton-line--ninety"></div>
                  <div class="skeleton-line skeleton-line--ninety-five"></div>
                  <div class="skeleton-line skeleton-line--eighty skeleton-line--break"></div>
                  <div class="skeleton-line skeleton-line--full"></div>
                  <div class="skeleton-line skeleton-line--eighty-five"></div>
                </div>
              </div>
            </div>

            <div class="resizer" id="resizer" role="separator" aria-orientation="vertical" tabindex="0" aria-label="Resize editor and preview" aria-controls="editorPane previewPane" aria-valuemin="20" aria-valuemax="80" aria-valuenow="50"></div>

            <div class="preview-pane" id="previewPane">
              <div class="pane-header">
                <span class="pane-label">Preview</span>
                <div class="pane-header-actions">
                  <div id="backlinksHeaderPanel" class="backlinks-panel backlinks-panel-header hidden" data-backlinks-variant="header">
                    <button type="button" class="backlinks-header" aria-expanded="false">
                      <svg class="backlinks-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                      <span class="backlinks-toggle">0 Linked Mentions</span>
                      <span class="backlinks-count"></span>
                    </button>
                    <div class="backlinks-body" aria-hidden="true" inert>
                      <div class="backlinks-list"></div>
                    </div>
                  </div>
                  <button class=${buttonClassNames({ variant: 'ghost', size: 'compact', toggle: true, extra: 'hidden' })} id="commentsToggle" aria-label="Toggle comments" title="Toggle comments">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
                      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
                    </svg>
                    <span class="ui-action-label">Comments</span>
                  </button>
                  <button class=${buttonClassNames({ variant: 'ghost', size: 'compact', toggle: true })} id="outlineToggle" aria-label="Toggle outline" title="Toggle outline">
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
                      <line x1="3" y1="6" x2="21" y2="6"></line>
                      <line x1="3" y1="12" x2="15" y2="12"></line>
                      <line x1="3" y1="18" x2="18" y2="18"></line>
                    </svg>
                  </button>
                </div>
              </div>
              <div class="preview-body">
                <div id="previewContainer" class="preview-container">
                  <div id="previewContent" class="preview-content"></div>
                  <div id="backlinksInlinePanel" class="backlinks-panel backlinks-panel-inline hidden">
                    <button type="button" class="backlinks-header" aria-expanded="false">
                      <svg class="backlinks-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                      <span class="backlinks-toggle">0 Linked Mentions</span>
                      <span class="backlinks-count"></span>
                    </button>
                    <div class="backlinks-body" aria-hidden="true" inert>
                      <div class="backlinks-list"></div>
                    </div>
                  </div>
                </div>
                <div id="backlinksPanel" class="backlinks-panel-layer hidden">
                  <div class="backlinks-panel backlinks-panel-dock" data-backlinks-variant="dock">
                    <button type="button" class="backlinks-header" aria-expanded="false">
                      <svg class="backlinks-chevron" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round">
                        <polyline points="9 18 15 12 9 6"></polyline>
                      </svg>
                      <span class="backlinks-toggle">0 Linked Mentions</span>
                      <span class="backlinks-count"></span>
                    </button>
                    <div class="backlinks-body" aria-hidden="true" inert>
                      <div class="backlinks-list"></div>
                    </div>
                  </div>
                </div>
                <aside id="commentsDrawer" class="comments-drawer hidden" aria-label="Comments">
                  <div class="comments-drawer-header">
                    <span class="comments-drawer-title">Comments</span>
                  </div>
                  <div id="commentsDrawerEmpty" class="comments-drawer-empty">
                    Add a comment from the editor or the preview bubbles.
                  </div>
                  <div id="commentsDrawerList" class="comments-drawer-list"></div>
                </aside>
                <aside id="outlinePanel" class="outline-panel hidden" aria-label="Document outline">
                  <div class="outline-header">
                    <span class="outline-title">Outline</span>
                  </div>
                  <nav id="outlineNav" class="outline-nav"></nav>
                </aside>
              </div>
            </div>
          </div>
        </div>

        <div id="diff-page" class="diff-page hidden">
          <div class="diff-toolbar">
            <div class="diff-toolbar-left">
              <div class="diff-file-nav">
                <button class=${iconButtonClassNames({ action: true })} id="diffPrevBtn" type="button" disabled aria-label="Previous changed file">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <polyline points="15 18 9 12 15 6"></polyline>
                  </svg>
                </button>
                <span class="diff-file-indicator" id="diffFileIndicator">0 / 0 files</span>
                <button class=${iconButtonClassNames({ action: true })} id="diffNextBtn" type="button" disabled aria-label="Next changed file">
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true">
                    <polyline points="9 18 15 12 9 6"></polyline>
                  </svg>
                </button>
              </div>
              <div class="diff-toolbar-actions">
                <button class=${buttonClassNames({ variant: 'secondary', action: true, surface: true, wide: true, hidden: true, extra: 'diff-back-btn' })} id="diffBackToHistoryBtn" type="button">
                  Back to History
                </button>
                <div class="diff-toolbar-actions-group diff-toolbar-actions-group-git" id="diffGitActionsGroup" role="group" aria-label="Git file actions">
                  <button class=${buttonClassNames({ variant: 'secondary', action: true, surface: true, wide: true })} id="diffPrimaryActionBtn" type="button" disabled>
                    Stage
                  </button>
                  <button class=${buttonClassNames({ variant: 'primary', action: true, wide: true })} id="diffCommitBtn" type="button" disabled>
                    Commit Staged
                  </button>
                </div>
                <span class="diff-toolbar-actions-divider" id="diffToolbarDivider" aria-hidden="true"></span>
                <div class="diff-toolbar-actions-group" id="diffEditorActionsGroup" role="group" aria-label="Navigation actions">
                  <button class=${buttonClassNames({ variant: 'secondary', action: true, surface: true, wide: true, extra: 'diff-open-editor-btn' })} id="diffOpenEditorBtn" type="button" disabled>
                    Open in Editor
                  </button>
                </div>
              </div>
            </div>
            <div class="diff-toolbar-right">
              <div class="diff-stats" id="diffStats">
                <span class="ui-stat-token ui-stat-token--add diff-stats-add">+0</span>
                <span class="ui-stat-token ui-stat-token--del diff-stats-del">-0</span>
              </div>
              <div class=${segmentedControlClassNames({ hidden: true, extra: 'diff-layout-toggle' })} id="diffLayoutToggle" role="group" aria-label="Commit diff layout">
                <button class=${segmentedButtonClassNames({ extra: 'view-btn diff-layout-btn' })} data-diff-layout="stacked" type="button">Stacked</button>
                <button class=${segmentedButtonClassNames({ active: true, extra: 'view-btn diff-layout-btn' })} data-diff-layout="focused" type="button">Focused</button>
              </div>
              <div class=${segmentedControlClassNames({ extra: 'diff-mode-toggle' })} role="group" aria-label="Diff view mode">
                <button class=${segmentedButtonClassNames({ active: true, extra: 'view-btn diff-mode-btn' })} data-diff-mode="unified" type="button">Unified</button>
                <button class=${segmentedButtonClassNames({ extra: 'view-btn diff-mode-btn' })} data-diff-mode="split" type="button">Split</button>
              </div>
            </div>
          </div>
          <div class="diff-scroll" id="diffScroll">
            <div class="diff-content" id="diffContent"></div>
          </div>
        </div>
      </main>
    </div>

    <dialog class="app-dialog" id="displayNameDialog">
      <form class="app-dialog-form" id="displayNameForm" method="dialog">
        <div class="app-dialog-header">
          <h2 class="app-dialog-title" id="displayNameTitle">Update display name</h2>
          <p class="app-dialog-copy" id="displayNameCopy">Your name will be visible to everyone editing this vault.</p>
        </div>
        <label class="app-dialog-field" for="displayNameInput">
          <span class="app-dialog-label">Name</span>
          <input type="text" class=${inputClassNames()} id="displayNameInput" name="displayName" maxlength="24" autocomplete="nickname" spellcheck="false" required>
        </label>
        <div class="app-dialog-actions">
          <button type="button" class=${buttonClassNames({ variant: 'secondary' })} id="displayNameCancel">Cancel</button>
          <button type="submit" class=${buttonClassNames({ variant: 'primary' })} id="displayNameSubmit">Save name</button>
        </div>
      </form>
    </dialog>

    <dialog class="app-dialog" id="fileActionDialog">
      <form class="app-dialog-form" id="fileActionForm" method="dialog">
        <div class="app-dialog-header">
          <h2 class="app-dialog-title" id="fileActionTitle">Create file</h2>
          <p class="app-dialog-copy" id="fileActionCopy">Add a new file to the vault.</p>
        </div>
        <label class="app-dialog-field" id="fileActionField" for="fileActionInput">
          <span class="app-dialog-label" id="fileActionLabel">Path</span>
          <input type="text" class=${inputClassNames()} id="fileActionInput" name="fileActionValue" autocomplete="off" spellcheck="false" required>
          <span class="app-dialog-hint" id="fileActionHint" hidden></span>
        </label>
        <p class="app-dialog-note" id="fileActionNote" hidden></p>
        <div class="app-dialog-actions">
          <button type="button" class=${buttonClassNames({ variant: 'secondary' })} id="fileActionCancel">Cancel</button>
          <button type="submit" class=${buttonClassNames({ variant: 'primary' })} id="fileActionSubmit">Create</button>
        </div>
      </form>
    </dialog>

    <dialog class="app-dialog" id="gitCommitDialog">
      <form class="app-dialog-form" id="gitCommitForm" method="dialog">
        <div class="app-dialog-header">
          <h2 class="app-dialog-title" id="gitCommitTitle">Commit staged changes</h2>
          <p class="app-dialog-copy" id="gitCommitCopy">All staged changes will be included.</p>
        </div>
        <label class="app-dialog-field" for="gitCommitInput">
          <span class="app-dialog-label">Commit message</span>
          <input type="text" class=${inputClassNames()} id="gitCommitInput" name="gitCommitMessage" autocomplete="off" spellcheck="true" required>
        </label>
        <div class="app-dialog-actions">
          <button type="button" class=${buttonClassNames({ variant: 'secondary' })} id="gitCommitCancel">Cancel</button>
          <button type="submit" class=${buttonClassNames({ variant: 'primary' })} id="gitCommitSubmit">Commit staged changes</button>
        </div>
      </form>
    </dialog>

    <dialog class="app-dialog" id="gitResetDialog">
      <form class="app-dialog-form" method="dialog">
        <div class="app-dialog-header">
          <h2 class="app-dialog-title" id="gitResetTitle">Reset file</h2>
          <p class="app-dialog-copy" id="gitResetCopy">Restore this file from the current checked-out branch. If that branch does not contain the file, it will be deleted locally.</p>
        </div>
        <div class="app-dialog-field">
          <label class="app-dialog-label" for="gitResetFileName">File</label>
          <input class=${inputClassNames({ extra: 'app-dialog-input' })} id="gitResetFileName" type="text" readonly>
        </div>
        <div class="app-dialog-note is-danger">
          Local file content and staged changes for this path will be discarded.
        </div>
        <div class="app-dialog-actions">
          <button class=${buttonClassNames({ variant: 'secondary' })} id="gitResetCancel" type="button">Cancel</button>
          <button class=${buttonClassNames({ variant: 'danger' })} id="gitResetSubmit" type="button">Reset File</button>
        </div>
      </form>
    </dialog>

    <div class="tab-lock-overlay hidden" id="tabLockOverlay" role="dialog" aria-modal="true" aria-labelledby="tabLockTitle">
      <div class="tab-lock-card">
        <span class="tab-lock-kicker">Single active tab</span>
        <h2 class="tab-lock-title" id="tabLockTitle">This vault is active in another tab</h2>
        <p class="tab-lock-copy" id="tabLockCopy">To avoid duplicate presence and chat, only one tab can stay connected at a time. Use the other tab, or take over the session here.</p>
        <div class="tab-lock-actions">
          <button type="button" class=${buttonClassNames({ variant: 'primary', size: 'lg' })} id="tabLockTakeoverBtn">Take over here</button>
        </div>
      </div>
    </div>

    <div class="toast-container" id="toastContainer"></div>

    <div class="qs-overlay" id="quickSwitcher">
      <div class="qs-modal">
        <div class="qs-input-wrap">
          <svg class="qs-search-icon" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round">
            <circle cx="11" cy="11" r="8"></circle>
            <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
          </svg>
          <input type="text" class="qs-input" id="quickSwitcherInput" placeholder="Search files and content..." autocomplete="off" spellcheck="false">
          <kbd class="qs-kbd">esc</kbd>
        </div>
        <div class="qs-results" id="quickSwitcherResults"></div>
        <div class="qs-hint" id="quickSwitcherHint">Type to search files and content</div>
      </div>
    </div>
  `;
}
