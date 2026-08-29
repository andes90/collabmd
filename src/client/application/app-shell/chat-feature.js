import { getUserAvatarTextColor } from '../../domain/room.js';

const CHAT_ALERT_MUTE_STORAGE_KEY = 'collabmd-chat-alerts-muted-until';
const CHAT_ALERT_MUTE_DURATION_MS = 60 * 60 * 1000;

function getChatConnectionState(context) {
  return context.lobby?.getConnectionState?.() ?? { status: 'connected', unreachable: false };
}

function isChatAtBottom(list) {
  return list.scrollHeight - list.scrollTop - list.clientHeight <= 24;
}

function getChatAlertMuteUntil() {
  try {
    const mutedUntil = Number(globalThis.localStorage?.getItem(CHAT_ALERT_MUTE_STORAGE_KEY));
    if (!Number.isFinite(mutedUntil) || mutedUntil <= Date.now()) {
      globalThis.localStorage?.removeItem(CHAT_ALERT_MUTE_STORAGE_KEY);
      return 0;
    }
    return mutedUntil;
  } catch {
    return 0;
  }
}

function setChatAlertMuteUntil(mutedUntil) {
  try {
    if (mutedUntil > 0) {
      globalThis.localStorage?.setItem(CHAT_ALERT_MUTE_STORAGE_KEY, String(mutedUntil));
    } else {
      globalThis.localStorage?.removeItem(CHAT_ALERT_MUTE_STORAGE_KEY);
    }
  } catch {
    // Local storage can be unavailable in private or restricted browsing modes.
  }
}

