export const presenceFeature = {
  updateGlobalUsers(users) {
    this.globalUsers = users;
    this.syncFollowedUser();
    this.renderAvatars();
    this.renderChat();
    this.renderPresence();
    this.syncCurrentUserName();
  },

  updateFileAwareness(_users) {
    this.syncFollowedUser();
  },

  renderPresence() {
    const badge = this.elements.userCount;
    if (!badge) return;

    if (this.connectionState.status === 'connected') {
      badge.textContent = `${this.globalUsers.length} online`;
      badge.style.opacity = '1';
      return;
    }

    if (this.connectionState.status === 'connecting') {
      badge.textContent = this.connectionState.unreachable ? 'Unreachable' : 'Connecting...';
      badge.style.opacity = '0.6';
      return;
    }

    badge.textContent = 'Offline';
    badge.style.opacity = '0.6';
  },

  renderAvatars() {
    const avatars = this.elements.userAvatars;
    if (!avatars) return;

    avatars.innerHTML = '';
    const visibleUsers = [...this.globalUsers];
    const localIndex = visibleUsers.findIndex((u) => u.isLocal);
    if (localIndex > 0) {
      const [localUser] = visibleUsers.splice(localIndex, 1);
      visibleUsers.unshift(localUser);
    }

    const followedIndex = visibleUsers.findIndex((u) => !u.isLocal && u.clientId === this.followedUserClientId);
    const followedInsertIndex = visibleUsers[0]?.isLocal ? 1 : 0;
    if (followedIndex > followedInsertIndex) {
      const [followed] = visibleUsers.splice(followedIndex, 1);
      visibleUsers.splice(followedInsertIndex, 0, followed);
    }

    visibleUsers.slice(0, 5).forEach((user) => {
      const avatar = document.createElement(user.isLocal ? 'div' : 'button');
      avatar.className = 'user-avatar';
      avatar.classList.toggle('is-local', user.isLocal);
      avatar.style.backgroundColor = user.color;
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

    if (visibleUsers.length > 5) {
      const overflow = document.createElement('div');
      overflow.className = 'user-avatar';
      overflow.style.backgroundColor = 'var(--color-surface-dynamic)';
      overflow.style.color = 'var(--color-text-muted)';
      const overflowLabel = document.createElement('span');
      overflowLabel.className = 'user-avatar-initial';
      overflowLabel.textContent = `+${visibleUsers.length - 5}`;
      overflow.appendChild(overflowLabel);
      avatars.appendChild(overflow);
    }
  },

  toggleFollowUser(clientId) {
    if (!clientId) return;

    if (this.followedUserClientId === clientId) {
      this.stopFollowingUser();
      return;
    }

    const user = this.globalUsers.find((u) => u.clientId === clientId && !u.isLocal);
    if (!user) return;

    this.followedUserClientId = clientId;
    this.followedCursorSignature = '';
    this.renderAvatars();

    if (user.currentFile && user.currentFile !== this.currentFilePath) {
      this.navigation.navigateToFile(user.currentFile);
      this.toastController.show(`Following ${user.name} — switching to ${this.getDisplayName(user.currentFile)}`);
      return;
    }

    requestAnimationFrame(() => {
      if (this.followedUserClientId === clientId) {
        this.followUserCursor(user, { force: true });
      }
    });

    this.toastController.show(`Following ${user.name}`);
  },

  stopFollowingUser(showToast = true) {
    if (!this.followedUserClientId) return;
    const name = this.globalUsers.find((u) => u.clientId === this.followedUserClientId)?.name ?? 'collaborator';
    if (this.currentFilePath && this.isExcalidrawFile?.(this.currentFilePath)) {
      void this.excalidrawEmbed?.setFollowedUser(this.currentFilePath, null);
    }
    this.followedUserClientId = null;
    this.followedCursorSignature = '';
    this.renderAvatars();
    if (showToast) this.toastController.show(`Stopped following ${name}`);
  },

  syncFollowedUser() {
    if (!this.followedUserClientId) return;
    const user = this.globalUsers.find((u) => u.clientId === this.followedUserClientId);
    if (!user || user.isLocal) {
      this.stopFollowingUser(false);
      return;
    }

    if (user.currentFile && user.currentFile !== this.currentFilePath) {
      this.navigation.navigateToFile(user.currentFile);
      this.toastController.show(`${user.name} switched to ${this.getDisplayName(user.currentFile)}`);
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

    this.followedCursorSignature = nextSig;
    void this.excalidrawEmbed?.setFollowedUser(this.currentFilePath, user.peerId);
  },

  resolveFileClientId(peerId) {
    if (!peerId || !this.session?.awareness) return null;
    for (const [clientId, state] of this.session.awareness.getStates()) {
      if (state.user?.peerId === peerId) return clientId;
    }
    return null;
  },
};
