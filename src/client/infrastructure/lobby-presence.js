import { WebsocketProvider } from 'y-websocket';
import * as Y from 'yjs';

import { createRandomUser } from '../domain/room.js';
import { resolveWsBaseUrl } from './runtime-config.js';

const LOBBY_ROOM_NAME = '__lobby__';
export const LOBBY_CHAT_MESSAGE_MAX_LENGTH = 280;
export const LOBBY_CHAT_MAX_MESSAGES = 40;

function normalizeChatMessage(value) {
  const normalized = String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, LOBBY_CHAT_MESSAGE_MAX_LENGTH);

  return normalized || null;
}

function createLobbyMessageId(peerId) {
  if (globalThis.crypto?.randomUUID) {
    return globalThis.crypto.randomUUID();
  }

  return `${peerId || 'user'}-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
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
  constructor({ preferredUserName, onChange, onChatChange }) {
    this.onChange = onChange;
    this.onChatChange = onChatChange;
    this.wsBaseUrl = resolveWsBaseUrl();
    this.ydoc = new Y.Doc();
    this.chatMessages = this.ydoc.getArray('chat-messages');
    this.provider = null;
    this.awareness = null;
    this.localUser = createRandomUser(preferredUserName);
    this.currentFile = null;
    this._connected = false;
    this._didInitialSync = false;
    this.handleAwarenessChange = () => {
      this._emitChange();
    };
    this.handleChatMessagesChange = () => {
      this._emitChatChange();
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

    this.awareness = this.provider.awareness;
    this.awareness.setLocalStateField('user', this.localUser);
    this.awareness.setLocalStateField('currentFile', this.currentFile);

    this.awareness.on('change', this.handleAwarenessChange);

    this.chatMessages.observe(this.handleChatMessagesChange);

    this.provider.on('status', ({ status }) => {
      this._connected = status === 'connected';
    });

    this.provider.on('sync', (isSynced) => {
      if (!isSynced || this._didInitialSync) {
        return;
      }

      this._didInitialSync = true;
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

  disconnect() {
    this.awareness?.off('change', this.handleAwarenessChange);
    this.chatMessages?.unobserve(this.handleChatMessagesChange);
    this.provider?.disconnect();
    this.provider?.destroy();
    this.provider = null;
    this.awareness = null;
    this._connected = false;
    this._didInitialSync = false;
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
}
