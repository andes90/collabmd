import { createDrawioLeaseRoomName } from '../../domain/drawio-room.js';
import { resolveAppUrl } from '../domain/runtime-paths.js';
import { vaultApiClient } from '../domain/vault-api-client.js';

const HYDRATE_VIEWPORT_MARGIN_PX = 360;
const DRAWIO_VIEWER_SCRIPT_URL = 'https://viewer.diagrams.net/js/viewer-static.min.js';

let drawioViewerLoadPromise = null;

function requestIdleRender(callback, timeout) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout });
  }

  return window.setTimeout(() => callback({ didTimeout: false, timeRemaining: () => 0 }), 1);
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
  return elementRect.bottom >= (rootRect.top - marginPx) && elementRect.top <= (rootRect.bottom + marginPx);
}

function ensureDrawioViewerLoaded() {
  if (window.GraphViewer?.processElements) {
    return Promise.resolve(window.GraphViewer);
  }

  if (drawioViewerLoadPromise) {
    return drawioViewerLoadPromise;
  }

  drawioViewerLoadPromise = new Promise((resolve, reject) => {
    const existingScript = document.querySelector('script[data-collabmd-drawio-viewer]');
    const script = existingScript instanceof HTMLScriptElement
      ? existingScript
      : document.createElement('script');

    const cleanup = () => {
      script.removeEventListener('error', handleError);
      script.removeEventListener('load', handleLoad);
    };

    const handleError = () => {
      cleanup();
      drawioViewerLoadPromise = null;
      reject(new Error('Failed to load draw.io viewer'));
    };

    const handleLoad = () => {
      cleanup();
      if (!window.GraphViewer?.processElements) {
        drawioViewerLoadPromise = null;
        reject(new Error('draw.io viewer did not initialize'));
        return;
      }

      resolve(window.GraphViewer);
    };

    script.addEventListener('error', handleError, { once: true });
    script.addEventListener('load', handleLoad, { once: true });

    if (!existingScript) {
      script.src = DRAWIO_VIEWER_SCRIPT_URL;
      script.async = true;
      script.dataset.collabmdDrawioViewer = 'true';
      document.head.append(script);
    } else if (window.GraphViewer?.processElements) {
      handleLoad();
    }
  });

  return drawioViewerLoadPromise;
}

export class DrawioEmbedController {
  constructor({
    getLocalUser,
    getTheme,
    onOpenFile = null,
    onOpenTextFile = null,
    previewContainer,
    previewElement,
    toastController,
  }) {
    this.getLocalUser = getLocalUser;
    this.getTheme = getTheme;
    this.onOpenFile = onOpenFile;
    this.onOpenTextFile = onOpenTextFile;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toastController = toastController;
    this.embedEntries = new Map();
    this.hydrationQueue = [];
    this.hydrationIdleId = null;
    this.hydrationPaused = false;
    this.instanceCounter = 0;

    this._onMessage = this._onMessage.bind(this);
    this._onPreviewClick = this._onPreviewClick.bind(this);

    window.addEventListener('message', this._onMessage);
    this.previewElement?.addEventListener('click', this._onPreviewClick);
  }

  destroy() {
    window.removeEventListener('message', this._onMessage);
    this.previewElement?.removeEventListener('click', this._onPreviewClick);
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.embedEntries.forEach((entry) => entry.wrapper?.remove());
    this.embedEntries.clear();
  }

  detachForCommit() {
    cancelIdleRender(this.hydrationIdleId);
    this.hydrationIdleId = null;
    this.hydrationQueue = [];
    this.embedEntries.forEach((entry) => {
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
      const nextEntry = existingEntry
        ? { ...existingEntry, ...descriptor }
        : {
          ...descriptor,
          iframe: null,
          imageElement: null,
          instanceId: '',
          queued: false,
          viewerElement: null,
          wrapper: null,
        };
      nextEntries.set(descriptor.key, nextEntry);
    });

    this.embedEntries.forEach((entry, key) => {
      if (!nextEntries.has(key)) {
        entry.wrapper?.remove();
      }
    });

    this.embedEntries = nextEntries;

    this.embedEntries.forEach((entry) => {
      if (entry.wrapper) {
        entry.placeholder?.replaceWith(entry.wrapper);
      } else {
        entry.queued = false;
      }
    });

    if (!this.hydrationPaused) {
      this.hydrateVisibleEmbeds();
    }
  }

  hydrateVisibleEmbeds() {
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper || !entry.placeholder?.isConnected) {
        return;
      }

