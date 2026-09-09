const MIN_SCALE = 1;
const MAX_SCALE = 6;
const ZOOM_STEP = 0.25;
const CLICK_ZOOM_SCALE = 2;
const DRAG_THRESHOLD_PX = 6;

export function clampImageLightboxScale(value) {
  const numericValue = Number(value);
  if (!Number.isFinite(numericValue)) {
    return MIN_SCALE;
  }

  return Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.round(numericValue * 100) / 100));
}

export function clampImageLightboxOffset(offset, {
  contentSize = 0,
  scale = 1,
  viewportSize = 0,
} = {}) {
  const numericOffset = Number(offset);
  const numericContentSize = Number(contentSize);
  const numericScale = Number(scale);
  const numericViewportSize = Number(viewportSize);

  if (
    !Number.isFinite(numericOffset)
    || !Number.isFinite(numericContentSize)
    || !Number.isFinite(numericScale)
    || !Number.isFinite(numericViewportSize)
  ) {
    return 0;
  }

  const overflow = ((numericContentSize * numericScale) - numericViewportSize) / 2;
  if (overflow <= 0) {
    return 0;
  }

  return Math.min(Math.max(numericOffset, -overflow), overflow);
}

export function isImageLightboxWheelZoomGesture(event) {
  return Boolean(event?.ctrlKey);
}

export class ImageLightboxController {
  constructor({
    previewElement,
    documentRef = document,
    windowRef = window,
  }) {
    this.previewElement = previewElement;
    this.document = documentRef;
    this.window = windowRef;
    this.overlayRoot = null;
    this.viewport = null;
    this.imageElement = null;
    this.zoomLabel = null;
    this.titleElement = null;
    this.isOpen = false;
    this.scale = MIN_SCALE;
    this.offsetX = 0;
    this.offsetY = 0;
    this.activePointerId = null;
    this.dragStartX = 0;
    this.dragStartY = 0;
    this.dragOriginX = 0;
    this.dragOriginY = 0;
    this.touchPointers = new Map();
    this.pinchPointerIds = [];
    this.pinchStartDistance = 0;
    this.pinchStartScale = MIN_SCALE;
    this.pinchStartOffsetX = 0;
    this.pinchStartOffsetY = 0;
    this.pinchStartCenter = { x: 0, y: 0 };
    this.didDrag = false;
    this.resetButton = null;
    this.previouslyFocusedElement = null;
    this.blockingModalHandler = () => this.close();
    this.listenerController = new AbortController();
    const { signal } = this.listenerController;

    this.handlePreviewClick = (event) => {
      const target = event.target;
      if (!(target instanceof this.window.Element)) {
        return;
      }

      const image = target.closest('img');
      if (!image || !this.previewElement?.contains(image)) {
        return;
      }

      if (image.closest('[data-video-overlay-root="true"], [data-excalidraw-overlay-root="true"]')) {
        return;
      }

      event.preventDefault();
      event.stopImmediatePropagation?.();
      this.openFromImage(image);
    };

    this.handleKeyDown = (event) => {
      if (!this.isOpen) {
        return;
      }

      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        this.zoomBy(ZOOM_STEP);
        return;
      }

      if (event.key === '-') {
        event.preventDefault();
        this.zoomBy(-ZOOM_STEP);
        return;
      }

      if (event.key === '0') {
        event.preventDefault();
        this.resetView();
      }
    };

    this.handleWindowResize = () => {
      if (!this.isOpen) {
        return;
      }

      this.clampOffsets();
      this.syncTransform();
    };

