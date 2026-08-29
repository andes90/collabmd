import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import { parseExcalidrawElementLink } from '../domain/excalidraw-element-link.js';
import { reconcileEmbedEntries } from './excalidraw-embed-reconciler.js';
import { resolveAppPath, resolveAppUrl, resolveWsServerOverride } from '../domain/runtime-paths.js';
import {
  cancelIdleRender,
  isNearViewport,
  requestIdleRender,
} from '../browser-utils.js';

const DEFAULT_HEIGHT = 420;
const HYDRATE_TIMEOUT_MS = 500;
const IFRAME_BOOT_TIMEOUT_MS = 15000;
const MAX_HEIGHT = 800;
const MAX_IFRAME_BOOT_ATTEMPTS = 3;
const MIN_HEIGHT = 200;
const EDITOR_IFRAME_PATH = '/excalidraw-editor.html';

function findEmbedPlaceholder(previewElement, key) {
  const placeholders = previewElement?.querySelectorAll?.(
    '.excalidraw-embed-placeholder[data-embed-key]',
  );
  return Array.from(placeholders || []).find((placeholder) => placeholder.dataset?.embedKey === key) || null;
}

export class ExcalidrawEmbedController {
  constructor({
    getTheme,
    getLocalUser,
    onOpenElement = null,
    onOpenFile = null,
    onStopFollowing = null,
    onToggleQuickSwitcher = null,
    previewContainer,
    previewElement,
    toastController,
  }) {
    this.getTheme = getTheme;
    this.getLocalUser = getLocalUser;
    this.onOpenElement = onOpenElement;
    this.onOpenFile = onOpenFile;
    this.onStopFollowing = onStopFollowing;
    this.onToggleQuickSwitcher = onToggleQuickSwitcher;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.embedEntries = new Map();
    this.hydrationQueue = [];
    this.hydrationIdleId = null;
    this.hydrationPaused = false;
    this.hydrationInProgress = false;
    this.instanceCounter = 0;
    this.isLargeDocument = false;
    this.maximizedEmbed = null;
    this.overlayRoot = null;
    this.warmCacheRoot = null;
    this.warmEntry = null;
    this.placeholderObserver = null;
    this.followedPeerIdsByFilePath = new Map();
    this.pendingDisconnectRequests = new Map();
    this.disconnectRequestCounter = 0;
    this.pendingAgentBridgeRequests = new Map();
    this.agentBridgeRequestCounter = 0;

    this._onMessage = this._onMessage.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);

    window.addEventListener('message', this._onMessage);
    window.addEventListener('keydown', this._onKeyDown);
    this.previewElement?.addEventListener('click', this._onPreviewClick);
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    window.removeEventListener('keydown', this._onKeyDown);
    this.previewElement?.removeEventListener('click', this._onPreviewClick);
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this._exitMaximizedEmbed();
    document.body.classList.remove('excalidraw-maximized-open');

