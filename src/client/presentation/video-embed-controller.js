import { reconcileEmbedEntries } from './excalidraw-embed-reconciler.js';

const DEFAULT_ASPECT_RATIO = 16 / 9;
const DEFAULT_HEIGHT = 240;
const MAX_HEIGHT = 720;
const MIN_HEIGHT = 180;

function clampHeight(height) {
  return Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, Math.ceil(height || DEFAULT_HEIGHT)));
}

export class VideoEmbedController {
  constructor({
    previewElement,
  }) {
    this.previewElement = previewElement;
    this.embedEntries = new Map();
    this.overlayRoot = null;
  }

  destroy() {
    this.embedEntries.forEach((entry) => {
      if (entry.hydrateFrameId) {
        cancelAnimationFrame(entry.hydrateFrameId);
        entry.hydrateFrameId = null;
      }
      entry.wrapper?.remove();
      entry.placeholder = null;
    });
    this.embedEntries.clear();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
  }

  detachForCommit() {
    this.embedEntries.forEach((entry) => {
      entry.placeholder = null;
    });
  }

  reconcileEmbeds(previewElement = this.previewElement) {
    this.previewElement = previewElement;
    if (!previewElement) {
      return;
    }

    const descriptors = Array.from(previewElement.querySelectorAll('.video-embed-placeholder[data-video-embed-key]')).map((placeholder) => ({
      filePath: placeholder.dataset.videoEmbedSource,
      key: placeholder.dataset.videoEmbedKey,
      label: placeholder.dataset.videoEmbedLabel || 'Embedded video',
      placeholder,
      source: placeholder.dataset.videoEmbedSource || '',
      kind: placeholder.dataset.videoEmbedKind || '',
      url: placeholder.dataset.videoEmbedUrl || '',
      mimeType: placeholder.dataset.videoEmbedMimeType || '',
    }));

    const { nextEntries, removedEntries } = reconcileEmbedEntries(this.embedEntries, descriptors);
    removedEntries.forEach((entry) => this._destroyEntry(entry));
    this.embedEntries = nextEntries;

    this.embedEntries.forEach((entry) => {
      entry.aspectRatio = entry.aspectRatio || DEFAULT_ASPECT_RATIO;
      entry.kind = entry.placeholder?.dataset.videoEmbedKind || entry.kind;
      entry.label = entry.placeholder?.dataset.videoEmbedLabel || entry.label;
      entry.mimeType = entry.placeholder?.dataset.videoEmbedMimeType || entry.mimeType;
      entry.source = entry.placeholder?.dataset.videoEmbedSource || entry.source;
      entry.url = entry.placeholder?.dataset.videoEmbedUrl || entry.url;

      if (!entry.wrapper) {
        this._createEmbed(entry);
      }

      this._attachWrapper(entry);
    });

    this.syncLayout();

    if (this.embedEntries.size === 0) {
      this.overlayRoot?.remove();
      this.overlayRoot = null;
    }
  }

  syncLayout() {
    this.embedEntries.forEach((entry) => {
      if (entry.wrapper) {
        this._syncEntryLayout(entry);
      }
    });
  }

  _destroyEntry(entry) {
    if (entry.hydrateFrameId) {
      cancelAnimationFrame(entry.hydrateFrameId);
      entry.hydrateFrameId = null;
    }
    entry.wrapper?.remove();
    entry.placeholder = null;
  }

  _createEmbed(entry) {
    const wrapper = document.createElement('div');
    wrapper.className = `video-embed video-embed-shell diagram-preview-shell is-${entry.kind}`;

    if (entry.kind === 'youtube') {
      const frame = document.createElement('div');
      frame.className = 'video-embed-frame video-embed-frame-youtube';

      const iframe = document.createElement('iframe');
      iframe.className = 'video-embed-iframe';
      iframe.title = entry.label || 'Embedded YouTube video';
      iframe.referrerPolicy = 'strict-origin-when-cross-origin';
      iframe.allow = 'accelerometer; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share';
      iframe.allowFullscreen = true;

      frame.appendChild(iframe);
      wrapper.appendChild(frame);
      entry.mediaElement = iframe;
    } else {
      const video = document.createElement('video');
      video.className = 'video-embed-player';
      video.controls = true;
      video.preload = 'metadata';
      video.playsInline = true;
      if (entry.label) {
        video.title = entry.label;
        video.setAttribute('aria-label', entry.label);
      }

      const source = document.createElement('source');
      source.src = entry.url;
      if (entry.mimeType) {
        source.type = entry.mimeType;
      }

      video.appendChild(source);
      video.addEventListener('loadedmetadata', () => {
        if (Number.isFinite(video.videoWidth) && Number.isFinite(video.videoHeight) && video.videoWidth > 0 && video.videoHeight > 0) {
          entry.aspectRatio = video.videoWidth / video.videoHeight;
          this._syncEntryLayout(entry);
        }
      });

      wrapper.appendChild(video);
      entry.mediaElement = video;
    }

    entry.wrapper = wrapper;
  }