    this.previewElement?.addEventListener('click', this.handlePreviewClick, { signal });
    this.document.addEventListener('keydown', this.handleKeyDown, { signal });
    this.window.addEventListener('resize', this.handleWindowResize, { signal });
  }

  destroy() {
    this.listenerController?.abort();
    this.listenerController = null;
    this.close();
    this.overlayRoot?.remove();
    this.overlayRoot = null;
    this.viewport = null;
    this.imageElement = null;
    this.zoomLabel = null;
    this.titleElement = null;
    this.resetButton = null;
  }

  openFromImage(image) {
    const src = image?.currentSrc || image?.getAttribute?.('src') || '';
    if (!src) {
      return false;
    }

    this.ensureOverlayRoot();
    this.previouslyFocusedElement = this.document.activeElement instanceof this.window.HTMLElement
      ? this.document.activeElement
      : null;
    this.resetView();
    this.titleElement.textContent = image.getAttribute('alt') || 'Image preview';
    this.imageElement.src = src;
    this.imageElement.alt = image.getAttribute('alt') || '';
    this.overlayRoot.showModal();
    this.isOpen = true;
    this.document.body.classList.add('image-lightbox-open');
    this.document.addEventListener('collabmd:close-custom-modals', this.blockingModalHandler);
    this.syncTransform();
    this.overlayRoot.querySelector('button:not(:disabled)')?.focus();
    return true;
  }

  close() {
    if (!this.isOpen && !this.overlayRoot) {
      return;
    }

    this.stopDrag();
    this.touchPointers.clear();
    this.pinchPointerIds = [];
    this.pinchStartDistance = 0;
    this.didDrag = false;
    this.viewport?.classList?.remove('is-dragging');
    if (this.overlayRoot?.open) {
      this.overlayRoot.close();
    }
    this.isOpen = false;
    this.document.body.classList.remove('image-lightbox-open');
    this.document.removeEventListener('collabmd:close-custom-modals', this.blockingModalHandler);
    this.previouslyFocusedElement?.focus?.();
    this.previouslyFocusedElement = null;
  }

  resetView() {
    this.scale = MIN_SCALE;
    this.offsetX = 0;
    this.offsetY = 0;
    this.syncTransform();
  }

  zoomBy(delta) {
    this.setScale(this.scale + delta);
  }

  setScale(nextScale) {
    this.scale = clampImageLightboxScale(nextScale);
    this.clampOffsets();
    this.syncTransform();
  }

  capturePointer(pointerId) {
    try {
      this.viewport?.setPointerCapture?.(pointerId);
    } catch {
      // Synthetic tests may not have an active browser pointer to capture.
    }
  }

  releasePointer(pointerId) {
    try {
      this.viewport?.releasePointerCapture?.(pointerId);
    } catch {
      // Ignore release failures when the pointer is already gone.
    }
  }

  getViewportPointFromClient(clientX, clientY) {
    if (!this.viewport) {
      return { x: 0, y: 0 };
    }

    const rect = this.viewport.getBoundingClientRect();
    return {
      x: Number(clientX) - rect.left - (rect.width / 2),
      y: Number(clientY) - rect.top - (rect.height / 2),
    };
  }

  setScaleAroundViewportPoint(nextScale, viewportPoint, {
    originScale = this.scale,
    originOffsetX = this.offsetX,
    originOffsetY = this.offsetY,
    targetViewportPoint = viewportPoint,
  } = {}) {
    const clampedScale = clampImageLightboxScale(nextScale);
    const safeOriginScale = Number(originScale) > 0 ? Number(originScale) : MIN_SCALE;
    const originPointX = Number.isFinite(viewportPoint?.x) ? viewportPoint.x : 0;
    const originPointY = Number.isFinite(viewportPoint?.y) ? viewportPoint.y : 0;
    const targetPointX = Number.isFinite(targetViewportPoint?.x) ? targetViewportPoint.x : originPointX;
    const targetPointY = Number.isFinite(targetViewportPoint?.y) ? targetViewportPoint.y : originPointY;

    this.scale = clampedScale;
    this.offsetX = targetPointX - (((originPointX - originOffsetX) / safeOriginScale) * clampedScale);
    this.offsetY = targetPointY - (((originPointY - originOffsetY) / safeOriginScale) * clampedScale);
    this.clampOffsets();
    this.syncTransform();
  }

  startDrag(pointerId, clientX, clientY) {
    if (!this.viewport || this.scale <= MIN_SCALE) {
      return false;
    }

    this.activePointerId = pointerId;
    this.dragStartX = clientX;
    this.dragStartY = clientY;
    this.dragOriginX = this.offsetX;
    this.dragOriginY = this.offsetY;
    this.viewport.classList.add('is-dragging');
    this.capturePointer(pointerId);
    return true;
  }

  stopDrag(pointerId = this.activePointerId) {
    if (pointerId === this.activePointerId) {
      this.activePointerId = null;
    }

    this.viewport?.classList?.remove('is-dragging');
    if (pointerId !== null) {
      this.releasePointer(pointerId);
    }
    if (this.imageElement) {
      this.imageElement.style.cursor = this.scale > MIN_SCALE ? 'grab' : 'zoom-in';
    }
  }

  updateDrag(pointerId, clientX, clientY) {
    if (!this.isOpen || this.activePointerId !== pointerId) {
      return false;
    }

    if (
      !this.didDrag
      && (Math.abs(clientX - this.dragStartX) >= DRAG_THRESHOLD_PX
        || Math.abs(clientY - this.dragStartY) >= DRAG_THRESHOLD_PX)
    ) {
      this.didDrag = true;
    }

    this.offsetX = this.dragOriginX + (clientX - this.dragStartX);
    this.offsetY = this.dragOriginY + (clientY - this.dragStartY);
    this.clampOffsets();
    this.syncTransform();
    return true;
  }

  getTrackedTouchPointers() {
    return Array.from(this.touchPointers.values());
  }

  getActivePinchPointers() {
    if (this.pinchPointerIds.length === 2) {
      const pinchPointers = this.pinchPointerIds
        .map((pointerId) => this.touchPointers.get(pointerId))
        .filter(Boolean);
      if (pinchPointers.length === 2) {
        return pinchPointers;
      }
    }

    return this.getTrackedTouchPointers().slice(0, 2);
  }

  startPinchGesture() {
    const [firstPointer, secondPointer] = this.getActivePinchPointers();
    if (!firstPointer || !secondPointer) {
      return false;
    }

    this.stopDrag();
    this.pinchPointerIds = [firstPointer.pointerId, secondPointer.pointerId];
    this.pinchStartDistance = Math.hypot(
      secondPointer.clientX - firstPointer.clientX,
      secondPointer.clientY - firstPointer.clientY,
    ) || 1;
    this.pinchStartScale = this.scale;
    this.pinchStartOffsetX = this.offsetX;
    this.pinchStartOffsetY = this.offsetY;
    const startCenter = this.getViewportPointFromClient(
      (firstPointer.clientX + secondPointer.clientX) / 2,
      (firstPointer.clientY + secondPointer.clientY) / 2,
    );
    this.pinchStartCenter = startCenter;
    return true;
  }

  updatePinchGesture() {
    const [firstPointer, secondPointer] = this.getActivePinchPointers();
    if (!firstPointer || !secondPointer) {
      return false;
    }

    const currentDistance = Math.hypot(
      secondPointer.clientX - firstPointer.clientX,
      secondPointer.clientY - firstPointer.clientY,
    );
    if (!Number.isFinite(currentDistance) || currentDistance <= 0) {
      return false;
    }

    const currentCenter = this.getViewportPointFromClient(
      (firstPointer.clientX + secondPointer.clientX) / 2,
      (firstPointer.clientY + secondPointer.clientY) / 2,
    );
    const nextScale = this.pinchStartScale * (currentDistance / this.pinchStartDistance);
    this.setScaleAroundViewportPoint(nextScale, this.pinchStartCenter, {
      originScale: this.pinchStartScale,
      originOffsetX: this.pinchStartOffsetX,
      originOffsetY: this.pinchStartOffsetY,
      targetViewportPoint: currentCenter,
    });

    if (
      !this.didDrag
      && (
        Math.abs(currentDistance - this.pinchStartDistance) >= DRAG_THRESHOLD_PX
        || Math.abs(currentCenter.x - this.pinchStartCenter.x) >= DRAG_THRESHOLD_PX
        || Math.abs(currentCenter.y - this.pinchStartCenter.y) >= DRAG_THRESHOLD_PX
      )
    ) {
      this.didDrag = true;
    }

    return true;
  }

  syncTouchGestureAfterPointerChange() {
    if (this.touchPointers.size >= 2) {
      this.startPinchGesture();
      return;
    }

    this.pinchPointerIds = [];
    this.pinchStartDistance = 0;

    if (this.touchPointers.size === 1 && this.scale > MIN_SCALE) {
      const [remainingPointer] = this.getTrackedTouchPointers();
      this.startDrag(remainingPointer.pointerId, remainingPointer.clientX, remainingPointer.clientY);
      return;
    }

    this.stopDrag();
  }

  clampOffsets() {
    if (!this.viewport || !this.imageElement) {
      this.offsetX = 0;
      this.offsetY = 0;
      return;
    }

    this.offsetX = clampImageLightboxOffset(this.offsetX, {
      contentSize: this.imageElement.offsetWidth || 0,
      scale: this.scale,
      viewportSize: this.viewport.clientWidth || 0,
    });
    this.offsetY = clampImageLightboxOffset(this.offsetY, {
      contentSize: this.imageElement.offsetHeight || 0,
      scale: this.scale,
      viewportSize: this.viewport.clientHeight || 0,
    });
  }

  syncTransform() {
    if (!this.imageElement) {
      return;
    }

    this.imageElement.style.transform = `translate3d(${this.offsetX}px, ${this.offsetY}px, 0) scale(${this.scale})`;
    this.imageElement.style.cursor = this.scale > MIN_SCALE ? 'grab' : 'zoom-in';
    if (this.zoomLabel) {
      this.zoomLabel.textContent = `${Math.round(this.scale * 100)}%`;
    }
    if (this.resetButton) {
      this.resetButton.disabled = this.scale <= MIN_SCALE && this.offsetX === 0 && this.offsetY === 0;
    }
  }

  ensureOverlayRoot() {
    if (this.overlayRoot?.isConnected && this.overlayRoot.parentElement === this.document.body) {
      return this.overlayRoot;
    }

    const overlayRoot = this.document.createElement('dialog');
    overlayRoot.className = 'image-lightbox-root';
    overlayRoot.dataset.imageLightboxRoot = 'true';
    overlayRoot.setAttribute('aria-labelledby', 'imageLightboxTitle');
    overlayRoot.addEventListener('cancel', (event) => {
      event.preventDefault();
      this.close();
    });

    const backdrop = this.document.createElement('button');
    backdrop.className = 'image-lightbox-backdrop';
    backdrop.type = 'button';
    backdrop.setAttribute('aria-label', 'Close image preview');
    backdrop.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.close();
    });

    const shell = this.document.createElement('div');
    shell.className = 'image-lightbox-shell';
    shell.addEventListener('click', (event) => event.stopPropagation());
    shell.addEventListener('pointerdown', (event) => event.stopPropagation());

    const toolbar = this.document.createElement('div');
    toolbar.className = 'image-lightbox-toolbar';

    const title = this.document.createElement('div');
    title.className = 'image-lightbox-title';
    title.id = 'imageLightboxTitle';
    title.textContent = 'Image preview';

    const controls = this.document.createElement('div');
    controls.className = 'image-lightbox-controls';

    const zoomOutButton = this.createControlButton('-', 'Zoom out', () => this.zoomBy(-ZOOM_STEP));
    const zoomLabel = this.document.createElement('span');
    zoomLabel.className = 'image-lightbox-zoom-label';
    zoomLabel.textContent = '100%';
    const zoomInButton = this.createControlButton('+', 'Zoom in', () => this.zoomBy(ZOOM_STEP));
    const resetButton = this.createControlButton('Reset', 'Reset zoom and position', () => this.resetView());
    const closeButton = this.createControlButton('Close', 'Close image preview', () => this.close());

    controls.append(zoomOutButton, zoomLabel, zoomInButton, resetButton, closeButton);
    toolbar.append(title, controls);

    const viewport = this.document.createElement('div');
    viewport.className = 'image-lightbox-viewport';

    const image = this.document.createElement('img');
    image.className = 'image-lightbox-image';
    image.alt = '';
    image.addEventListener('load', () => {
      this.clampOffsets();
      this.syncTransform();
    });

    viewport.addEventListener('wheel', (event) => {
      if (!this.isOpen) {
        return;
      }

      if (isImageLightboxWheelZoomGesture(event)) {
        event.preventDefault();
        this.zoomBy(event.deltaY < 0 ? ZOOM_STEP : -ZOOM_STEP);
        return;
      }

      if (this.scale <= MIN_SCALE) {
        return;
      }

      const deltaX = Number.isFinite(event.deltaX) ? event.deltaX : 0;
      const deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;
      if (deltaX === 0 && deltaY === 0) {
        return;
      }

      event.preventDefault();
      this.offsetX -= deltaX;
      this.offsetY -= deltaY;
      this.clampOffsets();
      this.syncTransform();
    }, { passive: false });

    viewport.addEventListener('pointerdown', (event) => {
      if (!this.isOpen) {
        return;
      }

      if (event.pointerType === 'touch') {
        if (this.touchPointers.size === 0) {
          this.didDrag = false;
        }
        this.touchPointers.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
        });
        this.capturePointer(event.pointerId);
        this.syncTouchGestureAfterPointerChange();
        if (this.touchPointers.size > 1 || this.scale > MIN_SCALE) {
          event.preventDefault();
        }
        return;
      }

      if (this.scale <= MIN_SCALE || event.button !== 0) {
        return;
      }

      this.didDrag = false;
      this.startDrag(event.pointerId, event.clientX, event.clientY);
      event.preventDefault();
    });

    viewport.addEventListener('pointermove', (event) => {
      if (!this.isOpen) {
        return;
      }

      if (event.pointerType === 'touch' && this.touchPointers.has(event.pointerId)) {
        this.touchPointers.set(event.pointerId, {
          clientX: event.clientX,
          clientY: event.clientY,
          pointerId: event.pointerId,
        });

        if (this.touchPointers.size >= 2) {
          this.updatePinchGesture();
          event.preventDefault();
          return;
        }

        if (this.updateDrag(event.pointerId, event.clientX, event.clientY)) {
          event.preventDefault();
        }
        return;
      }

      this.updateDrag(event.pointerId, event.clientX, event.clientY);
    });

    const finishPointerGesture = (event) => {
      if (event.pointerType === 'touch') {
        this.touchPointers.delete(event.pointerId);
        this.releasePointer(event.pointerId);
        if (this.activePointerId === event.pointerId) {
          this.stopDrag(event.pointerId);
        }
        this.syncTouchGestureAfterPointerChange();
        return;
      }

      if (this.activePointerId !== event.pointerId) {
        return;
      }

      this.stopDrag(event.pointerId);
    };

    viewport.addEventListener('pointerup', finishPointerGesture);
    viewport.addEventListener('pointercancel', finishPointerGesture);
    viewport.addEventListener('lostpointercapture', finishPointerGesture);
    image.addEventListener('click', (event) => {
      if (!this.isOpen) {
        return;
      }

      event.preventDefault();
      event.stopPropagation();
      if (this.didDrag) {
        this.didDrag = false;
        return;
      }

      if (this.scale <= MIN_SCALE) {
        this.setScale(CLICK_ZOOM_SCALE);
      }
    });

    viewport.appendChild(image);
    shell.append(toolbar, viewport);
    overlayRoot.append(backdrop, shell);
    this.document.body.appendChild(overlayRoot);

    this.overlayRoot = overlayRoot;
    this.viewport = viewport;
    this.imageElement = image;
    this.zoomLabel = zoomLabel;
    this.titleElement = title;
    this.resetButton = resetButton;
    this.syncTransform();
    return overlayRoot;
  }

  createControlButton(label, ariaLabel, onClick, {
    className = '',
  } = {}) {
    const button = this.document.createElement('button');
    button.className = `image-lightbox-btn ${className}`.trim();
    button.type = 'button';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    button.addEventListener('click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      onClick(event);
    });
    return button;
  }
}
