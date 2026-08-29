import { getUserAvatarTextColor } from '../../domain/room.js';

const MAX_INLINE_AVATARS = 5;

function compareUserNames(left, right) {
  return String(left?.name ?? '').localeCompare(String(right?.name ?? ''), undefined, {
    sensitivity: 'base',
  });
}

function getConnectedPresenceState(context) {
  const hasEditorSession = Boolean(context.session);
  const isDrawioRoute = Boolean(context.currentFilePath && context.isDrawioFile?.(context.currentFilePath));
  const isExcalidrawRoute = Boolean(context.currentFilePath && context.isExcalidrawFile?.(context.currentFilePath));
  const isImageRoute = Boolean(context.currentFilePath && context.isImageFile?.(context.currentFilePath));
  const isPdfRoute = Boolean(context.currentFilePath && context.isPdfFile?.(context.currentFilePath));
  const shouldUseLobbyState = !hasEditorSession
    && (!context.currentFilePath || isDrawioRoute || isExcalidrawRoute || isImageRoute || isPdfRoute);
  return shouldUseLobbyState
    ? context.lobby?.getConnectionState?.() ?? context.connectionState
    : context.connectionState;
}

function getInlineUsers(users, followedUserClientId) {
  const visibleUsers = [...users];
  const localIndex = visibleUsers.findIndex((user) => user.isLocal);
  if (localIndex > 0) {
    const [localUser] = visibleUsers.splice(localIndex, 1);
    visibleUsers.unshift(localUser);
  }

  const followedIndex = visibleUsers.findIndex((user) => !user.isLocal && user.clientId === followedUserClientId);
  const followedInsertIndex = visibleUsers[0]?.isLocal ? 1 : 0;
  if (followedIndex > followedInsertIndex) {
    const [followed] = visibleUsers.splice(followedIndex, 1);
    visibleUsers.splice(followedInsertIndex, 0, followed);
  }

  return visibleUsers;
}

function getPanelUsers(users, followedUserClientId) {
  const localUsers = users.filter((user) => user.isLocal).sort(compareUserNames);
  const remoteUsers = users.filter((user) => !user.isLocal);
  const followedUsers = remoteUsers
    .filter((user) => user.clientId === followedUserClientId)
    .sort(compareUserNames);
  const remainingUsers = remoteUsers
    .filter((user) => user.clientId !== followedUserClientId)
    .sort(compareUserNames);
  return [...localUsers, ...followedUsers, ...remainingUsers];
}

function getUserFileLabel(context, user) {
  if (user.currentFile && user.currentFile === context.currentFilePath) {
    return 'Here';
  }

  if (user.currentFile) {
    return context.getDisplayName(user.currentFile);
  }

  return 'No file';
}

