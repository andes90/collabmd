import { PreviewRenderer } from './preview-renderer.js';
import { USER_NAME_MAX_LENGTH, normalizeUserName, generateRoomId } from '../domain/room.js';
import { EditorSession } from '../infrastructure/editor-session.js';
import { getRoomFromHash, navigateToRoom } from '../infrastructure/runtime-config.js';
import { LayoutController } from '../presentation/layout-controller.js';
import { OutlineController } from '../presentation/outline-controller.js';
import { ScrollSyncController } from '../presentation/scroll-sync-controller.js';
import { ThemeController } from '../presentation/theme-controller.js';
import { ToastController } from '../presentation/toast-controller.js';

export class CollabMdApp {
  constructor() {
    this.elements = {
      backButton: document.getElementById('backToLanding'),
      createRoomButton: document.getElementById('createRoomBtn'),
      currentUserName: document.getElementById('currentUserName'),
      displayNameCancel: document.getElementById('displayNameCancel'),
      displayNameDialog: document.getElementById('displayNameDialog'),
      displayNameForm: document.getElementById('displayNameForm'),
      displayNameInput: document.getElementById('displayNameInput'),
      editNameButton: document.getElementById('editNameBtn'),
      editorContainer: document.getElementById('editorContainer'),
      editorPage: document.getElementById('editor-page'),
      joinRoomButton: document.getElementById('joinRoomBtn'),
      landingPage: document.getElementById('landing'),
      lineInfo: document.getElementById('lineInfo'),
      previewContent: document.getElementById('previewContent'),
      previewContainer: document.getElementById('previewContainer'),
      roomInput: document.getElementById('roomInput'),
      roomName: document.getElementById('roomName'),
      shareButton: document.getElementById('shareBtn'),
      toastContainer: document.getElementById('toastContainer'),
      toggleWrapButton: document.getElementById('toggleWrapBtn'),
      userAvatars: document.getElementById('userAvatars'),
      userCount: document.getElementById('userCount'),
      wrapToggleLabel: document.getElementById('wrapToggleLabel'),
    };

    this.session = null;
    this.onlineUsers = [];
    this.connectionState = { status: 'disconnected', unreachable: false };
    this.sessionLoadToken = 0;
    this.connectionHelpShown = false;
    this.userNameStorageKey = 'collabmd-user-name';
    this.lineWrappingStorageKey = 'collabmd-editor-line-wrap';
    this.followedUserClientId = null;
    this.followedCursorSignature = '';

    this.toastController = new ToastController(this.elements.toastContainer);
    this.outlineController = new OutlineController({
      onNavigateToHeading: ({ sourceLine }) => {
        if (!Number.isFinite(sourceLine)) {
          return;
        }

        this.scrollSyncController.suspendSync(250);
        this.session?.scrollToLine(sourceLine, 0);
      },
    });
    this.previewRenderer = new PreviewRenderer({
      getContent: () => this.session?.getText() ?? '',
      onRenderComplete: () => {
        requestAnimationFrame(() => {
          this.scrollSyncController.invalidatePreviewBlocks();
          this.scrollSyncController.syncPreviewToEditor();
        });
      },
      outlineController: this.outlineController,
      previewElement: this.elements.previewContent,
    });
    this.themeController = new ThemeController({
      onChange: (theme) => this.handleThemeChange(theme),
    });
    this.layoutController = new LayoutController({
      onMeasureEditor: () => this.session?.requestMeasure(),
    });
    this.scrollSyncController = new ScrollSyncController({
      getEditorLineNumber: () => this.session?.getTopVisibleLineNumber(0.35) ?? 1,
      previewContainer: this.elements.previewContainer,
      previewElement: this.elements.previewContent,
      scrollEditorToLine: (lineNumber, viewportRatio) => this.session?.scrollToLine(lineNumber, viewportRatio),
    });
  }

  initialize() {
    this.themeController.initialize();
    this.previewRenderer.applyTheme(this.themeController.getTheme());
    this.outlineController.initialize();
    this.layoutController.initialize();
    this.scrollSyncController.initialize();
    this.syncCurrentUserName();
    this.syncWrapToggle();
    this.bindEvents();

    window.addEventListener('hashchange', () => this.handleHashChange());
    window.addEventListener('resize', this.createResizeHandler());

    this.handleHashChange();
  }

