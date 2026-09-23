import { createDrawioLeaseRoomName } from '../../domain/drawio-room.js';
import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import { getActiveVaultId, resolveAppUrl } from '../domain/runtime-paths.js';
import { renderDrawioViewer } from './drawio-viewer.js';
import {
  cancelIdleRender,
  isNearViewport,
  requestIdleRender,
} from '../browser-utils.js';

const HYDRATE_VIEWPORT_MARGIN_PX = 360;

export class DrawioEmbedController {
  constructor({
    getLocalUser,
    getTheme,
    onOpenFile = null,
    onOpenTextFile = null,
    onToggleQuickSwitcher = null,
    previewContainer,
    previewElement,
    toastController,
    vaultApiClient,
  }) {
    this.getLocalUser = getLocalUser;
    this.getTheme = getTheme;
    this.onOpenFile = onOpenFile;
    this.onOpenTextFile = onOpenTextFile;
    this.onToggleQuickSwitcher = onToggleQuickSwitcher;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.vaultApiClient = vaultApiClient;
    this.embedEntries = new Map();
    this.hydrationQueue = [];
    this.hydrationIdleId = null;
    this.hydrationPaused = false;
    this.instanceCounter = 0;
    this.maximizedEntry = null;
    this.overlayRoot = null;
    this.placeholderObserver = null;

    this._onMessage = this._onMessage.bind(this);
    this._onKeyDown = this._onKeyDown.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);