    this.embedEntries.forEach((entry) => {
      this._clearEntryBootTimeout(entry);
      entry.resizerCleanup?.();
      entry.resizerCleanup = null;
      entry.wrapper?.remove();
      entry.placeholder = null;
    });
    this.embedEntries.clear();
    if (this.warmEntry) {
      this._clearEntryBootTimeout(this.warmEntry);
      this.warmEntry.resizerCleanup?.();
      this.warmEntry.resizerCleanup = null;
      this.warmEntry.wrapper?.remove();
      this.warmEntry = null;
    }
    this.pendingDisconnectRequests.forEach((request) => {
      request.resolve(false);
    });
    this.pendingDisconnectRequests.clear();
    this.pendingAgentBridgeRequests.forEach((request) => {
      request.resolve({ status: 'destroyed' });
    });
    this.pendingAgentBridgeRequests.clear();
    this.followedPeerIdsByFilePath.clear();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
    this.warmCacheRoot?.remove();
    this.warmCacheRoot = null;
  }

  async setFollowedUser(filePath, peerId = null) {
    if (!filePath) {
      return false;
    }

    this.followedPeerIdsByFilePath.set(filePath, peerId || null);

    const entry = this._findEntryByFilePath(filePath);
    if (!entry) {
      return true;
    }

    if (!entry.wrapper) {
      await this._hydrateEntry(entry);
    }

    entry.followedPeerId = this.followedPeerIdsByFilePath.get(filePath) ?? null;
    this._syncEntryFollowState(entry);
    return true;
  }

  detachForCommit() {
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.hydrationInProgress = false;
    this._exitMaximizedEmbed();
    if (this.overlayRoot) {
      this.overlayRoot.hidden = true;
    }

    this.embedEntries.forEach((entry) => {
      entry.queued = false;
      entry.placeholder = null;
    });
  }

  setHydrationPaused(paused) {
    this.hydrationPaused = Boolean(paused);

    if (this.hydrationPaused) {
      cancelIdleRender(this.hydrationIdleId);
      this.hydrationIdleId = null;
      return;
    }

    this.hydrateVisibleEmbeds();
    this._scheduleHydration();
  }

  reconcileEmbeds(previewElement, { isLargeDocument = false } = {}) {
    this.isLargeDocument = Boolean(isLargeDocument);
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.hydrationInProgress = false;

    const descriptors = Array.from(previewElement.querySelectorAll('.excalidraw-embed-placeholder[data-embed-key]')).map((placeholder) => ({
      filePath: placeholder.dataset.embedTarget,
      key: placeholder.dataset.embedKey,
      label: placeholder.dataset.embedLabel || placeholder.dataset.embedTarget,
      placeholder,
    }));

    const { nextEntries, removedEntries } = reconcileEmbedEntries(this.embedEntries, descriptors);
    this._captureWarmEntry(removedEntries);
    this._adoptReusableEntries(nextEntries, removedEntries);
    removedEntries.forEach((entry) => this._destroyEntry(entry));
    this.embedEntries = nextEntries;

    this._ensurePlaceholderObserver();

    this.embedEntries.forEach((entry) => {
      entry.queued = false;
      entry.followedPeerId = this.followedPeerIdsByFilePath.get(entry.filePath);
      if (entry.wrapper) {
        void this._hydrateEntry(entry);
        return;
      }

      if (!entry.placeholder) {
        return;
      }

      this.placeholderObserver?.observe(entry.placeholder);
    });

    if (!this.hydrationPaused) {
      this.hydrateVisibleEmbeds();
    }

    this.syncLayout();
  }

  hydrateVisibleEmbeds() {
    if (this.hydrationPaused) {
      return;
    }

    const margin = this.isLargeDocument ? 180 : 420;
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper || !entry.placeholder?.isConnected) {
        return;
      }

      if (isNearViewport(entry.placeholder, this.previewContainer, margin)) {
        this._enqueueHydration(entry, { prioritize: true });
      }
    });
  }

  updateTheme(theme) {
    this._forEachManagedEntry((entry) => {
      this._postMessageToEntry(entry, {
        source: 'collabmd-host',
        type: 'set-theme',
        theme,
      });
    });
  }

  updateLocalUser(user) {
    this._forEachManagedEntry((entry) => {
      this._syncEntryUser(entry, user);
    });
  }

  openCommentThread(filePath, threadId) {
    if (!filePath || !threadId) {
      return false;
    }

    const entry = this._findEntryByFilePath(filePath);
    if (!entry) {
      return false;
    }

    entry.pendingCommentThreadId = threadId;
    if (entry.isReady) {
      this._postPendingCommentThread(entry);
    } else if (!entry.wrapper) {
      this._enqueueHydration(entry, { prioritize: true });
    }
    return true;
  }

  openElement(filePath, elementId, elementType = 'element') {
    if (!filePath || !elementId) {
      return false;
    }

    const entry = this._findEntryByFilePath(filePath);
    if (!entry) {
      return false;
    }

    entry.pendingElementFocus = {
      elementId: String(elementId),
      elementType: elementType === 'group' ? 'group' : 'element',
    };
    if (entry.isReady) {
      this._postPendingElement(entry);
    } else if (!entry.wrapper) {
      this._enqueueHydration(entry, { prioritize: true });
    }
    return true;
  }

  prepareFileDisconnect(filePath, { timeoutMs = 10000 } = {}) {
    const entry = this._findEntryByFilePath(filePath);
    if (!entry?.iframe?.contentWindow) {
      return Promise.resolve(true);
    }

    const requestId = `disconnect-${++this.disconnectRequestCounter}`;
    return new Promise((resolve) => {
      const finish = (value) => {
        if (!this.pendingDisconnectRequests.has(requestId)) {
          return;
        }

        const request = this.pendingDisconnectRequests.get(requestId);
        window.clearTimeout(request.timeoutId);
        this.pendingDisconnectRequests.delete(requestId);
        resolve(value);
      };

      const timeoutId = window.setTimeout(() => {
        const shouldDiscard = window.confirm(
          'This diagram has not reconnected, so its latest queued changes may not be saved. Discard pending changes and leave?',
        );
        if (!shouldDiscard) {
          this._postMessageToEntry(entry, {
            source: 'collabmd-host',
            type: 'cancel-disconnect',
            requestId,
          });
          this.toastController?.show?.('Stayed on the diagram while it reconnects');
          finish(false);
          return;
        }

        this._postMessageToEntry(entry, {
          source: 'collabmd-host',
          type: 'discard-and-disconnect',
          requestId,
        });
        const request = this.pendingDisconnectRequests.get(requestId);
        if (request) {
          request.timeoutId = window.setTimeout(() => finish(true), 1000);
        }
      }, timeoutMs);

      this.pendingDisconnectRequests.set(requestId, {
        entry,
        resolve: finish,
        timeoutId,
      });

      this._postMessageToEntry(entry, {
        source: 'collabmd-host',
        type: 'prepare-disconnect',
        requestId,
      });
    });
  }

  flushPendingAgentWrites(filePath, { signal = null, timeoutMs = 1500 } = {}) {
    const entry = this._findEntryByFilePath(filePath);
    if (
      !entry?.isReady
      || !entry.iframe?.contentWindow
      || this._getEntryMode(entry) !== 'edit'
    ) {
      return Promise.resolve({ status: 'not-active' });
    }
    return this._requestAgentBridge(
      entry,
      'flush-agent-writes',
      {},
      { signal, timeoutMs },
    );
  }

  waitForAgentPaint(filePath, revision, { signal = null, timeoutMs = 5000 } = {}) {
    const entry = this._findEntryByFilePath(filePath);
    if (!entry?.isReady || !entry.iframe?.contentWindow || !revision) {
      return Promise.resolve({ status: 'not-active' });
    }
    return this._requestAgentBridge(
      entry,
      'wait-for-agent-revision',
      { revision },
      { signal, timeoutMs },
    );
  }

  _requestAgentBridge(entry, type, payload, { signal, timeoutMs }) {
    const requestId = `agent-bridge-${++this.agentBridgeRequestCounter}`;
    return new Promise((resolve) => {
      const finish = (value) => {
        const request = this.pendingAgentBridgeRequests.get(requestId);
        if (!request) return;
        window.clearTimeout(request.timeoutId);
        signal?.removeEventListener?.('abort', request.abort);
        this.pendingAgentBridgeRequests.delete(requestId);
        resolve(value);
      };
      const abort = () => finish({ status: 'cancelled' });
      const timeoutId = window.setTimeout(() => finish({ status: 'timeout' }), timeoutMs);
      this.pendingAgentBridgeRequests.set(requestId, {
        abort,
        entry,
        resolve: finish,
        timeoutId,
      });
      signal?.addEventListener?.('abort', abort, { once: true });
      if (signal?.aborted) {
        abort();
        return;
      }
      this._postMessageToEntry(entry, {
        ...payload,
        requestId,
        source: 'collabmd-host',
        type,
      });
    });
  }

  _ensurePlaceholderObserver() {
    if (!this.previewContainer) {
      return;
    }

    this.placeholderObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const embedEntry = this.embedEntries.get(entry.target.dataset.embedKey);
        if (embedEntry) {
          this._enqueueHydration(embedEntry);
        }
      });
    }, {
      root: this.previewContainer,
      rootMargin: this.isLargeDocument ? '180px 0px' : '420px 0px',
    });
  }

  _disconnectPlaceholderObserver() {
    if (!this.placeholderObserver) {
      return;
    }

    this.placeholderObserver.disconnect();
    this.placeholderObserver = null;
  }

  _enqueueHydration(entry, { prioritize = false } = {}) {
    if (!entry || entry.wrapper || entry.queued) {
      return;
    }

    entry.queued = true;
    if (prioritize) {
      this.hydrationQueue.unshift(entry.key);
    } else {
      this.hydrationQueue.push(entry.key);
    }

    if (this.hydrationPaused) {
      return;
    }

    if (prioritize && !this.hydrationInProgress && this.hydrationIdleId === null) {
      void this._flushHydrationQueue();
      return;
    }

    this._scheduleHydration();
  }

  _scheduleHydration() {
    if (this.hydrationPaused || this.hydrationInProgress || this.hydrationIdleId !== null) {
      return;
    }

    this.hydrationIdleId = requestIdleRender(() => {
      this.hydrationIdleId = null;
      void this._flushHydrationQueue();
    }, HYDRATE_TIMEOUT_MS);
  }

  async _flushHydrationQueue() {
    if (this.hydrationPaused || this.hydrationInProgress) {
      return;
    }

    let nextEntry = null;
    while (this.hydrationQueue.length > 0 && !nextEntry) {
      const key = this.hydrationQueue.shift();
      const entry = this.embedEntries.get(key);
      if (!entry || entry.wrapper || !entry.placeholder?.isConnected) {
        if (entry) {
          entry.queued = false;
        }
        continue;
      }

      nextEntry = entry;
    }

    if (!nextEntry) {
      return;
    }

    this.hydrationInProgress = true;
    nextEntry.queued = false;

    await this._hydrateEntry(nextEntry);

    this.hydrationInProgress = false;
    if (this.hydrationQueue.length > 0) {
      this._scheduleHydration();
    }
  }

  async _hydrateEntry(entry) {
    if (!entry.placeholder?.isConnected && !entry.wrapper) {
      return;
    }

    entry.isParked = false;

    if (!entry.wrapper) {
      const mount = this._createEmbedContainer(entry);
      if (!mount) {
        return;
      }
      entry.header = mount.header;
      entry.wrapper = mount.wrapper;
      entry.iframe = mount.iframe;
      entry.labelElement = mount.labelElement;
      entry.maxButton = mount.maxButton;
      entry.openButton = mount.openButton;
      entry.instanceId = mount.instanceId;
      entry.resizerCleanup = mount.resizerCleanup;
      entry.isReady = false;
      entry.bootFilePath = entry.filePath;
      entry.bootMode = this._getEntryMode(entry);
      entry.loadedFilePath = entry.bootFilePath;
      entry.loadedMode = entry.bootMode;
      entry.bootAttempts = (entry.bootAttempts ?? 0) + 1;
      this._armEntryBootTimeout(entry);
    }

    entry.followedPeerId = this.followedPeerIdsByFilePath.get(entry.filePath);
    this._updateEmbedLabel(entry);
    if (this._entryNeedsHardReload(entry)) {
      this._reloadEntry(entry);
    }
    this._attachWrapper(entry);
  }

  _attachWrapper(entry) {
    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : findEmbedPlaceholder(this.previewElement, entry.key);

    if (!placeholder) {
      return;
    }

    entry.placeholder = placeholder;
    this._syncMountedEntryMetadata(entry);
    if (this._shouldInlineFilePreview(entry)) {
      entry.wrapper.style.position = '';
      entry.wrapper.style.top = '';
      entry.wrapper.style.left = '';
      entry.wrapper.style.width = '';
      entry.wrapper.style.margin = '';
      entry.wrapper.style.pointerEvents = 'auto';
      placeholder.replaceWith(entry.wrapper);
      entry.placeholder = null;
      return;
    }

    const overlayRoot = this._ensureOverlayRoot();
    overlayRoot.hidden = false;
    if (entry.wrapper?.parentElement !== overlayRoot) {
      overlayRoot.appendChild(entry.wrapper);
    }

    this._syncEntryLayout(entry);
  }

  _adoptReusableEntries(nextEntries, removedEntries) {
    nextEntries.forEach((nextEntry, key) => {
      if (nextEntry.wrapper || nextEntry.iframe) {
        return;
      }

      const reusedEntry = this._claimReusableEntry(nextEntry, removedEntries);
      if (!reusedEntry) {
        return;
      }

      reusedEntry.filePath = nextEntry.filePath;
      reusedEntry.key = nextEntry.key;
      reusedEntry.label = nextEntry.label;
      reusedEntry.placeholder = nextEntry.placeholder;
      reusedEntry.pendingElementFocus = null;
      reusedEntry.queued = false;
      nextEntries.set(key, reusedEntry);
    });
  }

  _destroyEntry(entry) {
    this.pendingDisconnectRequests.forEach((request, requestId) => {
      if (request.entry === entry) {
        request.resolve(false);
        this.pendingDisconnectRequests.delete(requestId);
      }
    });

    if (this.maximizedEmbed?.wrapper === entry.wrapper) {
      this._exitMaximizedEmbed();
    }

    this._clearEntryBootTimeout(entry);
    entry.resizerCleanup?.();
    entry.resizerCleanup = null;
    if (this.warmEntry === entry) {
      this.warmEntry = null;
    }
    this._resetPlaceholderLayout(entry);
    this._setEntryLoadingState(entry, false);
    entry.wrapper?.remove();
    entry.placeholder = null;
  }

  _armEntryBootTimeout(entry, delayMs = IFRAME_BOOT_TIMEOUT_MS) {
    this._clearEntryBootTimeout(entry);
    entry.bootTimerId = window.setTimeout(() => {
      void this._handleEntryBootTimeout(entry);
    }, delayMs);
  }

  _clearEntryBootTimeout(entry) {
    if (!entry?.bootTimerId) {
      return;
    }

    window.clearTimeout(entry.bootTimerId);
    entry.bootTimerId = null;
  }

  async _handleEntryBootTimeout(entry) {
    if (!entry?.iframe?.isConnected) {
      return;
    }

    if ((entry.bootAttempts ?? 0) >= MAX_IFRAME_BOOT_ATTEMPTS) {
      this._clearEntryBootTimeout(entry);
      this.toastController?.show(`Excalidraw embed timed out: ${entry.label}`);
      return;
    }

    await this._retryEntryBootstrap(entry);
  }

  async _retryEntryBootstrap(entry) {
    if (!entry) {
      return;
    }

    this._clearEntryBootTimeout(entry);
    this._resetPlaceholderLayout(entry);
    this._setEntryLoadingState(entry, false);

    if (this.maximizedEmbed?.wrapper === entry.wrapper) {
      this._exitMaximizedEmbed();
    }

    entry.wrapper?.remove();
    entry.wrapper = null;
    entry.iframe = null;
    entry.header = null;
    entry.labelElement = null;
    entry.maxButton = null;
    entry.openButton = null;
    entry.instanceId = null;
    entry.isReady = false;
    entry.isParked = false;
    entry.bootFilePath = null;
    entry.bootMode = null;
    entry.loadedFilePath = null;
    entry.loadedMode = null;

    await this._hydrateEntry(entry);
  }

  _findEntryByContentWindow(contentWindow) {
    if (!contentWindow) {
      return null;
    }

    for (const entry of this.embedEntries.values()) {
      if (entry.iframe?.contentWindow === contentWindow) {
        return entry;
      }
    }

    if (this.warmEntry?.iframe?.contentWindow === contentWindow) {
      return this.warmEntry;
    }

    return null;
  }

  _findEntryByFilePath(filePath) {
    if (!filePath) {
      return null;
    }

    for (const entry of this.embedEntries.values()) {
      if (entry.filePath === filePath) {
        return entry;
      }
    }

    if (this.warmEntry?.filePath === filePath) {
      return this.warmEntry;
    }

    return null;
  }

  _updateEmbedLabel(entry) {
    if (entry.labelElement) {
      entry.labelElement.textContent = entry.label.replace(/\.excalidraw$/i, '');
    }
  }

  _syncMountedEntryMetadata(entry) {
    if (entry.wrapper) {
      entry.wrapper.dataset.embedKey = entry.key;
      entry.wrapper.dataset.file = entry.filePath;
      entry.wrapper.classList.toggle('is-direct-file', this._isFilePreviewEntry(entry));
    }

    if (entry.iframe) {
      entry.iframe.title = `Excalidraw: ${entry.filePath}`;
    }

    if (entry.openButton) {
      if (this._isFilePreviewEntry(entry)) {
        entry.openButton.remove();
      } else if (!entry.openButton.isConnected && entry.header) {
        entry.header.insertBefore(entry.openButton, entry.maxButton || null);
      }
    }
  }

  _buildIframeUrl(entry) {
    let iframeUrl;
    try {
      iframeUrl = new URL(resolveAppUrl(EDITOR_IFRAME_PATH));
    } catch {
      return null;
    }
    const theme = this.getTheme?.() || 'dark';

    iframeUrl.searchParams.set('file', entry.filePath);
    iframeUrl.searchParams.set('theme', theme);
    iframeUrl.searchParams.set('boot', entry.instanceId || '');
    if (!this._isFilePreviewEntry(entry)) {
      iframeUrl.searchParams.set('mode', 'preview');
    }

    const localUser = this.getLocalUser?.();
    if (localUser?.name) {
      iframeUrl.searchParams.set('userName', localUser.name);
    }
    if (localUser?.color) {
      iframeUrl.searchParams.set('userColor', localUser.color);
    }
    if (localUser?.colorLight) {
      iframeUrl.searchParams.set('userColorLight', localUser.colorLight);
    }
    if (localUser?.peerId) {
      iframeUrl.searchParams.set('userPeerId', localUser.peerId);
    }

    const hostSearchParams = new URLSearchParams(window.location.search);
    const serverOverride = resolveWsServerOverride();
    if (serverOverride) {
      iframeUrl.searchParams.set('server', serverOverride);
    }
    if (hostSearchParams.get('test') === '1') {
      iframeUrl.searchParams.set('test', '1');
    }
    if (hostSearchParams.has('syncTimeoutMs')) {
      iframeUrl.searchParams.set('syncTimeoutMs', hostSearchParams.get('syncTimeoutMs'));
    }
    if (hostSearchParams.get('excalidrawDebug') === '1') {
      iframeUrl.searchParams.set('excalidrawDebug', '1');
    }

    return iframeUrl;
  }

  _createEmbedContainer(entry) {
    const iframeUrl = this._buildIframeUrl(entry);
    if (!iframeUrl) {
      return null;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'excalidraw-embed diagram-preview-shell';
    wrapper.dataset.embedKey = entry.key;
    wrapper.dataset.file = entry.filePath;

    const header = document.createElement('div');
    header.className = 'excalidraw-embed-header diagram-preview-toolbar';

    const icon = document.createElement('span');
    icon.className = 'excalidraw-embed-icon';
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`;

    const label = document.createElement('span');
    label.className = 'excalidraw-embed-label';
    label.textContent = entry.label.replace(/\.excalidraw$/i, '');

    const openBtn = document.createElement('button');
    openBtn.type = 'button';
    openBtn.className = 'excalidraw-embed-btn ui-preview-action ui-preview-action--icon-only';
    openBtn.title = 'Edit in Excalidraw';
    openBtn.setAttribute('aria-label', 'Edit in Excalidraw');
    setDiagramActionButtonIcon(openBtn, 'edit');

    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'excalidraw-embed-btn ui-preview-action ui-preview-action--icon-only';
    maxBtn.title = 'Maximize diagram';
    maxBtn.setAttribute('aria-label', 'Maximize diagram');
    setDiagramActionButtonIcon(maxBtn, 'maximize');

    header.append(icon, label);
    if (!this._isFilePreviewEntry(entry)) {
      header.append(openBtn);
    }
    header.append(maxBtn);

    const iframe = document.createElement('iframe');
    iframe.className = 'excalidraw-embed-iframe';
    iframe.dataset.instanceId = String(++this.instanceCounter);
    entry.instanceId = iframe.dataset.instanceId;
    iframe.src = iframeUrl.toString();
    // The controller already lazy-hydrates embeds near the viewport, so the
    // iframe should start loading immediately once it has been mounted.
    iframe.setAttribute('loading', 'eager');
    iframe.title = `Excalidraw: ${entry.filePath}`;
    iframe.style.height = `${DEFAULT_HEIGHT}px`;

    const resizer = document.createElement('div');
    resizer.className = 'excalidraw-embed-resizer';
    resizer.title = 'Drag to resize';
    const resizerCleanup = this._setupResizer(resizer, iframe, () => {
      this._syncEntryLayout(entry);
      this._requestPreviewViewportFit(entry);
    });

    wrapper.append(header, iframe, resizer);

    let isMaximized = false;
    let restoreHeight = `${DEFAULT_HEIGHT}px`;

    const syncMaximizeButtonState = () => {
      setDiagramActionButtonIcon(maxBtn, isMaximized ? 'restore' : 'maximize');
      maxBtn.title = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      maxBtn.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    const exitMaximize = () => {
      if (!isMaximized) return;
      isMaximized = false;
      wrapper.classList.remove('is-maximized');
      syncMaximizeButtonState();
      document.body.classList.remove('excalidraw-maximized-open');
      this._restoreMaximizedEntryLayout(entry);
      iframe.style.height = restoreHeight;
      if (this.maximizedEmbed?.wrapper === wrapper) {
        this.maximizedEmbed = null;
      }
      this._syncEntryLayout(entry);
      this._requestPreviewViewportFit(entry);
    };

    const enterMaximize = () => {
      if (isMaximized) return;
      this._exitMaximizedEmbed();
      isMaximized = true;
      restoreHeight = iframe.style.height || `${DEFAULT_HEIGHT}px`;
      this._enterMaximizedEntryLayout(entry);
      wrapper.classList.add('is-maximized');
      syncMaximizeButtonState();
      document.body.classList.add('excalidraw-maximized-open');
      this.maximizedEmbed = { wrapper, exit: exitMaximize };
      this._syncEntryLayout(entry);
      this._requestPreviewViewportFit(entry);
    };

    maxBtn.addEventListener('click', () => {
      if (isMaximized) {
        exitMaximize();
      } else {
        enterMaximize();
      }
    });
    openBtn.addEventListener('click', (event) => {
      event.preventDefault();
      this._exitMaximizedEmbed();
      this.onOpenFile?.(entry.filePath);
    });

    syncMaximizeButtonState();

    return {
      header,
      iframe,
      instanceId: iframe.dataset.instanceId,
      labelElement: label,
      maxButton: maxBtn,
      openButton: openBtn,
      resizerCleanup,
      wrapper,
    };
  }

  _ensureWarmCacheRoot() {
    if (this.warmCacheRoot?.isConnected && this.warmCacheRoot.parentElement === document.body) {
      return this.warmCacheRoot;
    }

    let warmCacheRoot = document.body.querySelector('[data-excalidraw-warm-cache-root="true"]');
    if (!warmCacheRoot) {
      warmCacheRoot = document.createElement('div');
      warmCacheRoot.dataset.excalidrawWarmCacheRoot = 'true';
      warmCacheRoot.className = 'excalidraw-warm-cache-root';
      document.body.appendChild(warmCacheRoot);
    }

    this.warmCacheRoot = warmCacheRoot;
    return warmCacheRoot;
  }

  _setupResizer(resizer, iframe, onResizeEnd = null) {
    let startY = 0;
    let startHeight = 0;
    let isDragging = false;

    const onPointerMove = (event) => {
      const delta = event.clientY - startY;
      const newHeight = Math.min(Math.max(startHeight + delta, MIN_HEIGHT), MAX_HEIGHT);
      iframe.style.height = `${newHeight}px`;
      iframe.style.pointerEvents = 'none';
    };

    const stopDragging = () => {
      if (!isDragging) {
        return;
      }

      isDragging = false;
      iframe.style.pointerEvents = '';
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
    };

    const onPointerUp = () => {
      stopDragging();
      onResizeEnd?.();
    };

    const onPointerDown = (event) => {
      event.preventDefault();
      isDragging = true;
      startY = event.clientY;
      startHeight = iframe.offsetHeight;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    };

    resizer.addEventListener('pointerdown', onPointerDown);

    return () => {
      resizer.removeEventListener?.('pointerdown', onPointerDown);
      stopDragging();
    };
  }

  _ensureOverlayRoot() {
    if (this.overlayRoot?.isConnected && this.overlayRoot.parentElement === this.previewElement) {
      return this.overlayRoot;
    }

    let overlayRoot = this.previewElement?.querySelector('[data-excalidraw-overlay-root="true"]');
    if (!overlayRoot) {
      overlayRoot = document.createElement('div');
      overlayRoot.dataset.excalidrawOverlayRoot = 'true';
      overlayRoot.className = 'excalidraw-embed-overlay-root';
      this.previewElement?.appendChild(overlayRoot);
    }

    this.overlayRoot = overlayRoot;
    return overlayRoot;
  }

  _isFilePreviewEntry(entry) {
    return entry?.key === `${entry?.filePath}#file-preview`;
  }

  _getEntryMode(entry) {
    return this._isFilePreviewEntry(entry) ? 'edit' : 'preview';
  }

  _shouldInlineFilePreview(entry) {
    return this._isFilePreviewEntry(entry);
  }

  _entryNeedsHardReload(entry) {
    const desiredMode = this._getEntryMode(entry);
    return Boolean(
      entry?.wrapper
      && entry.iframe
      && (
        entry.isReady
          ? (
            entry.loadedFilePath !== entry.filePath
            || entry.loadedMode !== desiredMode
          )
          : (
            entry.bootFilePath !== entry.filePath
            || entry.bootMode !== desiredMode
          )
      )
    );
  }

  _setEntryLoadingState(entry, isLoading) {
    if (!entry?.wrapper) {
      return;
    }

    entry.wrapper.classList.toggle('is-loading', Boolean(isLoading));
    entry.wrapper.setAttribute('aria-busy', isLoading ? 'true' : 'false');
  }

  _forEachManagedEntry(callback) {
    const seen = new Set();
    this.embedEntries.forEach((entry) => {
      if (!entry || seen.has(entry)) {
        return;
      }

      seen.add(entry);
      callback(entry);
    });

    if (this.warmEntry && !seen.has(this.warmEntry)) {
      callback(this.warmEntry);
    }
  }

  _claimEntryFromRemovedEntries(removedEntries, predicate) {
    const removedIndex = removedEntries.findIndex((entry) => (
      (entry.wrapper || entry.iframe) && predicate(entry)
    ));
    if (removedIndex < 0) {
      return null;
    }

    const [reusedEntry] = removedEntries.splice(removedIndex, 1);
    return reusedEntry;
  }

  _claimReusableEntry(nextEntry, removedEntries) {
    const desiredMode = this._getEntryMode(nextEntry);
    const exactMatch = this._claimEntryFromRemovedEntries(removedEntries, (entry) => (
      entry.filePath === nextEntry.filePath
      && this._getEntryMode(entry) === desiredMode
    ));
    if (exactMatch) {
      return exactMatch;
    }

    if (this._isFilePreviewEntry(nextEntry)) {
      const promotedEntry = this._claimEntryFromRemovedEntries(removedEntries, (entry) => (
        entry.filePath === nextEntry.filePath
      ));
      if (promotedEntry) {
        return promotedEntry;
      }

      const warmEntry = this._claimWarmEntry();
      if (warmEntry) {
        return warmEntry;
      }

      return this._claimEntryFromRemovedEntries(removedEntries, (entry) => (
        this._isFilePreviewEntry(entry)
      ));
    }

    return null;
  }

  _claimWarmEntry() {
    const warmEntry = this.warmEntry;
    if (!warmEntry) {
      return null;
    }

    this.warmEntry = null;
    return warmEntry;
  }

  _captureWarmEntry(removedEntries) {
    const warmCandidate = this._claimEntryFromRemovedEntries(removedEntries, (entry) => (
      this._isFilePreviewEntry(entry)
    ));
    if (!warmCandidate) {
      return;
    }

    if (this.warmEntry && this.warmEntry !== warmCandidate) {
      this._destroyEntry(this.warmEntry);
    }

    this.warmEntry = warmCandidate;
    this._parkWarmEntry(warmCandidate);
  }

  _parkWarmEntry(entry) {
    if (!entry?.wrapper) {
      return;
    }

    if (this.maximizedEmbed?.wrapper === entry.wrapper) {
      this._exitMaximizedEmbed();
    }

    const warmCacheRoot = this._ensureWarmCacheRoot();
    this._setEntryLoadingState(entry, false);
    entry.isParked = true;
    entry.isReady = false;
    entry.bootFilePath = null;
    entry.bootMode = null;
    entry.loadedFilePath = null;
    entry.loadedMode = null;
    entry.pendingElementFocus = null;
    entry.placeholder = null;
    if (entry.wrapper.parentElement !== warmCacheRoot) {
      warmCacheRoot.appendChild(entry.wrapper);
    }
    this._postMessageToEntry(entry, {
      source: 'collabmd-host',
      type: 'park-room',
    });
  }

  _reloadEntry(entry) {
    if (!entry?.iframe) {
      return;
    }

    this._clearEntryBootTimeout(entry);
    this._setEntryLoadingState(entry, true);
    entry.isReady = false;
    entry.bootAttempts = (entry.bootAttempts ?? 0) + 1;
    entry.bootFilePath = entry.filePath;
    entry.bootMode = this._getEntryMode(entry);
    entry.loadedFilePath = null;
    entry.loadedMode = null;
    const iframeUrl = this._buildIframeUrl(entry);
    if (!iframeUrl) {
      return;
    }
    entry.iframe.src = iframeUrl.toString();
    this._armEntryBootTimeout(entry);
  }

  _resetPlaceholderLayout(entry) {
    if (!entry?.placeholder?.isConnected || this._shouldInlineFilePreview(entry)) {
      return;
    }

    entry.placeholder.classList.remove('is-hydrated');
    entry.placeholder.removeAttribute('data-embed-hydrated');
    entry.placeholder.style.height = '';
    entry.placeholder.style.pointerEvents = '';
  }

  _enterMaximizedEntryLayout(entry) {
    if (!entry?.wrapper) {
      return;
    }

    if (this._shouldInlineFilePreview(entry) && entry.wrapper.parentElement && !entry.maximizeSpacer) {
      const spacer = document.createElement('div');
      spacer.className = 'excalidraw-maximize-spacer';
      spacer.style.height = `${Math.ceil(entry.wrapper.getBoundingClientRect().height)}px`;
      entry.maximizeSpacer = spacer;
      entry.wrapper.parentElement.insertBefore(spacer, entry.wrapper);
    }

    entry.wrapper.dataset.excalidrawMaximized = 'true';
    entry.wrapper.style.position = '';
    entry.wrapper.style.top = '';
    entry.wrapper.style.left = '';
    entry.wrapper.style.width = 'auto';
    entry.wrapper.style.height = 'auto';
    entry.wrapper.style.minHeight = '0';
    entry.wrapper.style.margin = '0';
    this.overlayRoot?.classList.add('has-maximized-entry');
  }

  _restoreMaximizedEntryLayout(entry) {
    if (!entry?.wrapper) {
      return;
    }

    const { maximizeSpacer } = entry;
    delete entry.wrapper.dataset.excalidrawMaximized;
    entry.wrapper.style.width = '';
    entry.wrapper.style.height = '';
    entry.wrapper.style.minHeight = '';

    if (maximizeSpacer?.parentElement) {
      maximizeSpacer.remove();
    }

    entry.maximizeSpacer = null;
    this.overlayRoot?.classList.remove('has-maximized-entry');
  }

  _syncEntryLayout(entry) {
    if (!entry?.wrapper || this._shouldInlineFilePreview(entry)) {
      return;
    }

    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : findEmbedPlaceholder(this.previewElement, entry.key);

    if (!placeholder) {
      return;
    }

    entry.placeholder = placeholder;
    placeholder.classList.add('is-hydrated');
    placeholder.dataset.embedHydrated = 'true';
    placeholder.style.pointerEvents = 'none';
    if (this._isFilePreviewEntry(entry) && placeholder.childElementCount > 0) {
      placeholder.replaceChildren();
    }

    const isMaximized = entry.wrapper.classList.contains('is-maximized');
    const headerHeight = entry.wrapper.querySelector('.excalidraw-embed-header')?.offsetHeight || 0;
    const iframeHeight = entry.iframe?.offsetHeight
      || Number.parseFloat(entry.iframe?.style.height || '')
      || DEFAULT_HEIGHT;
    const resizerHeight = isMaximized
      ? 0
      : (entry.wrapper.querySelector('.excalidraw-embed-resizer')?.offsetHeight || 0);
    const inlineHeight = Math.ceil(headerHeight + iframeHeight + resizerHeight);

    if (!isMaximized) {
      entry.inlineHeightPx = inlineHeight;
    }

    placeholder.style.height = `${Math.ceil(entry.inlineHeightPx || inlineHeight || DEFAULT_HEIGHT)}px`;
    entry.wrapper.style.pointerEvents = 'auto';

    if (isMaximized) {
      entry.wrapper.style.position = '';
      entry.wrapper.style.top = '';
      entry.wrapper.style.left = '';
      entry.wrapper.style.width = 'auto';
      entry.wrapper.style.height = 'auto';
      entry.wrapper.style.minHeight = '0';
      entry.wrapper.style.margin = '0';
      return;
    }

    entry.wrapper.style.position = 'absolute';
    entry.wrapper.style.top = `${placeholder.offsetTop}px`;
    entry.wrapper.style.left = `${placeholder.offsetLeft}px`;
    entry.wrapper.style.width = `${placeholder.offsetWidth}px`;
    entry.wrapper.style.height = '';
    entry.wrapper.style.minHeight = '';
    entry.wrapper.style.margin = '0';
  }

  syncLayout() {
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper && !this._shouldInlineFilePreview(entry)) {
        this._syncEntryLayout(entry);
      }
    });
  }

  _onPreviewClick(event) {
    const loadButton = event.target.closest('.excalidraw-embed-placeholder-btn');
    if (!loadButton) {
      return;
    }

    event.preventDefault();
    const entry = this.embedEntries.get(loadButton.dataset.embedKey);
    if (entry) {
      void this._hydrateEntry(entry);
    }
  }

  _onMessage(event) {
    if (event.origin !== window.location.origin) return;
    const msg = event.data;
    if (!msg || msg.source !== 'excalidraw-editor') return;

    const entry = this._findEntryByContentWindow(event.source);
    if (!entry) {
      return;
    }

    if (msg.type === 'ready') {
      if (entry.isParked) {
        return;
      }

      entry.isReady = true;
      this._clearEntryBootTimeout(entry);
      entry.loadedFilePath = entry.bootFilePath || entry.filePath;
      entry.loadedMode = entry.bootMode || this._getEntryMode(entry);
      this._setEntryLoadingState(entry, false);
      this._syncEntryUser(entry);
      this._postMessageToEntry(entry, {
        source: 'collabmd-host',
        type: 'set-theme',
        theme: this.getTheme?.() || 'dark',
      });
      this._syncEntryFollowState(entry);
      this._postPendingCommentThread?.(entry);
      this._postPendingElement?.(entry);
      if (this._entryNeedsHardReload(entry)) {
        void this._hydrateEntry(entry);
      }
      return;
    }

    if (msg.type === 'request-toggle-quick-switcher') {
      this.onToggleQuickSwitcher?.();
      return;
    }

    if (msg.type === 'stop-following') {
      this.onStopFollowing?.();
      return;
    }

    if (msg.type === 'open-element-link') {
      const target = parseExcalidrawElementLink(msg.href, {
        appPath: resolveAppPath('/'),
        origin: window.location.origin,
      });
      if (target) {
        this.onOpenElement?.(target);
      }
      return;
    }

    if (msg.type === 'error') {
      if (entry.isParked) {
        return;
      }

      entry.isReady = false;
      void this._handleEntryBootTimeout(entry);
      return;
    }

    if (msg.type === 'disconnect-ready') {
      const request = this.pendingDisconnectRequests.get(msg.requestId);
      if (request?.entry === entry) {
        request.resolve(true);
      }
      return;
    }

    if (
      msg.type === 'agent-writes-flushed'
      || msg.type === 'agent-revision-painted'
      || msg.type === 'agent-revision-not-painted'
    ) {
      const request = this.pendingAgentBridgeRequests.get(msg.requestId);
      if (request?.entry === entry) {
        request.resolve({
          ...(msg.revision ? { revision: msg.revision } : {}),
          status: msg.type === 'agent-writes-flushed'
            ? 'flushed'
            : (msg.type === 'agent-revision-painted' ? 'painted' : 'not-painted'),
        });
      }
      return;
    }

    if (msg.type === 'disconnect-blocked') {
      entry.authorityState = msg.state || 'reconnecting-readonly';
      this.toastController?.show?.('Waiting for the diagram to reconnect before leaving');
      return;
    }

    if (msg.type === 'excalidraw-authority-state') {
      entry.authorityState = msg.state || 'closed';
      entry.hasPendingWrites = Boolean(msg.hasPendingWrites);
      return;
    }

    if (msg.type === 'park-blocked') {
      entry.authorityState = msg.state || 'reconnecting-readonly';
    }
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this._exitMaximizedEmbed();
    }
  }

  _exitMaximizedEmbed() {
    if (this.maximizedEmbed?.exit) {
      this.maximizedEmbed.exit();
    }
    this.maximizedEmbed = null;
    document.body.classList.remove('excalidraw-maximized-open');
  }

  _postMessageToEntry(entry, payload) {
    entry?.iframe?.contentWindow?.postMessage(payload, window.location.origin);
  }

  _postPendingCommentThread(entry) {
    if (!entry?.isReady || !entry.pendingCommentThreadId) {
      return;
    }

    this._postMessageToEntry(entry, {
      source: 'collabmd-host',
      threadId: entry.pendingCommentThreadId,
      type: 'open-comment-thread',
    });
    entry.pendingCommentThreadId = null;
  }

  _postPendingElement(entry) {
    if (!entry?.isReady || !entry.pendingElementFocus) {
      return;
    }

    this._postMessageToEntry(entry, {
      elementId: entry.pendingElementFocus.elementId,
      elementType: entry.pendingElementFocus.elementType,
      source: 'collabmd-host',
      type: 'focus-element',
    });
    entry.pendingElementFocus = null;
  }

  _requestPreviewViewportFit(entry) {
    if (this._isFilePreviewEntry(entry)) {
      return;
    }

    this._postMessageToEntry(entry, {
      source: 'collabmd-host',
      type: 'fit-preview-viewport',
    });
  }

  _syncEntryUser(entry, overrideUser = null) {
    const localUser = overrideUser || this.getLocalUser?.();
    if (!localUser) {
      return;
    }

    this._postMessageToEntry(entry, {
      source: 'collabmd-host',
      type: 'set-user',
      user: {
        color: localUser.color || '',
        colorLight: localUser.colorLight || '',
        name: localUser.name || '',
        peerId: localUser.peerId || '',
      },
    });
  }

  _syncEntryFollowState(entry) {
    if (!entry?.isReady || entry.followedPeerId === undefined) {
      return;
    }

    this._postMessageToEntry(entry, {
      source: 'collabmd-host',
      type: 'follow-user',
      peerId: entry.followedPeerId,
    });
  }
}