  bindEvents() {
    this.elements.createRoomButton?.addEventListener('click', () => {
      navigateToRoom(generateRoomId());
    });

    this.elements.joinRoomButton?.addEventListener('click', () => {
      const roomId = this.elements.roomInput?.value.trim();
      if (!roomId) {
        this.elements.roomInput?.focus();
        this.toastController.show('Enter a room name to join');
        return;
      }

      navigateToRoom(roomId);
    });

    this.elements.roomInput?.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        this.elements.joinRoomButton?.click();
      }
    });

    this.elements.backButton?.addEventListener('click', () => {
      window.location.hash = '';
    });

    this.elements.shareButton?.addEventListener('click', () => {
      void this.copyCurrentRoomLink();
    });

    this.elements.editNameButton?.addEventListener('click', () => {
      this.openDisplayNameDialog();
    });

    this.elements.displayNameCancel?.addEventListener('click', () => {
      this.elements.displayNameDialog?.close();
    });

    this.elements.displayNameForm?.addEventListener('submit', (event) => {
      event.preventDefault();
      this.handleDisplayNameSubmit();
    });

    this.elements.toggleWrapButton?.addEventListener('click', () => {
      this.toggleLineWrapping();
    });
  }

  createResizeHandler() {
    let resizeTimer = null;

    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        this.session?.requestMeasure();
        this.scrollSyncController.invalidatePreviewBlocks();
        this.scrollSyncController.syncPreviewToEditor();
      }, 100);
    };
  }

  async handleHashChange() {
    const roomId = getRoomFromHash();

    if (!roomId) {
      this.showLanding();
      return;
    }

    await this.showEditor(roomId);
  }

  showLanding() {
    this.sessionLoadToken += 1;
    this.cleanupSession();

    this.elements.landingPage?.classList.remove('hidden');
    this.elements.editorPage?.classList.add('hidden');
    this.elements.previewContent.innerHTML = '';
    this.elements.userAvatars.innerHTML = '';
    this.elements.userCount.textContent = 'Offline';
    this.elements.userCount.style.opacity = '0.6';
    this.syncCurrentUserName();
    this.syncWrapToggle();
  }

  async showEditor(roomId) {
    const loadToken = this.sessionLoadToken + 1;
    this.sessionLoadToken = loadToken;

    this.cleanupSession();
    this.layoutController.reset();
    this.connectionHelpShown = false;
    this.onlineUsers = [];
    this.connectionState = { status: 'connecting', unreachable: false };

    this.elements.landingPage?.classList.add('hidden');
    this.elements.editorPage?.classList.remove('hidden');
    this.elements.roomName.textContent = roomId;
    this.showEditorLoading();
    this.renderPresence();

    const session = new EditorSession({
      editorContainer: this.elements.editorContainer,
      lineWrappingEnabled: this.getStoredLineWrapping(),
      initialTheme: this.themeController.getTheme(),
      lineInfoElement: this.elements.lineInfo,
      onAwarenessChange: (users) => this.updateOnlineUsers(users),
      onConnectionChange: (state) => this.handleConnectionChange(state),
      onContentChange: () => this.previewRenderer.queueRender(),
      preferredUserName: this.getStoredUserName(),
    });

    this.session = session;

    try {
      await session.initialize(roomId);

      if (loadToken !== this.sessionLoadToken) {
        session.destroy();
        return;
      }

      this.scrollSyncController.attachEditorScroller(session.getScrollContainer());
      session.applyTheme(this.themeController.getTheme());
      this.syncWrapToggle();
      this.previewRenderer.queueRender();
    } catch (error) {
      console.error('[app] Failed to initialize editor:', error);
      session.destroy();
      this.scrollSyncController.attachEditorScroller(null);
      if (this.session === session) {
        this.session = null;
      }

      if (loadToken !== this.sessionLoadToken) {
        return;
      }

      this.showEditorLoadError();
      this.syncWrapToggle();
      this.toastController.show('Failed to initialize editor');
    }
  }

  cleanupSession() {
    this.session?.destroy();
    this.session = null;
    this.scrollSyncController.attachEditorScroller(null);
    this.outlineController.cleanup();
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
  }

  toggleLineWrapping() {
    const currentState = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping();
    const nextState = !currentState;

    this.session?.setLineWrapping(nextState);
    this.storeLineWrapping(nextState);
    this.syncWrapToggle(nextState);
    this.session?.requestMeasure();
    this.scrollSyncController.syncPreviewToEditor();
  }

  handleThemeChange(theme) {
    this.previewRenderer.applyTheme(theme);
    this.previewRenderer.queueRender();
    this.session?.applyTheme(theme);
  }

  handleConnectionChange(state) {
    this.connectionState = state;
    this.renderPresence();

    if (state.firstConnection) {
      this.toastController.show('Connected to collaboration server');
    }

    if (state.unreachable && !this.connectionHelpShown) {
      this.connectionHelpShown = true;
      this.toastController.show(`Cannot reach collaboration server at ${state.wsBaseUrl}`, 6000);
    }
  }

  updateOnlineUsers(users) {
    this.onlineUsers = users;
    this.syncFollowedUser();
    this.renderAvatars();
    this.renderPresence();
    this.syncCurrentUserName();
  }

  renderPresence() {
    const badge = this.elements.userCount;
    if (!badge) {
      return;
    }

    if (this.connectionState.status === 'connected') {
      badge.textContent = `${this.onlineUsers.length} online`;
      badge.style.opacity = '1';
      return;
    }

    if (this.connectionState.status === 'connecting') {
      badge.textContent = this.connectionState.unreachable ? 'Server unreachable' : 'Connecting...';
      badge.style.opacity = '0.6';
      return;
    }

    badge.textContent = 'Offline';
    badge.style.opacity = '0.6';
  }

  renderAvatars() {
    const avatars = this.elements.userAvatars;
    if (!avatars) {
      return;
    }

    avatars.innerHTML = '';
    const visibleUsers = [...this.onlineUsers];
    const followedIndex = visibleUsers.findIndex((user) => user.clientId === this.followedUserClientId);
    if (followedIndex > 0) {
      const [followedUser] = visibleUsers.splice(followedIndex, 1);
      visibleUsers.unshift(followedUser);
    }

    visibleUsers.slice(0, 5).forEach((user) => {
      const avatar = document.createElement(user.isLocal ? 'div' : 'button');
      avatar.className = 'user-avatar';
      avatar.style.backgroundColor = user.color;
      avatar.textContent = user.name.charAt(0).toUpperCase();
      avatar.classList.toggle('is-following', user.clientId === this.followedUserClientId);

      if (user.isLocal) {
        avatar.title = `${user.name} (you)`;
      } else {
        avatar.type = 'button';
        avatar.classList.add('user-avatar-button');
        avatar.title = user.clientId === this.followedUserClientId
          ? `Stop following ${user.name}`
          : `Follow ${user.name}`;
        avatar.setAttribute('aria-label', avatar.title);
        avatar.setAttribute('aria-pressed', String(user.clientId === this.followedUserClientId));
        avatar.addEventListener('click', () => this.toggleFollowUser(user.clientId));
      }

      avatars.appendChild(avatar);
    });

    if (visibleUsers.length > 5) {
      const overflow = document.createElement('div');
      overflow.className = 'user-avatar';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      overflow.textContent = `+${visibleUsers.length - 5}`;
      avatars.appendChild(overflow);
    }
  }

  toggleFollowUser(clientId) {
    if (!clientId) {
      return;
    }

    if (this.followedUserClientId === clientId) {
      this.stopFollowingUser();
      return;
    }

    const user = this.onlineUsers.find((candidate) => candidate.clientId === clientId && !candidate.isLocal);
    if (!user) {
      return;
    }

    this.followedUserClientId = clientId;
    this.followedCursorSignature = '';
    this.renderAvatars();
    requestAnimationFrame(() => {
      if (this.followedUserClientId === clientId) {
        this.followUserCursor(user, { force: true });
      }
    });

    if (user.hasCursor) {
      this.toastController.show(`Following ${user.name}`);
      return;
    }

    this.toastController.show(`Following ${user.name}. Waiting for their cursor.`);
  }

  stopFollowingUser(showToast = true) {
    if (!this.followedUserClientId) {
      return;
    }

    const followedUserName = this.onlineUsers.find((user) => user.clientId === this.followedUserClientId)?.name ?? 'collaborator';
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.renderAvatars();

    if (showToast) {
      this.toastController.show(`Stopped following ${followedUserName}`);
    }
  }

  syncFollowedUser() {
    if (!this.followedUserClientId) {
      return;
    }

    const followedUser = this.onlineUsers.find((user) => user.clientId === this.followedUserClientId);
    if (!followedUser || followedUser.isLocal) {
      this.stopFollowingUser(false);
      return;
    }

    this.followUserCursor(followedUser);
  }

  followUserCursor(user, { force = false } = {}) {
    const liveCursor = user?.clientId ? this.session?.getUserCursor(user.clientId) : null;
    const cursorHead = liveCursor?.cursorHead ?? user?.cursorHead;
    const cursorLine = liveCursor?.cursorLine ?? user?.cursorLine;
    const cursorAnchor = liveCursor?.cursorAnchor ?? user?.cursorAnchor;

    if (!user || cursorHead == null || cursorLine == null) {
      this.followedCursorSignature = '';
      return;
    }

    const nextSignature = `${user.clientId}:${cursorAnchor}:${cursorHead}`;
    if (!force && nextSignature === this.followedCursorSignature) {
      return;
    }

    const didScroll = this.session?.scrollToUserCursor(user.clientId, 'center')
      || this.session?.scrollToPosition(cursorHead, 'center')
      || this.session?.scrollToLine(cursorLine);
    if (didScroll) {
      this.followedCursorSignature = nextSignature;
    }
  }

  openDisplayNameDialog() {
    const dialog = this.elements.displayNameDialog;
    const input = this.elements.displayNameInput;

    if (!dialog || !input) {
      return;
    }

    input.value = this.getCurrentUserName();

    if (typeof dialog.showModal === 'function') {
      dialog.showModal();
    } else {
      dialog.setAttribute('open', 'true');
    }

    requestAnimationFrame(() => {
      input.focus();
      input.select();
    });
  }

  handleDisplayNameSubmit() {
    const input = this.elements.displayNameInput;
    const dialog = this.elements.displayNameDialog;

    if (!input || !dialog || !this.session) {
      return;
    }

    const normalizedName = this.session.setUserName(input.value);
    if (!normalizedName) {
      input.focus();
      this.toastController.show(`Name must be 1-${USER_NAME_MAX_LENGTH} characters`);
      return;
    }

    this.storeUserName(normalizedName);
    this.syncCurrentUserName();
    dialog.close();
    this.toastController.show(`Display name updated to ${normalizedName}`);
  }

  getCurrentUser() {
    return this.onlineUsers.find((user) => user.isLocal) ?? this.session?.getLocalUser() ?? null;
  }

  getCurrentUserName() {
    return this.getCurrentUser()?.name ?? this.getStoredUserName() ?? 'Set name';
  }

  getStoredUserName() {
    try {
      return normalizeUserName(window.localStorage.getItem(this.userNameStorageKey) ?? '');
    } catch {
      return null;
    }
  }

  storeUserName(name) {
    try {
      window.localStorage.setItem(this.userNameStorageKey, name);
    } catch {
      // Ignore storage errors.
    }
  }

  getStoredLineWrapping() {
    try {
      return window.localStorage.getItem(this.lineWrappingStorageKey) !== 'false';
    } catch {
      return true;
    }
  }

  storeLineWrapping(enabled) {
    try {
      window.localStorage.setItem(this.lineWrappingStorageKey, String(Boolean(enabled)));
    } catch {
      // Ignore storage errors.
    }
  }

  syncCurrentUserName() {
    const button = this.elements.editNameButton;
    const label = this.elements.currentUserName;
    const currentUserName = this.getCurrentUserName();

    if (label) {
      label.textContent = currentUserName;
    }

    if (button) {
      button.title = `Change display name (${currentUserName})`;
      button.setAttribute('aria-label', `Change display name. Current name: ${currentUserName}`);
    }
  }

  syncWrapToggle(isWrapped = this.session?.isLineWrappingEnabled() ?? this.getStoredLineWrapping()) {
    const button = this.elements.toggleWrapButton;
    const label = this.elements.wrapToggleLabel;
    const nextAction = isWrapped ? 'Disable line wrap' : 'Enable line wrap';

    if (label) {
      label.textContent = isWrapped ? 'Wrap on' : 'Wrap off';
    }

    if (button) {
      button.classList.toggle('active', isWrapped);
      button.title = nextAction;
      button.setAttribute('aria-label', nextAction);
    }
  }

  showEditorLoading() {
    if (!this.elements.editorContainer) {
      return;
    }

    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
        <div class="loading-spinner"></div>
        <span class="loading-text">Loading editor...</span>
      </div>
    `;
  }

  showEditorLoadError() {
    if (!this.elements.editorContainer) {
      return;
    }

    this.elements.editorContainer.innerHTML = `
      <div class="editor-loading" id="editorLoading">
      <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="var(--color-error)" stroke-width="2"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
      <span class="loading-text" style="color:var(--color-error)">Failed to load editor modules</span>
      <button class="btn btn-secondary" type="button" id="retryLoadEditor" style="margin-top:var(--space-2)">Retry</button>
      </div>
    `;

    this.elements.editorContainer.querySelector('#retryLoadEditor')?.addEventListener('click', () => {
      void this.handleHashChange();
    });
  }

  async copyCurrentRoomLink() {
    const roomUrl = window.location.href;

    try {
      await navigator.clipboard.writeText(roomUrl);
      this.toastController.show('Room link copied to clipboard');
      return;
    } catch {
      // Fallback to a hidden textarea for older browser contexts.
    }

    const textArea = document.createElement('textarea');
    textArea.value = roomUrl;
    textArea.style.position = 'fixed';
    textArea.style.opacity = '0';
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand('copy');
      this.toastController.show('Room link copied');
    } catch {
      this.toastController.show('Could not copy room link');
    } finally {
      textArea.remove();
    }
  }
}
