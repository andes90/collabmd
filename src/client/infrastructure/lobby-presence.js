import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { createRandomUser } from '../domain/room.js';
import { LOBBY_CHAT_MAX_MESSAGES, LOBBY_CHAT_MESSAGE_MAX_LENGTH } from '../domain/lobby-chat.js';
import { resolveWsBaseUrl } from './runtime-config.js';
import { stopReconnectOnControlledClose } from './yjs-provider-reset-guard.js';

const LOBBY_ROOM_NAME = '__lobby__';


function normalizeChatMessage(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LOBBY_CHAT_MESSAGE_MAX_LENGTH);

  return normalized || null;
}

function createLobbyMessageId(peerId) {
  return globalThis.crypto?.randomUUID?.()
    ?? `${peerId || 'user'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

function normalizeWorkspaceEvent(event) {
  if (!event || typeof event !== 'object' || typeof event.id !== 'string') {
    return null;
  }

  const workspaceChange = event.workspaceChange && typeof event.workspaceChange === 'object'
    ? event.workspaceChange
    : {};

  return {
    action: typeof event.action === 'string' ? event.action : 'git',
    createdAt: Number.isFinite(event.createdAt) ? event.createdAt : Date.now(),
    id: event.id,
    peerId: typeof event.peerId === 'string' ? event.peerId : null,
    sourceRef: typeof event.sourceRef === 'string' ? event.sourceRef : null,
    workspaceChange: {
      changedPaths: Array.isArray(workspaceChange.changedPaths) ? workspaceChange.changedPaths.filter(Boolean) : [],
      deletedPaths: Array.isArray(workspaceChange.deletedPaths) ? workspaceChange.deletedPaths.filter(Boolean) : [],
      refreshExplorer: workspaceChange.refreshExplorer !== false,
      renamedPaths: Array.isArray(workspaceChange.renamedPaths)
        ? workspaceChange.renamedPaths.filter((entry) => entry?.oldPath && entry?.newPath)
        : [],
    },
  };
}

/**
 * Global presence layer.
 *
 * Every client joins a lightweight Yjs "lobby" room whose document is never
 * written to.  Only the awareness channel is used — each client publishes
 * `{ user, currentFile }` so that every other client can see who is online
 * and which file they are editing.
 */
export class LobbyPresence {
  constructor({ preferredUserName, onChange, onChatChange, onWorkspaceEvent }) {
    this.onChange = onChange;
    this.onChatChange = onChatChange;
    this.onWorkspaceEvent = onWorkspaceEvent;
    this.wsBaseUrl = resolveWsBaseUrl();
    this.ydoc = new Y.Doc();
    this.chatMessages = this.ydoc.getArray('chat-messages');
    this.workspaceEvents = this.ydoc.getArray('workspace-events');
    this.provider = null;
    this.awareness = null;
    this.localUser = createRandomUser(preferredUserName);
    this.currentFile = null;
    this._connected = false;
    this._didInitialSync = false;
    this.seenWorkspaceEventIds = new Set();
    this.handleAwarenessChange = () => {
      this._emitChange();
    };
    this.handleChatMessagesChange = () => {
      this._emitChatChange();
    };
    this.handleWorkspaceEventsChange = () => {
      this._emitWorkspaceEvents();
    };
  }

  connect() {
    if (this.provider) return;

    this._didInitialSync = false;

    this.provider = new WebsocketProvider(
      this.wsBaseUrl,
      LOBBY_ROOM_NAME,
      this.ydoc,
      { disableBc: true, maxBackoffTime: 5000 },
    );
    stopReconnectOnControlledClose(this.provider);

    this.awareness = this.provider.awareness;
    this.awareness.setLocalStateField('user', this.localUser);
    this.awareness.setLocalStateField('currentFile', this.currentFile);

    this.awareness.on('change', this.handleAwarenessChange);

    this.chatMessages.observe(this.handleChatMessagesChange);
    this.workspaceEvents.observe(this.handleWorkspaceEventsChange);

    this.provider.on('status', ({ status }) => {
      this._connected = status === 'connected';
      this._emitChange();
    });

    this.provider.on('sync', (isSynced) => {
      if (!isSynced || this._didInitialSync) {
        return;
      }

      this._didInitialSync = true;
      this._primeWorkspaceEventCache();
      this._emitChange();
      this._emitChatChange({ initial: true });
    });
  }

  /** Update which file the local user is currently viewing. */
  setCurrentFile(filePath) {
    this.currentFile = filePath;
    if (this.awareness) {
      this.awareness.setLocalStateField('currentFile', filePath);
    }
  }

  /** Update the local user's display name (after rename). */
  setUserName(name) {
    if (!name) return;
    this.localUser = { ...this.localUser, name };
    if (this.awareness) {
      this.awareness.setLocalStateField('user', this.localUser);
    }
  }

  /** Return the local user object (name + color). */
  getLocalUser() {
    return this.localUser;
  }

  sendChatMessage(text) {
    const normalizedText = normalizeChatMessage(text);
    if (!normalizedText) {
      return null;
    }

    const message = {
      createdAt: Date.now(),
      filePath: this.currentFile ?? null,
      id: createLobbyMessageId(this.localUser.peerId),
      peerId: this.localUser.peerId,
      text: normalizedText,
      userColor: this.localUser.color,
      userName: this.localUser.name,
    };

    this.ydoc.transact(() => {
      this.chatMessages.push([message]);

      const overflow = this.chatMessages.length - LOBBY_CHAT_MAX_MESSAGES;
      if (overflow > 0) {
        this.chatMessages.delete(0, overflow);
      }
    }, 'lobby-chat-message');

    return message;
  }

  sendWorkspaceEvent({ action = 'git', sourceRef = null, workspaceChange = {} } = {}) {
    const event = normalizeWorkspaceEvent({
      action,
      createdAt: Date.now(),
      id: createLobbyMessageId(this.localUser.peerId),
      peerId: this.localUser.peerId,
      sourceRef,
      workspaceChange,
    });
    if (!event) {
      return null;
    }

    this.ydoc.transact(() => {
      this.workspaceEvents.push([event]);

      const overflow = this.workspaceEvents.length - LOBBY_CHAT_MAX_MESSAGES;
      if (overflow > 0) {
        this.workspaceEvents.delete(0, overflow);
      }
    }, 'lobby-workspace-event');

    this.seenWorkspaceEventIds.add(event.id);
    return event;
  }

  getMessages() {
    return this.chatMessages.toArray().filter((message) => (
      message
      && typeof message.id === 'string'
      && typeof message.peerId === 'string'
      && typeof message.text === 'string'
      && typeof message.userName === 'string'
    ));
  }

  /**
   * Collect all users across the lobby.
   * Returns an array of `{ name, color, clientId, currentFile, isLocal }`.
   */
  getUsers() {
    if (!this.awareness) return [];

    const users = [];
    this.awareness.getStates().forEach((state, clientId) => {
      if (!state.user) return;
      users.push({
        ...state.user,
        clientId,
        currentFile: state.currentFile ?? null,
        isLocal: clientId === this.awareness.clientID,
      });
    });
    return users;
  }

  getConnectionState() {
    if (this._connected) {
      return { status: 'connected', unreachable: false };
    }

    if (this.provider) {
      return { status: 'connecting', unreachable: false };
    }

    return { status: 'disconnected', unreachable: false };
  }

  disconnect() {
    if (this.provider) {
      this.awareness?.off('change', this.handleAwarenessChange);
      this.chatMessages?.unobserve(this.handleChatMessagesChange);
      this.workspaceEvents?.unobserve(this.handleWorkspaceEventsChange);
    }
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this.awareness = null;
    this._connected = false;
    this._didInitialSync = false;
    this.seenWorkspaceEventIds.clear();
  }

  destroy() {
    this.disconnect();
    this.ydoc?.destroy();
    this.ydoc = null;
  }

  _emitChange() {
    this.onChange?.(this.getUsers());
  }

  _emitChatChange(meta = {}) {
    this.onChatChange?.(this.getMessages(), meta);
  }

  _primeWorkspaceEventCache() {
    this.workspaceEvents.toArray().forEach((event) => {
      const normalized = normalizeWorkspaceEvent(event);
      if (normalized) {
        this.seenWorkspaceEventIds.add(normalized.id);
      }
    });
  }

  _emitWorkspaceEvents() {
    if (!this._didInitialSync) {
      this._primeWorkspaceEventCache();
      return;
    }

    this.workspaceEvents.toArray().forEach((event) => {
      const normalized = normalizeWorkspaceEvent(event);
      if (!normalized || this.seenWorkspaceEventIds.has(normalized.id)) {
        return;
      }

      this.seenWorkspaceEventIds.add(normalized.id);
      if (normalized.peerId === this.localUser.peerId) {
        return;
      }

      this.onWorkspaceEvent?.(normalized);
    });
  }
}