      if (entry.mode === 'edit' || isNearViewport(entry.placeholder, this.previewContainer, HYDRATE_VIEWPORT_MARGIN_PX)) {
        this.enqueueHydration(entry);
      }
    });
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
    wrapper.className = `drawio-embed${entry.mode === 'edit' ? ' is-direct-file' : ''}`;
    wrapper.dataset.file = entry.filePath;

    const header = document.createElement('div');
    header.className = 'drawio-embed-header';

    const label = document.createElement('span');
    label.className = 'drawio-embed-label';
    label.textContent = entry.label.replace(/\.drawio$/i, '');
    header.appendChild(label);

    if (entry.mode !== 'edit') {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'drawio-embed-btn';
      button.dataset.action = 'open-file';
      button.dataset.filePath = entry.filePath;
      button.textContent = 'Open';
      header.appendChild(button);
    }

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
    entry.placeholder.replaceWith(wrapper);
  }

  async hydrateViewerEntry(entry) {
    if (!entry.placeholder?.isConnected || entry.wrapper) {
      return;
    }

    const wrapper = document.createElement('div');
    wrapper.className = 'drawio-embed is-static-preview';
    wrapper.dataset.file = entry.filePath;

    const header = document.createElement('div');
    header.className = 'drawio-embed-header';

    const label = document.createElement('span');
    label.className = 'drawio-embed-label';
    label.textContent = entry.label.replace(/\.drawio$/i, '');
    header.appendChild(label);

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'drawio-embed-btn';
    button.dataset.action = 'open-file';
    button.dataset.filePath = entry.filePath;
    button.textContent = 'Open';
    header.appendChild(button);

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
    entry.placeholder.replaceWith(wrapper);

    try {
      await this.renderViewerEntry(entry);
    } catch (error) {
      this.renderViewerFallback(entry, error instanceof Error ? error.message : 'Failed to render draw.io preview');
    }
  }

  async renderViewerEntry(entry) {
    const [{ content }, viewer] = await Promise.all([
      vaultApiClient.readFile(entry.filePath),
      ensureDrawioViewerLoaded(),
    ]);

    if (!entry.wrapper?.isConnected || !entry.viewerElement?.isConnected) {
      return;
    }

    const theme = this.getTheme?.() === 'light' ? 'light' : 'dark';
    const graphElement = document.createElement('div');
    graphElement.className = 'mxgraph drawio-viewer-frame';
    graphElement.dataset.action = 'open-file';
    graphElement.dataset.filePath = entry.filePath;
    graphElement.setAttribute('role', 'button');
    graphElement.setAttribute('tabindex', '0');
    graphElement.setAttribute('aria-label', `Open ${entry.label.replace(/\.drawio$/i, '')}`);
    graphElement.dataset.mxgraph = JSON.stringify({
      'check-visible-state': false,
      center: true,
      border: 0,
      'dark-mode': theme,
      editable: false,
      fit: 1,
      lightbox: false,
      nav: false,
      resize: false,
      toolbar: '',
      tooltips: false,
      xml: String(content ?? ''),
    });

    entry.viewerElement.replaceChildren(graphElement);
    entry.viewerElement = graphElement;
    viewer.processElements();
  }

  buildIframeUrl(entry) {
    const url = new URL(resolveAppUrl('/drawio-editor.html'));
    const localUser = this.getLocalUser?.() ?? {};
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

  syncLayout() {}

  _findEntryByInstanceId(instanceId) {
    for (const entry of this.embedEntries.values()) {
      if (entry.instanceId === instanceId) {
        return entry;
      }
    }

    return null;
  }

  _onMessage(event) {
    const payload = event.data;
    if (!payload || payload.source !== 'drawio-editor') {
      return;
    }

    const entry = this._findEntryByInstanceId(payload.instanceId);
    if (!entry) {
      return;
    }

    if (payload.type === 'fallback-text') {
      if (entry.mode === 'view') {
        this.renderExportFallback(entry, 'Failed to render draw.io preview');
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

    const openButton = event.target.closest('.drawio-embed-btn[data-action="open-file"]');
    if (openButton) {
      event.preventDefault();
      this.onOpenFile?.(openButton.dataset.filePath || '');
    }

    const viewerFrame = event.target.closest('.drawio-viewer-frame[data-action="open-file"]');
    if (viewerFrame) {
      event.preventDefault();
      this.onOpenFile?.(viewerFrame.dataset.filePath || '');
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