export const presenceFeature = {
  updateGlobalUsers(users) {
    this.globalUsers = users;
    this.syncFollowedUser();
    this.renderAvatars();
    this.renderChat({ messagesChanged: false });
    this.renderPresence();
    this.syncCurrentUserName();
  },

  updateFileAwareness(_users) {
    this.syncFollowedUser();
  },

  renderPresence() {
    const badge = this.elements.userCount;
    if (!badge) return;

    const effectiveConnectionState = getConnectedPresenceState(this);
    const hasUsers = this.globalUsers.length > 0;
    if (effectiveConnectionState.status !== 'connected') {
      this.closePresencePanel();
    }

    badge.type = 'button';
    badge.classList.toggle('is-active', this.presencePanelOpen);

    if (effectiveConnectionState.status === 'connected') {
      badge.textContent = `${this.globalUsers.length} online`;
      badge.style.opacity = '1';
      badge.disabled = !hasUsers;
      badge.setAttribute('aria-label', `Show ${this.globalUsers.length} online users`);
      this.renderPresencePanel();
      return;
    }

    if (effectiveConnectionState.status === 'connecting') {
      badge.textContent = effectiveConnectionState.unreachable ? 'Unreachable' : 'Connecting...';
      badge.style.opacity = '0.6';
      badge.disabled = true;
      badge.setAttribute('aria-label', badge.textContent);
      this.renderPresencePanel();
      return;
    }

    badge.textContent = 'Offline';
    badge.style.opacity = '0.6';
    badge.disabled = true;
    badge.setAttribute('aria-label', 'Offline');
    this.renderPresencePanel();
  },

  renderAvatars() {
    const avatars = this.elements.userAvatars;
    if (!avatars) return;

    avatars.replaceChildren();
    const visibleUsers = getInlineUsers(this.globalUsers, this.followedUserClientId);

    visibleUsers.slice(0, MAX_INLINE_AVATARS).forEach((user) => {
      const avatar = document.createElement(user.isLocal ? 'div' : 'button');
      avatar.className = 'user-avatar';
      avatar.classList.toggle('is-local', user.isLocal);
      avatar.style.backgroundColor = user.color;
      avatar.style.color = getUserAvatarTextColor(user.color);
      avatar.classList.toggle('is-following', user.clientId === this.followedUserClientId);

      const initial = document.createElement('span');
      initial.className = 'user-avatar-initial';
      initial.textContent = user.name.charAt(0).toUpperCase();
      avatar.appendChild(initial);

      const sameFile = user.currentFile && user.currentFile === this.currentFilePath;
      const fileLabel = user.currentFile ? this.getDisplayName(user.currentFile) : 'No file';

      if (user.isLocal) {
        const selfLabel = document.createElement('span');
        selfLabel.className = 'user-avatar-self-label';
        selfLabel.textContent = 'You';
        avatar.appendChild(selfLabel);
        avatar.title = `${user.name} (you) — ${fileLabel}`;
        avatar.setAttribute('role', 'img');
        avatar.setAttribute('aria-label', `${user.name} (you) — ${fileLabel}`);
      } else {
        avatar.type = 'button';
        avatar.classList.add('user-avatar-button');
        if (!sameFile) {
          avatar.classList.add('different-file');
        }
        const avatarLabel = user.clientId === this.followedUserClientId
          ? `Stop following ${user.name}`
          : sameFile
            ? `Follow ${user.name}`
            : `Follow ${user.name} — ${fileLabel}`;
        avatar.title = avatarLabel;
        avatar.setAttribute('aria-label', avatarLabel);
        avatar.addEventListener('click', () => this.toggleFollowUser(user.clientId));
      }

      avatars.appendChild(avatar);
    });

    if (visibleUsers.length > MAX_INLINE_AVATARS) {
      const overflow = document.createElement('button');
      overflow.type = 'button';
      overflow.className = 'user-avatar user-avatar-button user-avatar-overflow-trigger';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      overflow.setAttribute('popovertarget', 'presencePanel');
      overflow.setAttribute('aria-label', `Show ${visibleUsers.length} online users`);
      overflow.title = `Show ${visibleUsers.length} online users`;
      const overflowLabel = document.createElement('span');
      overflowLabel.className = 'user-avatar-initial';
      overflowLabel.textContent = `+${visibleUsers.length - MAX_INLINE_AVATARS}`;
      overflow.appendChild(overflowLabel);
      avatars.appendChild(overflow);
    }
  },

  openPresencePanel() {
    const effectiveConnectionState = getConnectedPresenceState(this);
    if (effectiveConnectionState.status !== 'connected' || this.globalUsers.length === 0) {
      return;
    }

    this.presencePanelOpen = true;
    if (!this.elements.presencePanel?.matches(':popover-open')) {
      this.elements.presencePanel?.showPopover();
    }
    this.renderAvatars();
    this.renderPresence();
  },

  closePresencePanel() {
    if (this.elements.presencePanel?.matches(':popover-open')) {
      this.elements.presencePanel.hidePopover();
    }
    this.presencePanelOpen = false;
    this.renderAvatars?.();
  },

  renderPresencePanel() {
    const panel = this.elements.presencePanel;
    const list = this.elements.presencePanelList;
    const status = this.elements.presencePanelStatus;
    if (!panel || !list) return;

    if (!this.presencePanelOpen) {
      return;
    }

    const orderedUsers = getPanelUsers(this.globalUsers, this.followedUserClientId);
    const effectiveConnectionState = getConnectedPresenceState(this);
    if (status) {
      if (effectiveConnectionState.status === 'connected') {
        const remoteUserCount = this.globalUsers.filter((user) => !user.isLocal).length;
        status.textContent = remoteUserCount === 0
          ? 'You’re the only person here right now.'
          : `${remoteUserCount} ${remoteUserCount === 1 ? 'teammate' : 'teammates'} online. Select someone to follow.`;
      } else if (effectiveConnectionState.status === 'connecting') {
        status.textContent = effectiveConnectionState.unreachable ? 'Server unreachable.' : 'Connecting presence...';
      } else {
        status.textContent = 'Presence is offline.';
      }
    }

    list.replaceChildren();

    if (orderedUsers.length === 0) {
      const emptyState = document.createElement('div');
      emptyState.className = 'presence-panel-empty-state';
      emptyState.textContent = effectiveConnectionState.status === 'connected'
        ? 'Nobody else is here yet.'
        : 'Presence will appear here when the connection is active.';
      list.appendChild(emptyState);
      return;
    }

    const fragment = document.createDocumentFragment();
    orderedUsers.forEach((user) => {
      const row = document.createElement('article');
      row.className = 'presence-panel-user';
      row.classList.toggle('is-local', user.isLocal);
      row.classList.toggle('is-following', user.clientId === this.followedUserClientId);

      const primaryAction = document.createElement(user.isLocal ? 'div' : 'button');
      primaryAction.className = 'presence-panel-user-button';

      const avatar = document.createElement('span');
      avatar.className = 'presence-panel-user-avatar';
      avatar.style.backgroundColor = user.color;
      avatar.style.color = getUserAvatarTextColor(user.color);
      avatar.textContent = user.name.charAt(0).toUpperCase();
      avatar.setAttribute('aria-hidden', 'true');

      const body = document.createElement('span');
      body.className = 'presence-panel-user-body';

      const topLine = document.createElement('span');
      topLine.className = 'presence-panel-user-topline';

      const name = document.createElement('span');
      name.className = 'presence-panel-user-name';
      name.textContent = user.name;
      topLine.appendChild(name);

      if (user.isLocal) {
        const youBadge = document.createElement('span');
        youBadge.className = 'presence-panel-user-badge';
        youBadge.textContent = 'You';
        topLine.appendChild(youBadge);
      } else if (user.clientId === this.followedUserClientId) {
        const followingBadge = document.createElement('span');
        followingBadge.className = 'presence-panel-user-badge';
        followingBadge.textContent = 'Following';
        topLine.appendChild(followingBadge);
      }

      const file = document.createElement('span');
      file.className = 'presence-panel-user-file';
      file.textContent = getUserFileLabel(this, user);

      body.append(topLine, file);
      primaryAction.append(avatar, body);

      if (user.isLocal) {
        primaryAction.setAttribute('role', 'group');
        primaryAction.setAttribute('aria-label', `${user.name} (you) — ${file.textContent}`);
      } else {
        const isFollowing = user.clientId === this.followedUserClientId;
        primaryAction.type = 'button';
        primaryAction.setAttribute(
          'aria-label',
          isFollowing
            ? `Keep following ${user.name}`
            : `Follow ${user.name} — ${file.textContent}`,
        );
        primaryAction.addEventListener('click', () => {
          this.startFollowingUser(user.clientId, { closePanel: true });
        });
      }

      row.appendChild(primaryAction);

      if (!user.isLocal && user.clientId === this.followedUserClientId) {
        const stopButton = document.createElement('button');
        stopButton.type = 'button';
        stopButton.className = 'presence-panel-user-stop';
        stopButton.textContent = 'Stop';
        stopButton.setAttribute('aria-label', `Stop following ${user.name}`);
        stopButton.addEventListener('click', (event) => {
          event.stopPropagation();
          this.stopFollowingUser({ closePanel: true });
        });
        row.appendChild(stopButton);
      }

      fragment.appendChild(row);
    });
    list.appendChild(fragment);
  },

  startFollowingUser(clientId, { closePanel = false } = {}) {
    if (!clientId) return;

    const user = this.globalUsers.find((entry) => entry.clientId === clientId && !entry.isLocal);
    if (!user) return;

    this.followedUserClientId = clientId;
    this.followedCursorSignature = '';
    if (closePanel && this.presencePanelOpen) {
      this.closePresencePanel();
    } else {
      this.renderAvatars();
      this.renderPresencePanel();
    }

    if (user.currentFile && user.currentFile !== this.currentFilePath) {
      this.navigation.navigateToFile(user.currentFile, { preserveFollow: true });
      return;
    }

    requestAnimationFrame(() => {
      if (this.followedUserClientId === clientId) {
        this.followUserCursor(user, { force: true });
      }
    });
  },

  toggleFollowUser(clientId) {
    if (!clientId) return;

    if (this.followedUserClientId === clientId) {
      this.stopFollowingUser();
      return;
    }

    this.startFollowingUser(clientId);
  },

  stopFollowingUser({ closePanel = false } = {}) {
    if (!this.followedUserClientId) return;
    if (this.currentFilePath && this.isExcalidrawFile?.(this.currentFilePath)) {
      void this.excalidrawEmbed?.setFollowedUser(this.currentFilePath, null);
    }
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    if (closePanel && this.presencePanelOpen) {
      this.closePresencePanel();
    } else {
      this.renderAvatars();
      this.renderPresencePanel();
    }
  },

  syncFollowedUser() {
    if (!this.followedUserClientId) return;
    const user = this.globalUsers.find((u) => u.clientId === this.followedUserClientId);
    if (!user || user.isLocal) {
      this.stopFollowingUser();
      return;
    }

    if (user.currentFile && user.currentFile !== this.currentFilePath) {
      this.navigation.navigateToFile(user.currentFile, { preserveFollow: true });
      return;
    }

    this.followUserCursor(user);
  },

  followUserCursor(user, { force = false } = {}) {
    if (this.currentFilePath && this.isExcalidrawFile?.(this.currentFilePath)) {
      this.followExcalidrawUser(user, { force });
      return;
    }

    const fileClientId = this.resolveFileClientId(user.peerId);
    const liveViewport = fileClientId != null ? this.session?.getUserViewport(fileClientId) : null;
    const liveCursor = fileClientId != null ? this.session?.getUserCursor(fileClientId) : null;
    const cursorHead = liveCursor?.cursorHead ?? null;
    const cursorLine = liveCursor?.cursorLine ?? null;
    const cursorAnchor = liveCursor?.cursorAnchor ?? null;
    const viewportTopLine = liveViewport?.topLine ?? null;
    const viewportRatio = liveViewport?.viewportRatio ?? 0.35;

    if (!user || (viewportTopLine == null && (cursorHead == null || cursorLine == null))) {
      this.followedCursorSignature = '';
      return;
    }

    const nextSig = `${user.clientId}:${viewportTopLine ?? 'no-viewport'}:${cursorAnchor ?? 'no-anchor'}:${cursorHead ?? 'no-head'}`;
    if (!force && nextSig === this.followedCursorSignature) return;

    const didScroll = (fileClientId != null && this.session?.scrollToUserViewport(fileClientId))
      || (fileClientId != null && this.session?.scrollToUserCursor(fileClientId, 'center'))
      || (cursorHead != null && this.session?.scrollToPosition(cursorHead, 'center'))
      || (cursorLine != null && this.session?.scrollToLine(cursorLine, viewportRatio));
    if (didScroll) this.followedCursorSignature = nextSig;
  },

  followExcalidrawUser(user, { force = false } = {}) {
    if (!user?.peerId || !this.currentFilePath) {
      this.followedCursorSignature = '';
      return;
    }

    const nextSig = `excalidraw:${this.currentFilePath}:${user.peerId}`;
    if (!force && nextSig === this.followedCursorSignature) {
      return;
    }

    void Promise.resolve(
      this.excalidrawEmbed?.setFollowedUser(this.currentFilePath, user.peerId),
    ).then((didApply) => {
      if (didApply === false || this.followedUserClientId !== user.clientId) {
        return;
      }

      this.followedCursorSignature = nextSig;
    }).catch(() => {});
  },

  resolveFileClientId(peerId) {
    if (!peerId || !this.session?.awareness) return null;
    for (const [clientId, state] of this.session.awareness.getStates()) {
      if (state.user?.peerId === peerId) return clientId;
    }
    return null;
  },
};