    this.listenerController = new AbortController();
    const { signal } = this.listenerController;
    window.addEventListener('message', this._onMessage, { signal });
    window.addEventListener('keydown', this._onKeyDown, { signal });
    this.previewElement?.addEventListener('click', this._onPreviewClick, { signal });
  }

  destroy() {
    this.listenerController?.abort();
    this.listenerController = null;
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this._exitMaximizedEntry();
    this.embedEntries.forEach((entry) => entry.wrapper?.remove());
    this.embedEntries.clear();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
  }

  detachForCommit() {
    this._disconnectPlaceholderObserver();
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this._exitMaximizedEntry();
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
    if (!this.hydrationPaused) {
      this.hydrateVisibleEmbeds();
    }
  }

  reconcileEmbeds(previewElement) {
    this._exitMaximizedEntry();

    const descriptors = Array.from(previewElement.querySelectorAll('.drawio-embed-placeholder[data-drawio-key]')).map((placeholder) => ({
      filePath: placeholder.dataset.drawioTarget || '',
      key: placeholder.dataset.drawioKey || '',
      label: placeholder.dataset.drawioLabel || placeholder.dataset.drawioTarget || '',
      mode: placeholder.dataset.drawioMode === 'edit' ? 'edit' : 'view',
      placeholder,
    }));

    const nextEntries = new Map();
    descriptors.forEach((descriptor) => {
      const existingEntry = this.embedEntries.get(descriptor.key) || null;
      const nextEntry = existingEntry && this.entryMatchesDescriptor(existingEntry, descriptor)
        ? existingEntry
        : this.createEntry(descriptor);

      if (existingEntry && existingEntry !== nextEntry) {
        this.destroyEntry(existingEntry);
      }

      nextEntry.filePath = descriptor.filePath;
      nextEntry.key = descriptor.key;
      nextEntry.label = descriptor.label;
      nextEntry.mode = descriptor.mode;
      nextEntry.placeholder = descriptor.placeholder;
      nextEntries.set(descriptor.key, nextEntry);
    });

    this.embedEntries.forEach((entry, key) => {
      if (!nextEntries.has(key)) {
        this.destroyEntry(entry);
      }
    });

    this.embedEntries = nextEntries;

    this._disconnectPlaceholderObserver();
    this._ensurePlaceholderObserver();

    this.embedEntries.forEach((entry) => {
      if (entry.wrapper) {
        this.attachWrapper(entry);
      } else {
        entry.queued = false;
      }
    });

    if (!this.hydrationPaused) {
      this.hydrateVisibleEmbeds();
    }

    this.syncLayout();
  }

  createEntry(descriptor) {
    return {
      ...descriptor,
      iframe: null,
      imageElement: null,
      inlineHeightPx: null,
      instanceId: '',
      queued: false,
      viewerElement: null,
      wrapper: null,
    };
  }

  entryMatchesDescriptor(entry, descriptor) {
    return Boolean(
      entry
        && entry.filePath === descriptor.filePath
        && entry.mode === descriptor.mode
    );
  }

  hydrateVisibleEmbeds() {
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper || !entry.placeholder?.isConnected) {
        return;
      }

      if (entry.mode === 'edit') {
        this.enqueueHydration(entry);
        return;
      }

      if (typeof IntersectionObserver === 'undefined') {
        if (isNearViewport(entry.placeholder, this.previewContainer, HYDRATE_VIEWPORT_MARGIN_PX)) {
          this.enqueueHydration(entry);
        }
        return;
      }

      this.placeholderObserver?.observe(entry.placeholder);
    });
  }

  _ensurePlaceholderObserver() {
    if (!this.previewContainer || typeof IntersectionObserver === 'undefined') {
      return;
    }

    this.placeholderObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        const embedEntry = this.embedEntries.get(entry.target.dataset.drawioKey);
        if (embedEntry && !embedEntry.wrapper) {
          this.enqueueHydration(embedEntry);
        }
      });
    }, {
      root: this.previewContainer,
      rootMargin: `${HYDRATE_VIEWPORT_MARGIN_PX}px 0px`,
    });
  }

  _disconnectPlaceholderObserver() {
    if (!this.placeholderObserver) {
      return;
    }

    this.placeholderObserver.disconnect();
    this.placeholderObserver = null;
  }

  enqueueHydration(entry) {
    if (entry.queued) {
      return;
    }

    entry.queued = true;
    this.hydrationQueue.push(entry);
    if (this.hydrationIdleId !== null) {
      return;
    }

    this.hydrationIdleId = requestIdleRender(() => {
      this.hydrationIdleId = null;
      const nextQueue = this.hydrationQueue.splice(0);
      nextQueue.forEach((queuedEntry) => {
        queuedEntry.queued = false;
        this.hydrateEntry(queuedEntry);
      });
    }, 200);
  }

  hydrateEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    if (entry.mode === 'view') {
      void this.hydrateViewerEntry(entry);
      return;
    }

    this.hydrateIframeEntry(entry);
  }

  hydrateIframeEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = `drawio-embed diagram-preview-shell${entry.mode === 'edit' ? ' is-direct-file' : ''}`;
    wrapper.dataset.file = entry.filePath;
    wrapper.dataset.drawioKey = entry.key;

    const header = document.createElement('div');
    header.className = 'drawio-embed-header diagram-preview-toolbar';

    const icon = document.createElement('span');
    icon.className = 'drawio-embed-icon';
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';

    const label = document.createElement('span');
    label.className = 'drawio-embed-label';
    label.textContent = entry.label.replace(/\.drawio$/i, '');
    header.append(icon, label);

    if (entry.mode !== 'edit') {
      header.appendChild(this.createOpenButton(entry));
    }

    header.appendChild(this.createMaximizeButton(entry, wrapper));

    const iframe = document.createElement('iframe');
    iframe.className = 'drawio-embed-iframe';
    iframe.loading = 'lazy';
    iframe.referrerPolicy = 'strict-origin-when-cross-origin';
    entry.instanceId = `drawio-${++this.instanceCounter}`;
    iframe.dataset.instanceId = entry.instanceId;
    iframe.src = this.buildIframeUrl(entry);

    wrapper.append(header, iframe);
    entry.iframe = iframe;
    entry.wrapper = wrapper;
    this.attachWrapper(entry);
  }

  async hydrateViewerEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'drawio-embed diagram-preview-shell is-static-preview';
    wrapper.dataset.file = entry.filePath;
    wrapper.dataset.drawioKey = entry.key;

    const header = document.createElement('div');
    header.className = 'drawio-embed-header diagram-preview-toolbar';

    const icon = document.createElement('span');
    icon.className = 'drawio-embed-icon';
    icon.innerHTML = '<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="7" height="6" rx="1"/><rect x="14" y="4" width="7" height="6" rx="1"/><rect x="8.5" y="14" width="7" height="6" rx="1"/><path d="M10 7h4"/><path d="M17.5 10v2.5"/><path d="M6.5 10v2.5"/><path d="M6.5 12.5h11"/></svg>';

    const label = document.createElement('span');
    label.className = 'drawio-embed-label';
    label.textContent = entry.label.replace(/\.drawio$/i, '');
    header.append(icon, label);

    header.append(this.createOpenButton(entry), this.createMaximizeButton(entry, wrapper));

    const viewerShell = document.createElement('div');
    viewerShell.className = 'drawio-viewer-shell';
    viewerShell.dataset.filePath = entry.filePath;

    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Rendering draw.io preview…';
    viewerShell.appendChild(loadingShell);

    wrapper.append(header, viewerShell);
    entry.iframe = null;
    entry.wrapper = wrapper;
    entry.viewerElement = viewerShell;
    this.attachWrapper(entry);

    try {
      await this.renderViewerEntry(entry);
      this.syncEntryLayout(entry);
    } catch (error) {
      this.renderViewerFallback(entry, error instanceof Error ? error.message : 'Failed to render draw.io preview');
      this.syncEntryLayout(entry);
    }
  }

  async renderViewerEntry(entry) {
    const { content } = await this.vaultApiClient.readFile(entry.filePath);

    if (!entry.wrapper?.isConnected || !entry.viewerElement?.isConnected) {
      return;
    }

    const theme = this.getTheme?.() === 'light' ? 'light' : 'dark';
    const viewerHost = entry.wrapper.querySelector('.drawio-viewer-shell') ?? entry.viewerElement;
    entry.viewerElement = await renderDrawioViewer(viewerHost, {
      ariaLabel: `Open ${entry.label.replace(/\.drawio$/i, '')}`,
      className: 'mxgraph drawio-viewer-frame',
      onActivate: () => this.onOpenFile?.(entry.filePath),
      source: String(content ?? ''),
      theme,
    });
  }

  buildIframeUrl(entry) {
    const url = new URL(resolveAppUrl('/drawio-editor.html'));
    const localUser = this.getLocalUser?.() ?? {};
    const vaultId = getActiveVaultId();
    if (vaultId) url.searchParams.set('vault', vaultId);
    url.searchParams.set('file', entry.filePath);
    url.searchParams.set('hostMode', entry.mode === 'edit' ? 'file-preview' : 'embed');
    url.searchParams.set('instanceId', entry.instanceId);
    url.searchParams.set('mode', entry.mode === 'edit' ? 'edit' : 'view');
    url.searchParams.set('theme', this.getTheme?.() === 'light' ? 'light' : 'dark');

    if (localUser.name) {
      url.searchParams.set('userName', localUser.name);
    }
    if (localUser.peerId) {
      url.searchParams.set('peerId', localUser.peerId);
    }

    if (entry.mode === 'edit') {
      url.searchParams.set('leaseRoom', createDrawioLeaseRoomName(entry.filePath));
    }

    return url.toString();
  }

  updateTheme(theme) {
    this.embedEntries.forEach((entry) => {
      if (entry.iframe?.contentWindow) {
        entry.iframe.contentWindow.postMessage({
          source: 'collabmd-host',
          theme,
          type: 'set-theme',
        }, window.location.origin);
      }

      if (entry.mode === 'view' && entry.wrapper?.isConnected && entry.viewerElement?.isConnected) {
        void this.renderViewerEntry(entry).catch((error) => {
          this.renderViewerFallback(entry, error instanceof Error ? error.message : 'Failed to render draw.io preview');
        });
      }
    });
  }

  updateLocalUser() {}

  syncLayout() {
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper && !this.shouldInlineEntry(entry)) {
        this.syncEntryLayout(entry);
      }
    });
  }

  attachWrapper(entry) {
    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.findPlaceholder(entry);

    if (!placeholder) {
      return;
    }

    entry.placeholder = placeholder;
    this.syncMountedEntryMetadata(entry);

    if (this.shouldInlineEntry(entry)) {
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

    const overlayRoot = this.ensureOverlayRoot();
    overlayRoot.hidden = false;
    if (entry.wrapper?.parentElement !== overlayRoot) {
      overlayRoot.appendChild(entry.wrapper);
    }

    this.syncEntryLayout(entry);
  }

  destroyEntry(entry) {
    if (this.maximizedEntry?.key === entry?.key) {
      this._exitMaximizedEntry();
    }

    this.resetPlaceholderLayout(entry);
    entry?.wrapper?.remove();
    if (entry) {
      entry.placeholder = null;
      entry.wrapper = null;
      entry.iframe = null;
      entry.viewerElement = null;
    }
  }

  findPlaceholder(entry) {
    return this.previewElement?.querySelector?.(`.drawio-embed-placeholder[data-drawio-key="${entry.key}"]`) ?? null;
  }

  ensureOverlayRoot() {
    if (this.overlayRoot?.isConnected && this.overlayRoot.parentElement === this.previewElement) {
      return this.overlayRoot;
    }

    let overlayRoot = this.previewElement?.querySelector?.('[data-drawio-overlay-root="true"]');
    if (!overlayRoot) {
      overlayRoot = document.createElement('div');
      overlayRoot.dataset.drawioOverlayRoot = 'true';
      overlayRoot.className = 'drawio-embed-overlay-root';
      this.previewElement?.appendChild(overlayRoot);
    }

    this.overlayRoot = overlayRoot;
    return overlayRoot;
  }

  shouldInlineEntry(entry) {
    return entry?.key === `${entry?.filePath}#file-preview`;
  }

  syncMountedEntryMetadata(entry) {
    if (entry.wrapper) {
      entry.wrapper.dataset.drawioKey = entry.key;
      entry.wrapper.dataset.file = entry.filePath;
      entry.wrapper.classList.toggle('is-direct-file', this.shouldInlineEntry(entry));
    }

    if (entry.iframe) {
      entry.iframe.title = `draw.io: ${entry.filePath}`;
    }
  }

  resetPlaceholderLayout(entry) {
    if (!entry?.placeholder?.isConnected || this.shouldInlineEntry(entry)) {
      return;
    }

    entry.placeholder.classList.remove('is-hydrated');
    entry.placeholder.removeAttribute('data-drawio-hydrated');
    entry.placeholder.style.height = '';
    entry.placeholder.style.pointerEvents = '';
  }

  syncEntryLayout(entry) {
    if (!entry?.wrapper || this.shouldInlineEntry(entry)) {
      return;
    }

    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.findPlaceholder(entry);

    if (!placeholder) {
      return;
    }

    entry.placeholder = placeholder;
    placeholder.classList.add('is-hydrated');
    placeholder.dataset.drawioHydrated = 'true';
    placeholder.style.pointerEvents = 'none';

    const isMaximized = entry.wrapper.classList.contains('is-maximized');
    const wrapperHeight = entry.wrapper.offsetHeight
      || Math.ceil(entry.wrapper.getBoundingClientRect?.().height || 0)
      || entry.inlineHeightPx
      || 420;

    if (!isMaximized) {
      entry.inlineHeightPx = wrapperHeight;
    }

    placeholder.style.height = `${Math.ceil(entry.inlineHeightPx || wrapperHeight)}px`;
    entry.wrapper.style.pointerEvents = 'auto';

    if (isMaximized) {
      entry.wrapper.style.position = '';
      entry.wrapper.style.top = '';
      entry.wrapper.style.left = '';
      entry.wrapper.style.width = 'auto';
      entry.wrapper.style.height = 'auto';
      entry.wrapper.style.minHeight = '0';
      entry.wrapper.style.margin = '';
      return;
    }

    entry.wrapper.style.position = 'absolute';
    entry.wrapper.style.top = `${placeholder.offsetTop}px`;
    entry.wrapper.style.left = `${placeholder.offsetLeft}px`;
    entry.wrapper.style.width = `${placeholder.offsetWidth}px`;
    entry.wrapper.style.margin = '0';
  }

  createOpenButton(entry) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drawio-embed-btn ui-preview-action ui-preview-action--icon-only';
    button.dataset.action = 'open-file';
    button.dataset.filePath = entry.filePath;
    button.title = 'Edit in draw.io';
    button.setAttribute('aria-label', 'Edit in draw.io');
    setDiagramActionButtonIcon(button, 'edit');
    button.addEventListener('click', (event) => {
      event.preventDefault();
      this.onOpenFile?.(entry.filePath);
    });
    return button;
  }

  createMaximizeButton(entry, wrapper) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drawio-embed-btn ui-preview-action ui-preview-action--icon-only';
    button.dataset.action = 'toggle-maximize';
    button.dataset.filePath = entry.filePath;
    button.dataset.drawioKey = entry.key;

    const syncState = () => {
      const isMaximized = this.maximizedEntry?.key === entry.key;
      setDiagramActionButtonIcon(button, isMaximized ? 'restore' : 'maximize');
      button.title = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      button.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    };

    button.addEventListener('click', (event) => {
      event.preventDefault();
      if (this.maximizedEntry?.key === entry.key) {
        this._exitMaximizedEntry();
      } else {
        this._enterMaximizedEntry(entry, wrapper);
      }
      this._syncMaximizeButtons();
    });

    syncState();
    return button;
  }

  _enterMaximizedEntry(entry, wrapper = entry?.wrapper) {
    if (!entry?.wrapper || entry.wrapper !== wrapper) {
      return;
    }

    if (this.maximizedEntry?.key === entry.key) {
      return;
    }

    this._exitMaximizedEntry();

    if (entry.wrapper.parentElement) {
      const spacer = document.createElement('div');
      spacer.className = 'drawio-maximize-spacer';
      spacer.style.height = `${Math.ceil(entry.wrapper.getBoundingClientRect().height)}px`;
      entry.maximizeSpacer = spacer;
      entry.wrapper.parentElement.insertBefore(spacer, entry.wrapper);
    }

    entry.wrapper.classList.add('is-maximized');
    entry.wrapper.dataset.drawioMaximized = 'true';
    entry.wrapper.style.width = 'auto';
    entry.wrapper.style.height = 'auto';
    entry.wrapper.style.minHeight = '0';
    document.body.classList.add('drawio-maximized-open');
    this.maximizedEntry = entry;
    this.overlayRoot?.classList.add('has-maximized-entry');
    this.syncEntryLayout(entry);
  }

  _exitMaximizedEntry() {
    const entry = this.maximizedEntry;
    if (!entry?.wrapper) {
      this.maximizedEntry = null;
      return;
    }

    const { maximizeSpacer } = entry;
    entry.wrapper.classList.remove('is-maximized');
    delete entry.wrapper.dataset.drawioMaximized;
    entry.wrapper.style.width = '';
    entry.wrapper.style.height = '';
    entry.wrapper.style.minHeight = '';

    if (maximizeSpacer?.parentElement) {
      maximizeSpacer.remove();
    }

    entry.maximizeSpacer = null;
    entry.restoreParent = null;
    entry.restoreNextSibling = null;
    this.maximizedEntry = null;
    document.body.classList.toggle('drawio-maximized-open', Boolean(document.body.querySelector('.drawio-embed.is-maximized')));
    this.overlayRoot?.classList.remove('has-maximized-entry');
    this.syncEntryLayout(entry);
  }

  _syncMaximizeButtons() {
    this.embedEntries.forEach((entry) => {
      const button = entry.wrapper?.querySelector('.drawio-embed-btn[data-action="toggle-maximize"]');
      if (!(button instanceof HTMLElement)) {
        return;
      }

      const isMaximized = this.maximizedEntry?.key === entry.key;
      setDiagramActionButtonIcon(button, isMaximized ? 'restore' : 'maximize');
      button.title = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
      button.setAttribute('aria-label', isMaximized ? 'Restore diagram size' : 'Maximize diagram');
    });
  }

  _findEntryByInstanceId(instanceId) {
    for (const entry of this.embedEntries.values()) {
      if (entry.instanceId === instanceId) {
        return entry;
      }
    }

    return null;
  }

  _isMessageFromEntry(event, entry) {
    return Boolean(entry?.iframe?.contentWindow && event.source === entry.iframe.contentWindow);
  }

  _onMessage(event) {
    if (event.origin !== window.location.origin) {
      return;
    }

    const payload = event.data;
    if (!payload || payload.source !== 'drawio-editor') {
      return;
    }

    const entry = this._findEntryByInstanceId(payload.instanceId);
    if (!entry) {
      return;
    }
    if (!this._isMessageFromEntry(event, entry)) {
      return;
    }

    if (payload.type === 'fallback-text') {
      if (entry.mode === 'view') {
        this.renderViewerFallback(entry, 'Failed to render draw.io preview');
        return;
      }
      this.onOpenTextFile?.(entry.filePath);
      return;
    }

    if (payload.type === 'error') {
      if (entry.mode === 'view') {
        this.renderViewerFallback(entry, payload.message || 'Failed to load draw.io preview');
        return;
      }
      this.toastController?.show?.(payload.message || 'Failed to load draw.io');
      return;
    }

    if (payload.type === 'request-open-file') {
      this.onOpenFile?.(entry.filePath);
      return;
    }

    if (payload.type === 'request-toggle-quick-switcher') {
      this.onToggleQuickSwitcher?.();
    }
  }

  _onPreviewClick(event) {
    const loadButton = event.target.closest('.drawio-embed-placeholder-btn');
    if (loadButton) {
      const placeholder = loadButton.closest('.drawio-embed-placeholder');
      const key = placeholder?.dataset.drawioKey || '';
      const entry = this.embedEntries.get(key);
      if (entry) {
        event.preventDefault();
        this.hydrateEntry(entry);
      }
      return;
    }
  }

  _onKeyDown(event) {
    if (event.key === 'Escape') {
      this._exitMaximizedEntry();
      this._syncMaximizeButtons();
    }
  }

  renderViewerFallback(entry, message) {
    if (!entry.wrapper) {
      return;
    }

    const viewerShell = entry.wrapper.querySelector('.drawio-viewer-shell, .drawio-viewer-frame');
    if (!viewerShell) {
      return;
    }

    const fallback = document.createElement('div');
    fallback.className = 'preview-shell';
    fallback.textContent = message;
    viewerShell.replaceChildren(fallback);
    entry.viewerElement = fallback;
  }
}
