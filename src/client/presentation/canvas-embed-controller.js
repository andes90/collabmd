import {
  getActiveVaultId,
  resolveAppUrl,
  resolveWsServerOverride,
} from '../domain/runtime-paths.js';

export class CanvasEmbedController {
  constructor({ getLocalUser, getTheme, onAwarenessChange, onConnectionChange, onOpenFile, toastController }) {
    this.getLocalUser = getLocalUser;
    this.getTheme = getTheme;
    this.onAwarenessChange = onAwarenessChange;
    this.onConnectionChange = onConnectionChange;
    this.onOpenFile = onOpenFile;
    this.toastController = toastController;
    this.iframe = null;
    this.filePath = null;
    this.ready = false;
    this.pendingDisconnects = new Map();
    this.handleMessage = (event) => this.onMessage(event);
  }

  mount(filePath, renderHost) {
    if (!renderHost || (this.filePath === filePath && this.iframe?.isConnected)) return;
    this.unmount();
    const url = new URL(resolveAppUrl('/canvas-editor.html'));
    url.searchParams.set('file', filePath);
    url.searchParams.set('theme', this.getTheme?.() ?? 'dark');
    const vaultId = getActiveVaultId();
    if (vaultId) url.searchParams.set('vaultId', vaultId);
    const server = resolveWsServerOverride();
    if (server) url.searchParams.set('server', server);
    const user = this.getLocalUser?.();
    for (const [key, value] of Object.entries({
      userName: user?.name,
      userColor: user?.color,
      userColorLight: user?.colorLight,
      userPeerId: user?.peerId,
    })) {
      if (value) url.searchParams.set(key, value);
    }

    const iframe = document.createElement('iframe');
    iframe.className = 'canvas-file-preview-frame';
    iframe.title = `Canvas: ${filePath}`;
    iframe.src = url.toString();
    this.filePath = filePath;
    this.iframe = iframe;
    window.addEventListener('message', this.handleMessage);
    renderHost.replaceChildren(iframe);
    this.onConnectionChange?.({ status: 'connecting', unreachable: false });
  }

  unmount() {
    window.removeEventListener('message', this.handleMessage);
    this.pendingDisconnects.forEach((finish) => finish(false));
    this.iframe?.remove();
    this.iframe = null;
    this.filePath = null;
    this.ready = false;
  }

  postMessage(message) {
    this.iframe?.contentWindow?.postMessage(message, window.location.origin);
  }

  updateTheme(theme) {
    this.postMessage({ type: 'canvas-theme', theme });
  }

  updateLocalUser(user = this.getLocalUser?.()) {
    if (user) this.postMessage({ type: 'canvas-user', user });
  }

  prepareFileDisconnect(filePath, { timeoutMs = 10000 } = {}) {
    if (filePath !== this.filePath || !this.iframe || !this.ready) return Promise.resolve(true);
    const requestId = crypto.randomUUID();
    return new Promise((resolve) => {
      const timeout = setTimeout(() => finish(false), timeoutMs);
      const finish = (canLeave) => {
        clearTimeout(timeout);
        this.pendingDisconnects.delete(requestId);
        if (!canLeave) this.toastController?.show('Waiting for the canvas to reconnect before leaving');
        resolve(canLeave);
      };
      this.pendingDisconnects.set(requestId, finish);
      this.postMessage({ type: 'canvas-prepare-disconnect', filePath, requestId });
    });
  }

  onMessage(event) {
    if (event.origin !== window.location.origin || !this.iframe || event.source !== this.iframe.contentWindow) return;
    const message = event.data;
    if (!message || typeof message !== 'object') return;
    if (message.type === 'canvas-open-file') {
      if (typeof message.filePath === 'string' && message.filePath) {
        const anchor = typeof message.subpath === 'string' && message.subpath.startsWith('#')
          ? message.subpath.slice(1)
          : null;
        this.onOpenFile?.(message.filePath, anchor ? { anchor } : {});
      }
      return;
    }
    if (message.filePath !== this.filePath) return;
    if (message.type === 'canvas-ready') {
      this.ready = true;
      this.updateTheme(this.getTheme?.() ?? 'dark');
      this.updateLocalUser();
    } else if (message.type === 'canvas-awareness' && Array.isArray(message.users)) {
      this.onAwarenessChange?.(message.users);
    } else if (message.type === 'canvas-connection' && ['connected', 'connecting', 'disconnected'].includes(message.state?.status)) {
      this.onConnectionChange?.(message.state);
    } else if (message.type === 'canvas-disconnect-ready' || message.type === 'canvas-disconnect-blocked') {
      this.pendingDisconnects.get(message.requestId)?.(message.type === 'canvas-disconnect-ready');
    }
  }
}