export const chatFeature = {
  updateChatMessages(messages, { initial = false } = {}) {
    const previousIds = new Set(this.chatMessageIds);
    const localPeerId = this.lobby.getLocalUser()?.peerId ?? null;

    this.chatMessages = messages;
    this.chatMessageIds = new Set(messages.map((message) => message.id));

    if (!this.chatInitialSyncComplete) {
      if (initial) {
        this.chatInitialSyncComplete = true;
      }

      this.renderChat();
      return;
    }

    const newRemoteMessages = messages.filter((message) => (
      !previousIds.has(message.id)
      && message.peerId
      && message.peerId !== localPeerId
    ));

    if (this.chatIsOpen) {
      this.chatUnreadCount = 0;
    } else if (newRemoteMessages.length > 0) {
      this.chatUnreadCount += newRemoteMessages.length;
    }

    for (const message of newRemoteMessages) {
      this.maybeNotifyChatMessage(message);
    }

    this.renderChat();
  },


  openChatPanel() {
    this.chatIsOpen = true;
    this.chatUnreadCount = 0;
    if (!this.elements.chatPanel?.matches(':popover-open')) {
      this.elements.chatPanel?.showPopover();
    }
    this.renderChat({ stickToBottom: true });
    requestAnimationFrame(() => this.elements.chatInput?.focus());
  },

  closeChatPanel() {
    if (this.elements.chatPanel?.matches(':popover-open')) {
      this.elements.chatPanel.hidePopover();
    }
    this.chatIsOpen = false;
    this.renderChat({ messagesChanged: false });
  },

  handleChatSubmit() {
    const connectionState = getChatConnectionState(this);
    if (this.isTabActive === false || connectionState.status !== 'connected') {
      return;
    }

    const input = this.elements.chatInput;
    if (!input) {
      return;
    }

    const sentMessage = this.lobby.sendChatMessage(input.value);
    if (!sentMessage) {
      input.focus();
      return;
    }

    input.value = '';
    if (!this.chatIsOpen) {
      this.openChatPanel();
      return;
    }

    this.renderChat({ stickToBottom: true });
  },

  renderChat({ messagesChanged = true, stickToBottom = false } = {}) {

    this.syncChatToggleButton();
    this.syncChatNotificationButton();
    const list = this.elements.chatMessages;
    const emptyState = this.elements.chatEmptyState;
    const connectionState = getChatConnectionState(this);
    const isConnected = connectionState.status === 'connected';
    const canSend = isConnected && this.chatInitialSyncComplete && this.isTabActive !== false;

    if (this.elements.chatStatus) {
      this.elements.chatStatus.textContent = !this.chatInitialSyncComplete
        ? 'Syncing...'
        : !isConnected
          ? connectionState.unreachable ? 'Server unreachable' : 'Reconnecting...'
          : `${this.globalUsers.length} online`;
    }

    const sendButton = this.elements.chatForm?.querySelector?.('button[type="submit"]');
    if (sendButton) {
      sendButton.disabled = !canSend;
      sendButton.title = canSend ? 'Send message' : 'Chat is unavailable while disconnected';
    }

    if (!list || !this.chatIsOpen || !messagesChanged) {
      return;
    }

    if (this.chatMessages.length === 0) {
      list.replaceChildren();
      emptyState?.classList.remove('hidden');
      list.classList.add('hidden');
      return;
    }

    emptyState?.classList.add('hidden');
    list.classList.remove('hidden');

    const wasAtBottom = stickToBottom || isChatAtBottom(list);
    const fragment = document.createDocumentFragment();
    this.chatMessages.forEach((message) => {
      fragment.appendChild(this.createChatMessageElement(message));
    });
    list.replaceChildren(fragment);

    if (wasAtBottom) {
      this.scrollChatToBottom();
    }
  },

  createChatMessageElement(message) {
    const item = document.createElement('article');
    const isLocal = message.peerId === this.lobby.getLocalUser()?.peerId;
    item.className = 'chat-message';
    item.classList.toggle('is-local', isLocal);

    const avatar = document.createElement('div');
    avatar.className = 'chat-message-avatar';
    const avatarColor = message.userColor || 'var(--color-primary-active)';
    avatar.style.backgroundColor = avatarColor;
    avatar.style.color = getUserAvatarTextColor(message.userColor);
    avatar.textContent = (message.userName || '?').charAt(0).toUpperCase();
    avatar.setAttribute('aria-hidden', 'true');

    const body = document.createElement('div');
    body.className = 'chat-message-body';

    const meta = document.createElement('div');
    meta.className = 'chat-message-meta';

    const author = document.createElement('span');
    author.className = 'chat-message-author';
    author.textContent = isLocal ? `${message.userName} (you)` : message.userName;

    const time = document.createElement('span');
    time.className = 'chat-message-time';
    time.textContent = this.formatChatTimestamp(message.createdAt);

    meta.append(author, time);

    const fileLabel = this.getChatMessageFileLabel(message.filePath);
    if (fileLabel) {
      const file = document.createElement('span');
      file.className = 'ui-pill chat-message-file';
      file.textContent = fileLabel;
      meta.append(file);
    }

    const text = document.createElement('p');
    text.className = 'chat-message-text';
    text.textContent = message.text;

    body.append(meta, text);
    item.append(avatar, body);
    return item;
  },

  scrollChatToBottom() {
    const list = this.elements.chatMessages;
    if (!list) {
      return;
    }

    requestAnimationFrame(() => {
      list.scrollTop = list.scrollHeight;
    });
  },

  formatChatTimestamp(value) {
    if (!Number.isFinite(value)) {
      return '';
    }

    try {
      return this.chatTimeFormatter.format(new Date(value));
    } catch {
      return '';
    }
  },

  getChatMessageFileLabel(filePath) {
    if (!filePath) {
      return '';
    }

    return this.getDisplayName(filePath);
  },

  formatChatToastMessage(message) {
    const sender = message?.userName || 'Someone';
    const text = String(message?.text ?? '').replace(/\s+/g, ' ').trim();
    const compactText = text.length > 88 ? `${text.slice(0, 85).trimEnd()}...` : text;
    return `${sender}: ${compactText}`;
  },

  syncChatNotificationButton() {
    const button = this.elements.chatNotificationButton;
    const muteButton = this.elements.chatNotificationMuteButton;
    const status = this.elements.chatNotificationStatus;
    if (!button && !muteButton && !status) {
      return;
    }

    const permission = this.notifications?.getPermission?.() ?? 'unsupported';
    const enabled = permission === 'granted';
    const muted = enabled && getChatAlertMuteUntil() > 0;
    const blocked = permission === 'denied';
    const statusState = enabled
      ? {
          text: muted ? 'Alerts muted' : 'Alerts on',
          label: muted ? 'Desktop alerts muted' : 'Desktop alerts enabled',
        }
      : blocked
        ? {
            text: 'Alerts blocked',
            label: 'Desktop alerts blocked in browser settings',
          }
        : null;

    if (button) {
      button.classList.toggle('hidden', permission !== 'default');
      button.disabled = false;
      button.removeAttribute('aria-pressed');
      button.textContent = 'Enable desktop alerts';
      button.title = 'Allow desktop alerts for new chat messages';
    }

    if (muteButton) {
      muteButton.classList.toggle('hidden', !enabled);
      muteButton.disabled = false;
      muteButton.setAttribute('aria-pressed', String(muted));
      const muteLabel = muted ? 'Unmute desktop alerts' : 'Mute desktop alerts for one hour';
      muteButton.setAttribute('aria-label', muteLabel);
      muteButton.title = muteLabel;
    }

    if (status) {
      status.classList.toggle('hidden', !statusState);
      status.textContent = statusState?.text ?? '';
      if (statusState) {
        status.setAttribute('aria-label', statusState.label);
        status.title = statusState.label;
      } else {
        status.removeAttribute('aria-label');
        status.removeAttribute('title');
      }
      status.classList.toggle('ui-status-badge--accent', enabled && !muted);
      status.classList.toggle('ui-status-badge--muted', blocked || muted);
    }
  },

  async handleChatNotificationToggle() {
    const permission = await this.notifications?.requestPermission?.();
    this.syncChatNotificationButton();

    if (permission === 'granted') {
      return;
    }

    if (permission === 'denied') {
      (this.chatToastController ?? this.toastController)?.show(
        'Desktop alerts are blocked. Allow them in browser site settings.',
        { duration: 5000, tone: 'warning' },
      );
      return;
    }

    if (permission === 'unsupported') {
      (this.chatToastController ?? this.toastController)?.show(
        'This browser does not support desktop alerts.',
        { duration: 5000, tone: 'warning' },
      );
    }
  },

  toggleChatNotificationMute() {
    const mutedUntil = getChatAlertMuteUntil();
    setChatAlertMuteUntil(mutedUntil > 0 ? 0 : Date.now() + CHAT_ALERT_MUTE_DURATION_MS);
    this.renderChat({ messagesChanged: false });
  },

  syncChatToggleButton() {
    const button = this.elements.chatToggleButton;
    const badge = this.elements.chatToggleBadge;
    if (!button) {
      return;
    }

    const hasUnread = this.chatUnreadCount > 0;
    const shouldEmphasizeUnread = hasUnread && !this.chatIsOpen;

    button.classList.toggle('is-active', this.chatIsOpen);
    button.classList.toggle('is-unread', shouldEmphasizeUnread);
    button.setAttribute(
      'aria-label',
      hasUnread ? `Open team chat, ${this.chatUnreadCount} unread` : 'Open team chat',
    );
    button.title = this.chatUnreadCount > 0
      ? `Team chat (${this.chatUnreadCount} unread)`
      : 'Team chat';

    if (!badge) {
      return;
    }

    badge.classList.toggle('hidden', !hasUnread);
    badge.textContent = this.chatUnreadCount > 9 ? '9+' : String(this.chatUnreadCount);
  },

  maybeNotifyChatMessage(message) {
    if (!this.chatInitialSyncComplete) {
      return;
    }

    if (this.isTabActive === false || this.chatIsOpen || getChatAlertMuteUntil() > 0) {
      return;
    }

    const pageHidden = Boolean(
      globalThis.document?.hidden || globalThis.document?.visibilityState === 'hidden',
    );
    const pageFocused = typeof globalThis.document?.hasFocus === 'function'
      ? globalThis.document.hasFocus()
      : !pageHidden;
    let notification = null;
    if (pageHidden || !pageFocused) {
      notification = this.notifications?.show?.({
        body: String(message?.text ?? '').replace(/\s+/g, ' ').trim(),
        onClick: () => {
          window.focus?.();
          notification?.close?.();
          this.openChatPanel();
        },
        tag: `collabmd-chat-${message?.id ?? 'message'}`,
        title: `New message from ${message?.userName || 'Someone'}`,
      });
    }

    if (notification) {
      return;
    }

    (this.chatToastController ?? this.toastController).show(this.formatChatToastMessage(message), 4000);
  },
};
