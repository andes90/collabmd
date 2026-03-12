import { reconcileEmbedEntries } from './excalidraw-embed-reconciler.js';
import { resolveAppUrl } from '../domain/runtime-paths.js';

const DEFAULT_HEIGHT = 420;
const HYDRATE_TIMEOUT_MS = 500;
const IFRAME_BOOT_TIMEOUT_MS = 15000;
const MAX_HEIGHT = 800;
const MAX_IFRAME_BOOT_ATTEMPTS = 3;
const MIN_HEIGHT = 200;
const EDITOR_IFRAME_PATH = '/excalidraw-editor.html';

function requestIdleRender(callback, timeout) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, 1);
}

function cancelIdleRender(id) {
  if (id === null) {
    return;
  }

  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(id);
    return;
  }

  window.clearTimeout(id);
}

function isNearViewport(element, root, marginPx) {
  if (!element || !root) {
    return false;
  }

  const rootRect = root.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();

  return (
    elementRect.bottom >= (rootRect.top - marginPx)
    && elementRect.top <= (rootRect.bottom + marginPx)
  );
}

export class ExcalidrawEmbedController {
  constructor({ getTheme, getLocalUser, previewContainer, previewElement, toastController }) {
    this.getTheme = getTheme;
    this.getLocalUser = getLocalUser;
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
    this.maximizedRoot = null;
    this.placeholderObserver = null;

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
      entry.wrapper?.remove();
      entry.placeholder = null;
    });
    this.embedEntries.clear();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
    this.maximizedRoot?.remove();
    this.maximizedRoot = null;
  }

  async setFollowedUser(filePath, peerId = null) {
    if (!filePath) {
      return false;
    }

    const entry = this._findEntryByFilePath(filePath);
    if (!entry) {
      return false;
    }

    if (!entry.wrapper) {
      await this._hydrateEntry(entry);
    }

    this._postMessageToEntry(entry, {
      source: 'collabmd-host',
      type: 'follow-user',
      peerId: peerId || null,
    });
    return true;
  }

  detachForCommit() {
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.hydrationInProgress = false;
    if (this.overlayRoot) {
      this.overlayRoot.hidden = true;
    }
    if (this.maximizedRoot) {
      this.maximizedRoot.hidden = true;
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
    this._adoptReusableEntries(nextEntries, removedEntries);
    removedEntries.forEach((entry) => this._destroyEntry(entry));
    this.embedEntries = nextEntries;

    this._ensurePlaceholderObserver();

    this.embedEntries.forEach((entry) => {
      entry.queued = false;
      if (entry.wrapper) {
        this._updateEmbedLabel(entry);
        this._attachWrapper(entry);
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
    this.embedEntries.forEach((entry) => {
      this._postMessageToEntry(entry, {
        source: 'collabmd-host',
        type: 'set-theme',
        theme,
      });
    });
  }

  updateLocalUser(user) {
    this.embedEntries.forEach((entry) => {
      this._syncEntryUser(entry, user);
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

    if (!entry.wrapper) {
      const mount = this._createEmbedContainer(entry);
      entry.wrapper = mount.wrapper;
      entry.iframe = mount.iframe;
      entry.labelElement = mount.labelElement;
      entry.instanceId = mount.instanceId;
      entry.bootAttempts = (entry.bootAttempts ?? 0) + 1;
      this._armEntryBootTimeout(entry);
    }

    this._updateEmbedLabel(entry);
    this._attachWrapper(entry);
  }

  _attachWrapper(entry) {
    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.previewElement?.querySelector(`.excalidraw-embed-placeholder[data-embed-key="${entry.key}"]`);

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

      const removedIndex = removedEntries.findIndex((entry) => (
        entry.filePath === nextEntry.filePath
        && (entry.wrapper || entry.iframe)
      ));
      if (removedIndex < 0) {
        return;
      }

      const [reusedEntry] = removedEntries.splice(removedIndex, 1);
      reusedEntry.filePath = nextEntry.filePath;
      reusedEntry.key = nextEntry.key;
      reusedEntry.label = nextEntry.label;
      reusedEntry.placeholder = nextEntry.placeholder;
      reusedEntry.queued = false;
      reusedEntry.reusedFromEmbed = this._isFilePreviewEntry(nextEntry);
      nextEntries.set(key, reusedEntry);
    });
  }

  _destroyEntry(entry) {
    if (this.maximizedEmbed?.wrapper === entry.wrapper) {
      this._exitMaximizedEmbed();
    }

    this._clearEntryBootTimeout(entry);
    this._resetPlaceholderLayout(entry);
    entry.wrapper?.remove();
    entry.placeholder = null;
  }

  _armEntryBootTimeout(entry) {
    this._clearEntryBootTimeout(entry);
    entry.bootTimerId = window.setTimeout(() => {
      void this._handleEntryBootTimeout(entry);
    }, IFRAME_BOOT_TIMEOUT_MS);
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

    if (this.maximizedEmbed?.wrapper === entry.wrapper) {
      this._exitMaximizedEmbed();
    }

    entry.wrapper?.remove();
    entry.wrapper = null;
    entry.iframe = null;
    entry.labelElement = null;
    entry.instanceId = null;

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
    }

    if (entry.iframe) {
      entry.iframe.title = `Excalidraw: ${entry.filePath}`;
    }
  }

  _buildIframeUrl(entry) {
    const iframeUrl = new URL(resolveAppUrl(EDITOR_IFRAME_PATH));
    const theme = this.getTheme?.() || 'dark';

    iframeUrl.searchParams.set('file', entry.filePath);
    iframeUrl.searchParams.set('theme', theme);
    iframeUrl.searchParams.set('boot', entry.instanceId || '');

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
    const serverOverride = hostSearchParams.get('server');
    if (serverOverride) {
      iframeUrl.searchParams.set('server', serverOverride);
    }
    if (hostSearchParams.get('test') === '1') {
      iframeUrl.searchParams.set('test', '1');
    }
    if (hostSearchParams.has('syncTimeoutMs')) {
      iframeUrl.searchParams.set('syncTimeoutMs', hostSearchParams.get('syncTimeoutMs'));
    }

    return iframeUrl;
  }

  _createEmbedContainer(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = 'excalidraw-embed';
    wrapper.dataset.embedKey = entry.key;
    wrapper.dataset.file = entry.filePath;

    const header = document.createElement('div');
    header.className = 'excalidraw-embed-header';

    const icon = document.createElement('span');
    icon.className = 'excalidraw-embed-icon';
    icon.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19l7-7 3 3-7 7-3-3z"/><path d="M18 13l-1.5-7.5L2 2l3.5 14.5L13 18l5-5z"/><path d="M2 2l7.586 7.586"/><circle cx="11" cy="11" r="2"/></svg>`;

    const label = document.createElement('span');
    label.className = 'excalidraw-embed-label';
    label.textContent = entry.label.replace(/\.excalidraw$/i, '');

    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'excalidraw-embed-btn';
    maxBtn.title = 'Maximize diagram';
    maxBtn.setAttribute('aria-label', 'Maximize diagram');
    maxBtn.textContent = 'Max';

    header.append(icon, label, maxBtn);

    const iframe = document.createElement('iframe');
    iframe.className = 'excalidraw-embed-iframe';
    iframe.dataset.instanceId = String(++this.instanceCounter);
    entry.instanceId = iframe.dataset.instanceId;
    iframe.src = this._buildIframeUrl(entry).toString();
    // The controller already lazy-hydrates embeds near the viewport, so the
    // iframe should start loading immediately once it has been mounted.
    iframe.setAttribute('loading', 'eager');
    iframe.title = `Excalidraw: ${entry.filePath}`;
    iframe.style.height = `${DEFAULT_HEIGHT}px`;

    const resizer = document.createElement('div');
    resizer.className = 'excalidraw-embed-resizer';
    resizer.title = 'Drag to resize';
    this._setupResizer(resizer, iframe, () => this._syncEntryLayout(entry));

    wrapper.append(header, iframe, resizer);

    let isMaximized = false;
    let restoreHeight = `${DEFAULT_HEIGHT}px`;

    const syncMaximizeButtonState = () => {
      maxBtn.textContent = isMaximized ? 'Restore' : 'Max';
      maxBtn.title = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      maxBtn.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    const exitMaximize = () => {
      if (!isMaximized) return;
      isMaximized = false;
      wrapper.classList.remove('is-maximized');
      syncMaximizeButtonState();
      document.body.classList.remove('excalidraw-maximized-open');
      this._restoreWrapperMount(entry);
      iframe.style.height = restoreHeight;
      if (this.maximizedEmbed?.wrapper === wrapper) {
        this.maximizedEmbed = null;
      }
      this._syncEntryLayout(entry);
    };

    const enterMaximize = () => {
      if (isMaximized) return;
      this._exitMaximizedEmbed();
      isMaximized = true;
      restoreHeight = iframe.style.height || `${DEFAULT_HEIGHT}px`;
      this._mountWrapperInMaximizedRoot(entry);
      wrapper.classList.add('is-maximized');
      syncMaximizeButtonState();
      document.body.classList.add('excalidraw-maximized-open');
      this.maximizedEmbed = { wrapper, exit: exitMaximize };
      this._syncEntryLayout(entry);
    };

    maxBtn.addEventListener('click', () => {
      if (isMaximized) {
        exitMaximize();
      } else {
        enterMaximize();
      }
    });

    syncMaximizeButtonState();

    return {
      iframe,
      instanceId: iframe.dataset.instanceId,
      labelElement: label,
      wrapper,
    };
  }

  _setupResizer(resizer, iframe, onResizeEnd = null) {
    let startY = 0;
    let startHeight = 0;

    const onPointerMove = (event) => {
      const delta = event.clientY - startY;
      const newHeight = Math.min(Math.max(startHeight + delta, MIN_HEIGHT), MAX_HEIGHT);
      iframe.style.height = `${newHeight}px`;
      iframe.style.pointerEvents = 'none';
    };

    const onPointerUp = () => {
      iframe.style.pointerEvents = '';
      document.removeEventListener('pointermove', onPointerMove);
      document.removeEventListener('pointerup', onPointerUp);
      onResizeEnd?.();
    };

    resizer.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      startY = event.clientY;
      startHeight = iframe.offsetHeight;
      document.addEventListener('pointermove', onPointerMove);
      document.addEventListener('pointerup', onPointerUp);
    });
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

  _ensureMaximizedRoot() {
    if (this.maximizedRoot?.isConnected && this.maximizedRoot.parentElement === document.body) {
      return this.maximizedRoot;
    }

    let maximizedRoot = document.body.querySelector('[data-excalidraw-maximized-root="true"]');
    if (!maximizedRoot) {
      maximizedRoot = document.createElement('div');
      maximizedRoot.dataset.excalidrawMaximizedRoot = 'true';
      maximizedRoot.className = 'excalidraw-maximized-root';
      document.body.appendChild(maximizedRoot);
    }

    this.maximizedRoot = maximizedRoot;
    return maximizedRoot;
  }

  _isFilePreviewEntry(entry) {
    return entry?.key === `${entry?.filePath}#file-preview`;
  }

  _shouldInlineFilePreview(entry) {
    return this._isFilePreviewEntry(entry) && !entry?.reusedFromEmbed;
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

  _mountWrapperInMaximizedRoot(entry) {
    if (!entry?.wrapper) {
      return;
    }

    const maximizedRoot = this._ensureMaximizedRoot();
    maximizedRoot.hidden = false;
    entry.restoreParent = entry.wrapper.parentElement || null;
    entry.restoreNextSibling = entry.wrapper.nextSibling || null;
    entry.wrapper.style.position = '';
    entry.wrapper.style.top = '';
    entry.wrapper.style.left = '';
    entry.wrapper.style.width = '';
    entry.wrapper.style.margin = '';
    if (entry.wrapper.parentElement !== maximizedRoot) {
      maximizedRoot.appendChild(entry.wrapper);
    }
  }

  _restoreWrapperMount(entry) {
    if (!entry?.wrapper) {
      return;
    }

    if (this._shouldInlineFilePreview(entry)) {
      const { restoreParent, restoreNextSibling } = entry;
      if (restoreParent?.isConnected) {
        if (restoreNextSibling?.parentElement === restoreParent) {
          restoreParent.insertBefore(entry.wrapper, restoreNextSibling);
        } else {
          restoreParent.appendChild(entry.wrapper);
        }
      }
    } else {
      const overlayRoot = this._ensureOverlayRoot();
      overlayRoot.hidden = false;
      if (entry.wrapper.parentElement !== overlayRoot) {
        overlayRoot.appendChild(entry.wrapper);
      }
    }

    entry.restoreParent = null;
    entry.restoreNextSibling = null;

    if (this.maximizedRoot && this.maximizedRoot.childElementCount === 0) {
      this.maximizedRoot.hidden = true;
    }
  }

  _syncEntryLayout(entry) {
    if (!entry?.wrapper || this._shouldInlineFilePreview(entry)) {
      return;
    }

    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.previewElement?.querySelector(`.excalidraw-embed-placeholder[data-embed-key="${entry.key}"]`);

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
      entry.wrapper.style.width = '';
      entry.wrapper.style.margin = '';
      return;
    }

    entry.wrapper.style.position = 'absolute';
    entry.wrapper.style.top = `${placeholder.offsetTop}px`;
    entry.wrapper.style.left = `${placeholder.offsetLeft}px`;
    entry.wrapper.style.width = `${placeholder.offsetWidth}px`;
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
      this._clearEntryBootTimeout(entry);
      this._syncEntryUser(entry);
      this._postMessageToEntry(entry, {
        source: 'collabmd-host',
        type: 'set-theme',
        theme: this.getTheme?.() || 'dark',
      });
      return;
    }

    if (msg.type === 'error') {
      void this._handleEntryBootTimeout(entry);
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
}