  _attachWrapper(entry) {
    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.previewElement?.querySelector(`.video-embed-placeholder[data-video-embed-key="${entry.key}"]`);

    if (!placeholder) {
      return;
    }

    entry.placeholder = placeholder;
    placeholder.classList.add('is-hydrated');
    placeholder.dataset.videoEmbedHydrated = 'true';
    placeholder.style.pointerEvents = 'none';

    const overlayRoot = this._ensureOverlayRoot();
    if (entry.wrapper?.parentElement !== overlayRoot) {
      overlayRoot.appendChild(entry.wrapper);
    }
  }

  _syncEntryLayout(entry) {
    const placeholder = entry.placeholder?.isConnected
      ? entry.placeholder
      : this.previewElement?.querySelector(`.video-embed-placeholder[data-video-embed-key="${entry.key}"]`);

    if (!placeholder || !entry.wrapper) {
      return;
    }

    entry.placeholder = placeholder;
    const width = placeholder.offsetWidth || placeholder.clientWidth || 0;
    if (width <= 0 && entry.inlineHeightPx) {
      return;
    }

    const height = clampHeight(width > 0 ? (width / (entry.aspectRatio || DEFAULT_ASPECT_RATIO)) : entry.inlineHeightPx);
    entry.inlineHeightPx = height;

    setStyleIfChanged(placeholder, 'height', `${height}px`);

    setStyleIfChanged(entry.wrapper, 'position', 'absolute');
    setStyleIfChanged(entry.wrapper, 'top', `${placeholder.offsetTop}px`);
    setStyleIfChanged(entry.wrapper, 'left', `${placeholder.offsetLeft}px`);
    setStyleIfChanged(entry.wrapper, 'width', `${placeholder.offsetWidth}px`);
    setStyleIfChanged(entry.wrapper, 'height', `${height}px`);
    setStyleIfChanged(entry.wrapper, 'margin', '0');
    setStyleIfChanged(entry.wrapper, 'pointerEvents', 'auto');

    this._hydrateEntryMedia(entry);
  }

  _ensureOverlayRoot() {
    let overlayRoot = this.previewElement?.querySelector('[data-video-overlay-root="true"]');
    if (!overlayRoot) {
      overlayRoot = document.createElement('div');
      overlayRoot.dataset.videoOverlayRoot = 'true';
      overlayRoot.className = 'video-embed-overlay-root';
      this.previewElement?.appendChild(overlayRoot);
    }

    this.overlayRoot = overlayRoot;
    return overlayRoot;
  }

  _hydrateEntryMedia(entry) {
    if (entry.kind !== 'youtube') {
      return;
    }

    const iframe = entry.mediaElement;
    if (!(iframe instanceof HTMLIFrameElement)) {
      return;
    }

    if (!entry.url || iframe.getAttribute('src') === entry.url) {
      return;
    }

    if (entry.wrapper?.offsetWidth <= 0 || entry.wrapper?.offsetHeight <= 0) {
      return;
    }

    if (entry.hydrateFrameId) {
      return;
    }

    entry.hydrateFrameId = requestAnimationFrame(() => {
      entry.hydrateFrameId = null;

      if (!entry.url || iframe.getAttribute('src') === entry.url) {
        return;
      }

      const width = Math.round(entry.wrapper?.offsetWidth || 0);
      const height = Math.round(entry.wrapper?.offsetHeight || 0);
      if (width <= 0 || height <= 0) {
        return;
      }

      iframe.width = String(width);
      iframe.height = String(height);
      iframe.src = entry.url;
    });
  }
}

function setStyleIfChanged(element, property, value) {
  if (!element || element.style[property] === value) {
    return;
  }

  element.style[property] = value;
}
