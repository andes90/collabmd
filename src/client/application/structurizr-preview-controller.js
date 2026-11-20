import { resolveAppPath } from '../domain/runtime-paths.js';

const SYNC_DEBOUNCE_MS = 300;
const FRAME_READY_TIMEOUT_MS = 1_000;

function decodeViewKey(hash = '') {
  const normalized = String(hash ?? '').replace(/^#/, '');
  if (!normalized) {
    return '';
  }

  try {
    return decodeURIComponent(normalized);
  } catch {
    return normalized;
  }
}

function readFrameState(iframe) {
  try {
    const frameDocument = iframe?.contentDocument;
    const layer = frameDocument?.querySelector('.joint-layers');
    const viewport = frameDocument?.querySelector('#diagram-viewport');
    const zoom = layer ? new DOMMatrixReadOnly(getComputedStyle(layer).transform).a : 0;
    return {
      scrollLeft: viewport?.scrollLeft ?? 0,
      scrollTop: viewport?.scrollTop ?? 0,
      zoom: Number.isFinite(zoom) && zoom > 0 ? zoom : null,
    };
  } catch {
    return null;
  }
}

export class StructurizrPreviewController {
  constructor({
    enabled = false,
    setActionIcon = null,
    syncWorkspace,
  }) {
    this.setActionIcon = setActionIcon;
    this.enabled = Boolean(enabled);
    this.syncWorkspace = syncWorkspace;
    this.iframe = null;
    this.shell = null;
    this.status = null;
    this.maximizeButton = null;
    this.filePath = null;
    this.viewKey = '';
    this.lastVersion = null;
    this.syncTimer = null;
    this.syncToken = 0;
    this.frameFitCleanup = new Map();
    this.frameHost = null;
    this.pendingIframe = null;
    this.pendingVersion = null;
    this.handleFrameLoad = (event) => {
      const iframe = event?.currentTarget || this.iframe;
      if (!iframe) {
        return;
      }

      try {
        if (iframe === this.iframe) {
          this.viewKey = decodeViewKey(iframe.contentWindow?.location?.hash || '') || this.viewKey;
          iframe.contentWindow?.addEventListener('hashchange', this.handleFrameHashChange);
        }
        this.prepareFrame(iframe);
      } catch {
        if (iframe === this.pendingIframe) {
          this.commitPendingIframe(iframe);
        }
      }
    };
    this.handleFrameHashChange = () => {
      try {
        this.viewKey = decodeViewKey(this.iframe?.contentWindow?.location?.hash || '') || this.viewKey;
      } catch {
        // Ignore inaccessible frame locations.
      }
    };
  }

  setStatus(message = '', { error = false } = {}) {
    if (!this.status) {
      return;
    }

    this.status.textContent = message;
    this.status.hidden = !message;
    this.status.classList.toggle('is-error', error);
  }

  prepareFrame(iframe = this.iframe) {
    const frameDocument = iframe?.contentDocument;
    if (!frameDocument?.head) {
      if (iframe === this.pendingIframe) {
        this.commitPendingIframe(iframe);
      }
      return;
    }

    iframe.contentWindow?.dispatchEvent(new Event('resize'));
    this.scheduleFrameFit(iframe, iframe === this.pendingIframe ? () => this.commitPendingIframe(iframe) : null);
  }

  fitFrameToCanvas(iframe = this.iframe) {
    const frameDocument = iframe?.contentDocument;
    const canvas = frameDocument?.querySelector('#diagram-canvas');
    if (!canvas) {
      return false;
    }
    if (iframe === this.pendingIframe && !frameDocument.querySelector('.joint-layers')) {
      return false;
    }

    try {
      const diagram = iframe?.contentWindow?.structurizr?.diagram;
      diagram?.setEmbedded?.(true);
      diagram?.resize?.();
      diagram?.zoomToWidthOrHeight?.();
    } catch {
      // The frame can be cross-origin in custom deployments; the CSS crop still applies.
    }

    const { width, height } = canvas.getBoundingClientRect();
    if (!width || !height) {
      return false;
    }

    return true;
  }

  disposeFrame(iframe) {
    if (!iframe) {
      return;
    }

    this.frameFitCleanup.get(iframe)?.();
    try {
      iframe.contentWindow?.removeEventListener?.('hashchange', this.handleFrameHashChange);
    } catch {
      // Ignore inaccessible frame windows during cleanup.
    }
    iframe.removeEventListener('load', this.handleFrameLoad);
    iframe.remove();
  }

  discardPendingIframe() {
    if (!this.pendingIframe) {
      return;
    }

    this.disposeFrame(this.pendingIframe);
    this.pendingIframe = null;
    this.pendingVersion = null;
  }

  commitPendingIframe(iframe) {
    if (iframe !== this.pendingIframe || !this.shell?.isConnected) {
      return;
    }

    const previousIframe = this.iframe;
    const nextVersion = this.pendingVersion;
    const frameState = readFrameState(previousIframe);
    this.pendingIframe = null;
    this.pendingVersion = null;
    if (frameState?.zoom) {
      try {
        iframe.contentWindow?.structurizr?.diagram?.zoomTo?.(frameState.zoom);
      } catch {
        // Keep the new diagram usable when a custom viewer does not expose zoom controls.
      }
    }
    try {
      const viewport = iframe.contentDocument?.querySelector('#diagram-viewport');
      if (viewport && frameState) {
        viewport.scrollLeft = frameState.scrollLeft;
        viewport.scrollTop = frameState.scrollTop;
      }
    } catch {
      // Cross-origin custom viewers cannot restore viewport coordinates.
    }
    this.disposeFrame(previousIframe);
    iframe.style.visibility = '';
    iframe.style.pointerEvents = '';
    iframe.removeAttribute('aria-hidden');
    this.iframe = iframe;
    this.lastVersion = nextVersion;

    try {
      this.viewKey = decodeViewKey(iframe.contentWindow?.location?.hash || '') || this.viewKey;
      iframe.contentWindow?.addEventListener('hashchange', this.handleFrameHashChange);
    } catch {
      // Cross-origin deployments cannot expose the frame hash.
    }
    this.setStatus('');
  }

  createIframe() {
    const iframe = document.createElement('iframe');
    iframe.className = 'structurizr-preview-iframe';
    iframe.title = 'Structurizr architecture diagram';
    iframe.loading = 'eager';
    iframe.referrerPolicy = 'same-origin';
    iframe.addEventListener('load', this.handleFrameLoad);
    return iframe;
  }

  syncMaximizeButtonState() {
    if (!this.maximizeButton || !this.shell) {
      return;
    }

    const isMaximized = this.shell.classList.contains('is-maximized');
    this.setActionIcon?.(this.maximizeButton, isMaximized ? 'restore' : 'maximize');
    const label = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
    this.maximizeButton.title = label;
    this.maximizeButton.setAttribute('aria-label', label);
  }

  setMaximized(shouldMaximize) {
    const isMaximized = Boolean(shouldMaximize);
    this.shell?.classList.toggle('is-maximized', isMaximized);
    document.body?.classList.toggle('structurizr-maximized-open', isMaximized);
    this.syncMaximizeButtonState();
    this.iframe?.contentWindow?.dispatchEvent(new Event('resize'));
  }

  scheduleFrameFit(iframe = this.iframe, onReady = null) {
    if (!iframe) return;
    this.frameFitCleanup.get(iframe)?.();
    if (this.fitFrameToCanvas(iframe) || !iframe.contentDocument?.documentElement) {
      onReady?.();
      return;
    }

    const frameDocument = iframe.contentDocument;
    let observedCanvas = null;
    const finish = () => {
      cleanup();
      onReady?.();
    };
    const fit = () => {
      const canvas = frameDocument.querySelector('#diagram-canvas');
      if (canvas !== observedCanvas) {
        resizeObserver.disconnect();
        if (canvas) resizeObserver.observe(canvas);
        observedCanvas = canvas;
      }
      if (this.fitFrameToCanvas(iframe)) finish();
    };
    const observer = new MutationObserver(fit);
    const resizeObserver = new ResizeObserver(fit);
    const timer = setTimeout(finish, FRAME_READY_TIMEOUT_MS);
    const cleanup = () => {
      clearTimeout(timer);
      observer.disconnect();
      resizeObserver.disconnect();
      this.frameFitCleanup.delete(iframe);
    };
    this.frameFitCleanup.set(iframe, cleanup);
    observer.observe(frameDocument.documentElement, { childList: true, subtree: true });
    fit();
  }

  mount(renderHost, filePath) {
    const fileChanged = Boolean(this.filePath && this.filePath !== filePath);
    if (fileChanged) {
      this.setMaximized(false);
      this.discardPendingIframe();
      this.disposeFrame(this.iframe);
      this.iframe = null;
      this.lastVersion = null;
      this.viewKey = '';
    }

    this.filePath = filePath;

    if (this.shell?.isConnected && this.shell.parentElement === renderHost) {
      return;
    }

    for (const cleanup of this.frameFitCleanup.values()) cleanup();
    this.shell = document.createElement('section');
    this.shell.className = 'structurizr-preview-shell diagram-preview-shell';
    this.shell.dataset.structurizrPreview = 'true';

    const header = document.createElement('div');
    header.className = 'structurizr-preview-header diagram-preview-toolbar';

    const label = document.createElement('span');
    label.className = 'structurizr-preview-label';
    label.textContent = String(filePath).split('/').pop()?.replace(/\.dsl$/i, '') || 'Structurizr';

    this.maximizeButton = document.createElement('button');
    this.maximizeButton.type = 'button';
    this.maximizeButton.className = 'structurizr-preview-btn ui-preview-action ui-preview-action--icon-only';
    this.maximizeButton.dataset.action = 'toggle-maximize';
    this.maximizeButton.addEventListener('click', (event) => {
      event.preventDefault();
      this.setMaximized(!this.shell?.classList.contains('is-maximized'));
    });
    header.append(label, this.maximizeButton);
    this.syncMaximizeButtonState();

    this.status = document.createElement('div');
    this.status.className = 'structurizr-preview-status';
    this.status.setAttribute('aria-live', 'polite');
    this.status.setAttribute('role', 'status');
    this.status.hidden = true;

    this.frameHost = document.createElement('div');
    this.frameHost.className = 'structurizr-preview-stage';
    this.shell.append(header, this.status, this.frameHost);

    renderHost?.replaceChildren(this.shell);
    this.iframe = null;
    this.pendingIframe = null;
    this.pendingVersion = null;
    this.lastVersion = null;
  }

  async render({ filePath, renderHost, source = '' }) {
    this.mount(renderHost, filePath);
    return this.syncNow({ filePath, source: String(source ?? '') });
  }

  queueSync({ filePath, source = '' } = {}) {
    clearTimeout(this.syncTimer);
    this.syncTimer = setTimeout(() => {
      this.syncTimer = null;
      void this.syncNow({ filePath, source: String(source ?? '') });
    }, SYNC_DEBOUNCE_MS);
  }

  async syncNow({ filePath, source = '' } = {}) {
    if (filePath !== this.filePath) {
      return false;
    }

    const token = ++this.syncToken;
    if (!this.enabled) {
      this.setStatus('Structurizr preview is not configured. Start CollabMD with --local-structurizr.', { error: true });
      return false;
    }

    if (!this.iframe) {
      this.setStatus('Validating Structurizr workspace…');
    }

    try {
      const payload = await this.syncWorkspace({ path: filePath, source });
      if (token !== this.syncToken || filePath !== this.filePath) {
        return false;
      }

      const nextVersion = payload?.version || null;
      const route = resolveAppPath('/workspace/1/diagrams');
      const hash = this.viewKey ? `#${encodeURIComponent(this.viewKey)}` : '';
      if (!this.iframe) {
        const iframe = this.createIframe();
        this.iframe = iframe;
        this.frameHost?.appendChild(iframe);
        iframe.src = `${route}${hash}`;
        this.lastVersion = nextVersion;
      } else if (nextVersion !== this.lastVersion) {
        this.discardPendingIframe();
        const iframe = this.createIframe();
        iframe.style.visibility = 'hidden';
        iframe.style.pointerEvents = 'none';
        iframe.setAttribute('aria-hidden', 'true');
        this.pendingIframe = iframe;
        this.pendingVersion = nextVersion;
        this.frameHost?.appendChild(iframe);
        iframe.src = `${route}${hash}`;
      }

      this.setStatus('');
      return true;
    } catch (error) {
      if (token !== this.syncToken || filePath !== this.filePath) {
        return false;
      }

      this.setStatus(error?.message || 'Failed to load Structurizr workspace.', { error: true });
      return false;
    }
  }

  reset() {
    this.setMaximized(false);
    clearTimeout(this.syncTimer);
    this.syncTimer = null;
    for (const cleanup of this.frameFitCleanup.values()) cleanup();
    this.syncToken += 1;
    this.discardPendingIframe();
    this.disposeFrame(this.iframe);
    this.iframe = null;
    this.frameHost = null;
    this.shell = null;
    this.status = null;
    this.maximizeButton = null;
    this.filePath = null;
    this.lastVersion = null;
    this.viewKey = '';
  }
}
