/**
 * @typedef {object} UiTabActivityContext
 * @property {boolean} isTabActive
 * @property {string | null} currentFilePath
 * @property {Set<string>} chatMessageIds
 * @property {boolean} chatInitialSyncComplete
 * @property {number} chatUnreadCount
 * @property {Array<unknown>} chatMessages
 * @property {Array<unknown>} globalUsers
 * @property {string | null} followedUserClientId
 * @property {string} followedCursorSignature
 * @property {{ status: string, unreachable: boolean }} connectionState
 * @property {{ displayNameDialog?: HTMLDialogElement | HTMLElement | null, tabLockOverlay?: HTMLElement | null, tabLockTitle?: HTMLElement | null, tabLockCopy?: HTMLElement | null }} elements
 * @property {{ connect(): void, disconnect(): void, provider?: unknown }} lobby
 * @property {{ connect(): void, disconnect(): void, provider?: unknown }} workspaceSync
 * @property {{ show(message: string): void }} toastController
 * @property {{ tryActivate(options?: { takeover?: boolean }): void }} tabActivityLock
 * @property {{ prepareFileDisconnect(filePath: string): Promise<void> }} excalidrawEmbed
 * @property {() => void} handleHashChange
 * @property {() => boolean} isExcalidrawFile
 * @property {() => void} promptForDisplayNameIfNeeded
 * @property {() => void} renderChat
 * @property {() => void} showEmptyState
 * @property {({ reason }: { reason?: string }) => void} showTabLockOverlay
 * @property {() => void} hideTabLockOverlay
 */

/** @this {UiTabActivityContext} */
function handleTabTakeover() {
  this.tabActivityLock.tryActivate({ takeover: true });
}

/** @this {UiTabActivityContext} */
function handleTabActivated({ takeover = false } = {}) {
  const wasInactive = !this.isTabActive;
  this.isTabActive = true;
  this.hideTabLockOverlay();

  if (!this.lobby.provider) {
    this.lobby.connect();
  }
  if (!this.workspaceSync.provider) {
    this.workspaceSync.connect();
  }

  if (wasInactive) {
    if (this.fileExplorerReady) {
      void this.handleHashChange();
    }
    this.promptForDisplayNameIfNeeded();
  }

  if (takeover) {
    this.toastController.show('This tab is now active');
  }
}

/** @this {UiTabActivityContext} */
async function handleTabBlocked({ reason } = {}) {
  const wasActive = this.isTabActive;
  const blockedFilePath = this.currentFilePath;
  const shouldPrepareExcalidrawDisconnect = Boolean(
    blockedFilePath
    && this.isExcalidrawFile?.(blockedFilePath),
  );

  this.isTabActive = false;
  if (this.elements.displayNameDialog?.open) {
    this.elements.displayNameDialog.close();
  }
  this.lobby.disconnect();
  this.workspaceSync.disconnect();
  this.globalUsers = [];
  this.chatMessages = [];
  this.chatMessageIds.clear();
  this.chatUnreadCount = 0;
  this.chatInitialSyncComplete = false;
  this.followedUserClientId = null;
  this.followedCursorSignature = '';
  this.connectionState = { status: 'disconnected', unreachable: false };
  this.showTabLockOverlay({ reason });

  if (shouldPrepareExcalidrawDisconnect) {
    await this.excalidrawEmbed.prepareFileDisconnect(blockedFilePath);
  }

  this.showEmptyState();
  this.renderChat();

  if (wasActive && reason === 'taken-over') {
    this.toastController.show('Another tab took over this session');
  }
}

/** @this {UiTabActivityContext} */
function showTabLockOverlay({ reason } = {}) {
  const overlay = this.elements.tabLockOverlay;
  const title = this.elements.tabLockTitle;
  const copy = this.elements.tabLockCopy;
  if (!overlay) return;

  if (title) {
    title.textContent = reason === 'taken-over'
      ? 'This tab is no longer active'
      : 'This vault is active in another tab';
  }

  if (copy) {
    copy.textContent = reason === 'taken-over'
      ? 'Another tab took over the live session. This tab is now disconnected until you explicitly take over here again.'
      : 'To avoid duplicate presence and chat, only one tab can stay connected at a time. Use the other tab, or take over the session here.';
  }

  overlay.classList.remove('hidden');
}

/** @this {UiTabActivityContext} */
function hideTabLockOverlay() {
  this.elements.tabLockOverlay?.classList.add('hidden');
}

export const uiFeatureTabActivityMethods = {
  handleTabActivated,
  handleTabBlocked,
  handleTabTakeover,
  hideTabLockOverlay,
  showTabLockOverlay,
};
