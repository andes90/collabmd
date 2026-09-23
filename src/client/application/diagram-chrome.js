import { setDiagramActionButtonIcon } from '../domain/diagram-action-icons.js';
import {
  rasterizeSvgMarkupToPngBlob,
  writeBlobToClipboard,
} from './diagram-preview-export.js';
import {
  easeOutCubic,
  getFrameViewportSize,
} from './preview-diagram-utils.js';
import { clamp } from '../domain/vault-utils.js';
import { downloadBlob } from '../browser-utils.js';

const DIAGRAM_CHROME_ZOOM = Object.freeze({
  animationDurationMs: 160,
  default: 1,
  max: 3,
  min: 0.1,
  step: 0.1,
  wheelSensitivity: 0.01,
});

const DIAGRAM_CHROME_ZOOM_POLICY = Object.freeze({
  mermaid: {
    ...DIAGRAM_CHROME_ZOOM,
    fitMax: DIAGRAM_CHROME_ZOOM.max,
    min: 0.5,
  },
  plantuml: {
    ...DIAGRAM_CHROME_ZOOM,
    fitMax: DIAGRAM_CHROME_ZOOM.default,
  },
});

const DIAGRAM_CHROME_KIND_CONFIG = Object.freeze({
  mermaid: {
    bodyClassName: 'mermaid-maximized-open',
    buttonClassName: 'mermaid-zoom-btn ui-preview-action',
    frameClassName: 'mermaid-frame diagram-preview-frame',
    maximizeButtonClassName: 'mermaid-maximize-btn',
    maximizedRootClassName: 'mermaid-maximized-root',
    maximizedRootDatasetKey: 'mermaidMaximizedRoot',
    toolbarClassName: 'mermaid-toolbar diagram-preview-toolbar',
    zoomLabelClassName: 'mermaid-zoom-label diagram-preview-zoom-label',
  },
  plantuml: {
    bodyClassName: 'plantuml-maximized-open',
    buttonClassName: 'plantuml-tool-btn ui-preview-action',
    frameClassName: 'plantuml-frame diagram-preview-frame',
    maximizeButtonClassName: 'plantuml-maximize-btn',
    maximizedRootClassName: 'plantuml-maximized-root',
    maximizedRootDatasetKey: 'plantumlMaximizedRoot',
    toolbarClassName: 'plantuml-toolbar diagram-preview-toolbar',
    zoomLabelClassName: 'plantuml-zoom-label diagram-preview-zoom-label',
  },
});

function getKindConfig(kind) {
  return DIAGRAM_CHROME_KIND_CONFIG[kind] ?? DIAGRAM_CHROME_KIND_CONFIG.mermaid;
}

function getKindZoomPolicy(kind) {
  return DIAGRAM_CHROME_ZOOM_POLICY[kind] ?? DIAGRAM_CHROME_ZOOM_POLICY.mermaid;
}

function isSvgElement(value) {
  return value instanceof SVGSVGElement;
}

export class DiagramChrome {
  constructor({
    documentRef = document,
    toastController = null,
    windowRef = window,
  } = {}) {
    this.document = documentRef;
    this.window = windowRef;
    this.toastController = toastController;
    this.activeMaximizedShell = null;
    this.maximizedRoots = new Map();
    this.resizeObservers = new Set();
    this.shellControllers = new WeakMap();
    this.shellViewStates = new WeakMap();
    this.shellRefits = new WeakMap();
  }

  destroy() {
    this.destroyAllShells();
    this.resizeObservers.forEach((observer) => observer.disconnect());
    this.resizeObservers.clear();
    this.maximizedRoots.forEach((root) => root.remove());
    this.maximizedRoots.clear();
    this.activeMaximizedShell = null;
    this.syncBodyMaximizedClasses();
  }

  destroyAllShells() {
    this.resizeObservers.forEach((observer) => observer.disconnect());
    this.resizeObservers.clear();
    this.activeMaximizedShell = null;
    this.syncBodyMaximizedClasses();
  }

  destroyShell(shell) {
    this.shellControllers.get(shell)?.destroy?.();
    this.shellControllers.delete(shell);
    this.shellViewStates.delete(shell);
    this.shellRefits.delete(shell);
    if (this.activeMaximizedShell === shell) {
      this.restoreShellMount(shell);
      this.activeMaximizedShell = null;
    }
    this.syncBodyMaximizedClasses();
  }

  captureShellViewState(shell) {
    const viewState = this.shellControllers.get(shell)?.getViewState?.() ?? null;
    if (viewState) {
      this.shellViewStates.set(shell, viewState);
    }
    return viewState;
  }

  getShellViewState(shell) {
    return this.shellViewStates.get(shell)
      ?? this.shellControllers.get(shell)?.getViewState?.()
      ?? null;
  }

  cancelActiveShell(kind) {
    const activeShell = this.syncActiveShell();
    if (!activeShell?.classList?.contains(`${kind}-shell`)) {
      return;
    }

    const controller = this.shellControllers.get(activeShell);
    this.restoreShellMount(activeShell);
    activeShell.classList.remove('is-maximized');
    this.activeMaximizedShell = null;
    controller?.syncMaximizeButtonState?.();
    controller?.scheduleResetZoomToFit?.({ force: true });
    this.syncBodyMaximizedClasses();
  }

  clearActiveShell() {
    this.activeMaximizedShell = null;
    this.maximizedRoots.forEach((root) => {
      if (root.childElementCount === 0) {
        root.hidden = true;
      }
    });
    this.syncBodyMaximizedClasses();
  }

  syncActiveShell() {
    if (
      this.activeMaximizedShell?.isConnected
      && this.activeMaximizedShell.classList.contains('is-maximized')
    ) {
      return this.activeMaximizedShell;
    }

    this.activeMaximizedShell = null;
    this.maximizedRoots.forEach((root) => {
      if (root.childElementCount === 0) {
        root.hidden = true;
      }
    });
    return null;
  }

  scheduleActiveRefit({ kind = null, root = null } = {}) {
    const activeShell = this.syncActiveShell();
    if (activeShell) {
      this.shellRefits.get(activeShell)?.({ force: true });
      return;
    }

    const selector = kind
      ? `.${kind}-shell[data-${kind}-hydrated="true"]`
      : '.mermaid-shell[data-mermaid-hydrated="true"], .plantuml-shell[data-plantuml-hydrated="true"]';
    Array.from(root?.querySelectorAll?.(selector) ?? []).forEach((shell) => {
      this.shellRefits.get(shell)?.();
    });
  }

  ensureMaximizedRoot(kind) {
    const config = getKindConfig(kind);
    const existing = this.maximizedRoots.get(kind);
    if (existing?.isConnected && existing.parentElement === this.document.body) {
      return existing;
    }

    const root = this.document.createElement('div');
    root.dataset[config.maximizedRootDatasetKey] = 'true';
    root.className = config.maximizedRootClassName;
    this.document.body.appendChild(root);

    this.maximizedRoots.set(kind, root);
    return root;
  }

  mountShellInMaximizedRoot(shell, kind) {
    const root = this.ensureMaximizedRoot(kind);
    root.hidden = false;
    shell._diagramChromeRestoreParent = shell.parentElement || null;
    shell._diagramChromeRestoreNextSibling = shell.nextSibling || null;
    root.appendChild(shell);
  }

  restoreShellMount(shell) {
    if (!shell) {
      return;
    }

    const restoreParent = shell._diagramChromeRestoreParent;
    const restoreNextSibling = shell._diagramChromeRestoreNextSibling;
    if (restoreParent?.isConnected) {
      if (restoreNextSibling?.parentElement === restoreParent) {
        restoreParent.insertBefore(shell, restoreNextSibling);
      } else {
        restoreParent.appendChild(shell);
      }
    }

    shell._diagramChromeRestoreParent = null;
    shell._diagramChromeRestoreNextSibling = null;

    this.maximizedRoots.forEach((root) => {
      if (root.childElementCount === 0) {
        root.hidden = true;
      }
    });
  }

  syncBodyMaximizedClasses() {
    for (const [kind, config] of Object.entries(DIAGRAM_CHROME_KIND_CONFIG)) {
      this.document.body.classList.toggle(
        config.bodyClassName,
        Boolean(this.document.querySelector?.(`.${kind}-shell.is-maximized`)),
      );
    }
  }

  createButton(kind, label, ariaLabel, { icon = '' } = {}) {
    const config = getKindConfig(kind);
    const button = this.document.createElement('button');
    button.type = 'button';
    button.className = config.buttonClassName;
    button.setAttribute('aria-label', ariaLabel);
    button.title = ariaLabel;
    if (icon) {
      setDiagramActionButtonIcon(button, icon);
    } else {
      button.textContent = label;
    }
    return button;
  }

  createToolbar({
    kind,
    includeReload = false,
  }) {
    const config = getKindConfig(kind);
    const toolbar = this.document.createElement('div');
    toolbar.className = config.toolbarClassName;
    const leftGroup = this.document.createElement('div');
    leftGroup.className = 'diagram-preview-toolbar-group';
    const rightGroup = this.document.createElement('div');
    rightGroup.className = 'diagram-preview-toolbar-group diagram-preview-toolbar-group--actions';

    const decreaseButton = this.createButton(kind, '−', 'Zoom out');
    const increaseButton = this.createButton(kind, '+', 'Zoom in');
    const resetButton = this.createButton(kind, '', 'Reset zoom', { icon: 'fit' });
    const copyButton = this.createButton(kind, '', 'Copy image', { icon: 'copy' });
    const downloadButton = this.createButton(kind, '', 'Download SVG', { icon: 'download' });
    const reloadButton = includeReload
      ? this.createButton(kind, '', 'Reload diagram', { icon: 'refresh' })
      : null;
    const maximizeButton = this.createButton(kind, '', 'Maximize diagram', { icon: 'maximize' });
    maximizeButton.classList.add(config.maximizeButtonClassName);
    const zoomLabel = this.document.createElement('span');
    zoomLabel.className = config.zoomLabelClassName;
    zoomLabel.setAttribute('aria-live', 'polite');

    leftGroup.append(decreaseButton, zoomLabel, resetButton, increaseButton);
    rightGroup.append(copyButton, downloadButton);
    if (reloadButton) {
      rightGroup.append(reloadButton);
    }
    rightGroup.append(maximizeButton);
    toolbar.append(leftGroup, rightGroup);

    return {
      copyButton,
      decreaseButton,
      downloadButton,
      increaseButton,
      maximizeButton,
      reloadButton,
      resetButton,
      toolbar,
      zoomLabel,
    };
  }

  attachShellResizeObserver(shell, frame, onResize) {
    if (typeof ResizeObserver !== 'function' || !shell?.isConnected || !(frame instanceof HTMLElement)) {
      return null;
    }

    const observer = new ResizeObserver(() => onResize());
    observer.observe(frame);
    observer.observe(shell);
    this.resizeObservers.add(observer);
    return observer;
  }

  async copyExportImage(exportSvgMarkup, exportFileNames) {
    try {
      const { pngFileName } = exportFileNames();
      const pngBlob = await rasterizeSvgMarkupToPngBlob(await exportSvgMarkup());
      try {
        await writeBlobToClipboard(pngBlob);
        this.toastController?.show?.('Diagram copied');
      } catch {
        downloadBlob(pngBlob, pngFileName);
        this.toastController?.show?.('Clipboard image copy is unavailable here. Downloaded PNG instead.');
      }
    } catch {
      this.toastController?.show?.('Failed to copy diagram');
    }
  }

  async downloadExportSvg(exportSvgMarkup, exportFileNames) {
    try {
      const { svgFileName } = exportFileNames();
      const svgBlob = new Blob([await exportSvgMarkup()], { type: 'image/svg+xml;charset=utf-8' });
      downloadBlob(svgBlob, svgFileName);
      this.toastController?.show?.('Diagram download started');
    } catch {
      this.toastController?.show?.('Failed to download diagram');
    }
  }

  syncMaximizeButtonState(shell, maximizeButton) {
    const isMaximized = shell.classList.contains('is-maximized');
    setDiagramActionButtonIcon(maximizeButton, isMaximized ? 'restore' : 'maximize');
    const label = isMaximized ? 'Restore diagram size' : 'Maximize diagram';
    maximizeButton.setAttribute('aria-label', label);
    maximizeButton.title = label;
  }

  setMaximizedState(shell, kind, maximizeButton, scheduleResetZoomToFit, shouldMaximize) {
    if (shouldMaximize) {
      const activeShell = this.syncActiveShell();
      if (activeShell && activeShell !== shell) {
        const activeController = this.shellControllers.get(activeShell);
        this.restoreShellMount(activeShell);
        activeShell.classList.remove('is-maximized');
        this.activeMaximizedShell = null;
        activeController?.scheduleResetZoomToFit?.({ force: true });
        activeController?.syncMaximizeButtonState?.();
      }

      this.mountShellInMaximizedRoot(shell, kind);
      shell.classList.add('is-maximized');
      this.activeMaximizedShell = shell;
      this.syncMaximizeButtonState(shell, maximizeButton);
      this.syncBodyMaximizedClasses();
      scheduleResetZoomToFit({ force: true });
      return;
    }

    this.restoreShellMount(shell);
    shell.classList.remove('is-maximized');
    if (this.activeMaximizedShell === shell) {
      this.activeMaximizedShell = null;
    }
    this.syncMaximizeButtonState(shell, maximizeButton);
    this.syncBodyMaximizedClasses();
    scheduleResetZoomToFit({ force: true });
  }

  mount(shell, {
    baseHeight,
    baseWidth,
    diagramElement,
    exportFileNames,
    exportSvgMarkup,
    kind,
    onReload = null,
    sourceSelector,
  } = {}) {
    if (!shell?.isConnected || !isSvgElement(diagramElement)) {
      return null;
    }

    const config = getKindConfig(kind);
    const zoomPolicy = getKindZoomPolicy(kind);
    const previousFrame = shell.querySelector(config.frameClassName.split(' ').map((name) => `.${name}`).join(''));
    const previousViewportWidth = previousFrame ? getFrameViewportSize(previousFrame).width : 0;
    const previousViewState = this.getShellViewState(shell);
    this.destroyShell(shell);
    const {
      copyButton,
      decreaseButton,
      downloadButton,
      increaseButton,
      maximizeButton,
      reloadButton,
      resetButton,
      toolbar,
      zoomLabel,
    } = this.createToolbar({
      includeReload: typeof onReload === 'function',
      kind,
    });
    const frame = this.document.createElement('div');
    frame.className = config.frameClassName;
    const shouldRestoreScrollPosition = Boolean(
      previousViewState
      && (previousViewState.scrollLeft > 0 || previousViewState.scrollTop > 0)
    );
    const shouldStageReplacement = Boolean(
      shouldRestoreScrollPosition
      && previousFrame?.isConnected
      && previousFrame.clientWidth > 0
      && previousFrame.clientHeight > 0
    );
    const shouldRestoreShellPosition = Boolean(
      shouldStageReplacement
      && !shell.classList.contains('is-maximized')
      && !shell.style.position
    );
    if (shouldRestoreShellPosition) {
      shell.style.position = 'relative';
    }
    if (shouldRestoreScrollPosition && !shouldStageReplacement) {
      frame.style.visibility = 'hidden';
    }
    if (shouldStageReplacement) {
      Object.assign(frame.style, {
        height: `${previousFrame.clientHeight}px`,
        left: '0',
        pointerEvents: 'none',
        position: 'absolute',
        top: '0',
        visibility: 'hidden',
        width: `${previousFrame.clientWidth}px`,
      });
    }

    let currentZoom = zoomPolicy.default;
    let zoomAnimationFrameId = null;
    let zoomAnimationTarget = null;
    let resetZoomFrameId = null;
    let replacementFrameId = null;
    let pinchState = null;
    let hasManualZoom = Boolean(
      previousViewState?.hasManualZoom
      || previousViewState?.scrollLeft > 0
      || previousViewState?.scrollTop > 0,
    );
    const hasInitialViewport = previousViewportWidth > 0 && Number.isFinite(baseWidth) && baseWidth > 0;
    const hasRestorableViewState = Number.isFinite(previousViewState?.zoom);
    let lastAutoFitViewportWidth = hasInitialViewport ? previousViewportWidth : 0;
    let shouldForceScheduledReset = false;

    diagramElement.style.maxWidth = 'none';

    const calculateDefaultZoom = () => {
      const viewport = getFrameViewportSize(frame);
      if (!Number.isFinite(baseWidth) || baseWidth <= 0 || viewport.width <= 0) {
        return zoomPolicy.default;
      }

      const fittedZoom = viewport.width / baseWidth;
      if (!Number.isFinite(fittedZoom) || fittedZoom <= 0) {
        return zoomPolicy.default;
      }

      return clamp(fittedZoom, zoomPolicy.min, zoomPolicy.fitMax);
    };

    const applyZoom = (nextZoom) => {
      currentZoom = clamp(nextZoom, zoomPolicy.min, zoomPolicy.max);
      diagramElement.style.width = `${baseWidth * currentZoom}px`;
      diagramElement.style.height = `${baseHeight * currentZoom}px`;

      zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;
      decreaseButton.disabled = currentZoom <= zoomPolicy.min;
      increaseButton.disabled = currentZoom >= zoomPolicy.max;

    };

    const initialZoom = hasRestorableViewState
      ? clamp(previousViewState.zoom, zoomPolicy.min, zoomPolicy.max)
      : hasInitialViewport
      ? clamp(previousViewportWidth / baseWidth, zoomPolicy.min, zoomPolicy.fitMax)
      : zoomPolicy.default;

    const getViewportCenter = () => ({
      x: frame.scrollLeft + (frame.clientWidth / 2),
      y: frame.scrollTop + (frame.clientHeight / 2),
    });

    const restoreViewportPoint = (previousZoom, nextZoom, contentPoint, viewportPoint) => {
      if (previousZoom === 0) {
        return;
      }

      const scale = nextZoom / previousZoom;
      frame.scrollLeft = (contentPoint.x * scale) - viewportPoint.x;
      frame.scrollTop = (contentPoint.y * scale) - viewportPoint.y;
    };

    const restoreViewportCenter = (previousZoom, nextZoom, center) => {
      restoreViewportPoint(previousZoom, nextZoom, center, {
        x: frame.clientWidth / 2,
        y: frame.clientHeight / 2,
      });
    };

    const animateZoomTo = (nextZoom) => {
      const targetZoom = clamp(nextZoom, zoomPolicy.min, zoomPolicy.max);
      if (zoomAnimationFrameId) {
        zoomAnimationTarget = targetZoom;
        return;
      }

      const startZoom = currentZoom;
      if (targetZoom === startZoom) {
        return;
      }

      zoomAnimationTarget = targetZoom;
      const center = getViewportCenter();
      const startedAt = performance.now();

      const tick = (now) => {
        const progress = clamp((now - startedAt) / zoomPolicy.animationDurationMs, 0, 1);
        const easedProgress = easeOutCubic(progress);
        const animatedZoom = startZoom + ((zoomAnimationTarget - startZoom) * easedProgress);
        applyZoom(animatedZoom);
        restoreViewportCenter(startZoom, animatedZoom, center);

        if (progress < 1) {
          zoomAnimationFrameId = this.window.requestAnimationFrame(tick);
          return;
        }

        zoomAnimationFrameId = null;
        const completedZoom = zoomAnimationTarget;
        zoomAnimationTarget = null;
        applyZoom(completedZoom);
        restoreViewportCenter(startZoom, completedZoom, center);
      };

      zoomAnimationFrameId = this.window.requestAnimationFrame(tick);
    };

    const cancelZoomAnimation = () => {
      if (zoomAnimationFrameId) {
        this.window.cancelAnimationFrame(zoomAnimationFrameId);
        zoomAnimationFrameId = null;
      }

      zoomAnimationTarget = null;
    };

    const zoomBy = (delta) => {
      hasManualZoom = true;
      animateZoomTo((zoomAnimationTarget ?? currentZoom) + delta);
    };

    const resetZoomToFit = () => {
      const defaultZoom = calculateDefaultZoom();
      hasManualZoom = false;
      lastAutoFitViewportWidth = getFrameViewportSize(frame).width;
      pinchState = null;
      cancelZoomAnimation();
      applyZoom(defaultZoom);
      frame.scrollLeft = 0;
      frame.scrollTop = 0;
    };

    const scheduleResetZoomToFit = ({ force = false } = {}) => {
      shouldForceScheduledReset = shouldForceScheduledReset || force;
      if (resetZoomFrameId) {
        this.window.cancelAnimationFrame(resetZoomFrameId);
      }

      resetZoomFrameId = this.window.requestAnimationFrame(() => {
        resetZoomFrameId = null;
        if (!shell.isConnected) {
          return;
        }

        const shouldForce = shouldForceScheduledReset;
        shouldForceScheduledReset = false;
        const viewportWidth = getFrameViewportSize(frame).width;
        const viewportChanged = Math.abs(viewportWidth - lastAutoFitViewportWidth) > 1;
        if (!shouldForce && hasManualZoom) {
          return;
        }
        if (!shouldForce && viewportWidth > 0 && lastAutoFitViewportWidth > 0 && !viewportChanged) {
          return;
        }

        resetZoomToFit();
      });
    };

    const resizeObserver = this.attachShellResizeObserver(shell, frame, () => scheduleResetZoomToFit());

    const getFrameViewportPoint = (clientX, clientY) => {
      const rect = frame.getBoundingClientRect();
      return {
        x: Number(clientX) - rect.left,
        y: Number(clientY) - rect.top,
      };
    };

    const getPinchGesture = (touches) => {
      if (!touches || touches.length !== 2) {
        return null;
      }

      const first = touches[0];
      const second = touches[1];
      const center = getFrameViewportPoint(
        (first.clientX + second.clientX) / 2,
        (first.clientY + second.clientY) / 2,
      );
      const distance = Math.hypot(
        second.clientX - first.clientX,
        second.clientY - first.clientY,
      );
      if (!Number.isFinite(distance) || distance <= 0) {
        return null;
      }

      return { center, distance };
    };

    const startPinch = (touches) => {
      const gesture = getPinchGesture(touches);
      if (!gesture) {
        return false;
      }

      cancelZoomAnimation();
      pinchState = {
        contentPoint: {
          x: frame.scrollLeft + gesture.center.x,
          y: frame.scrollTop + gesture.center.y,
        },
        distance: gesture.distance,
        zoom: currentZoom,
      };
      return true;
    };

    const updatePinch = (touches) => {
      const gesture = getPinchGesture(touches);
      if (!gesture) {
        return false;
      }
      if (!pinchState && !startPinch(touches)) {
        return false;
      }

      hasManualZoom = true;
      applyZoom(pinchState.zoom * (gesture.distance / pinchState.distance));
      restoreViewportPoint(
        pinchState.zoom,
        currentZoom,
        pinchState.contentPoint,
        gesture.center,
      );
      return true;
    };

    decreaseButton.addEventListener('click', () => zoomBy(-zoomPolicy.step));
    increaseButton.addEventListener('click', () => zoomBy(zoomPolicy.step));
    frame.addEventListener('wheel', (event) => {
      if (!event.ctrlKey) {
        return;
      }

      event.preventDefault();
      const deltaY = Number.isFinite(event.deltaY) ? event.deltaY : 0;
      const wheelDelta = clamp(
        -deltaY * zoomPolicy.wheelSensitivity,
        -zoomPolicy.step / 2,
        zoomPolicy.step / 2,
      );
      if (wheelDelta !== 0) {
        zoomBy(wheelDelta);
      }
    }, { passive: false });
    frame.addEventListener('touchstart', (event) => {
      if (event.touches.length === 2) {
        startPinch(event.touches);
      }
    }, { passive: true });
    frame.addEventListener('touchmove', (event) => {
      if (event.touches.length === 2 && updatePinch(event.touches)) {
        event.preventDefault();
      }
    }, { passive: false });
    const finishPinch = (event) => {
      if (event.touches.length !== 2) {
        pinchState = null;
      }
    };
    frame.addEventListener('touchend', finishPinch);
    frame.addEventListener('touchcancel', finishPinch);
    resetButton.addEventListener('click', () => {
      scheduleResetZoomToFit({ force: true });
    });
    copyButton.addEventListener('click', () => this.copyExportImage(exportSvgMarkup, exportFileNames));
    downloadButton.addEventListener('click', () => this.downloadExportSvg(exportSvgMarkup, exportFileNames));
    reloadButton?.addEventListener('click', () => onReload());
    maximizeButton.addEventListener('click', () => {
      this.setMaximizedState(
        shell,
        kind,
        maximizeButton,
        scheduleResetZoomToFit,
        !shell.classList.contains('is-maximized'),
      );
    });

    frame.appendChild(diagramElement);
    const sourceNode = sourceSelector ? shell.querySelector(sourceSelector) : null;
    const nextChildren = sourceNode ? [sourceNode, toolbar, frame] : [toolbar, frame];
    if (sourceNode) {
      sourceNode.hidden = true;
    }
    if (shouldStageReplacement) {
      shell.append(frame);
    } else {
      shell.replaceChildren(...nextChildren);
    }
    applyZoom(initialZoom);

    const restoreScrollPosition = () => {
      const maxScrollLeft = Math.max(0, frame.scrollWidth - frame.clientWidth);
      const maxScrollTop = Math.max(0, frame.scrollHeight - frame.clientHeight);
      const scrollLeft = clamp(previousViewState.scrollLeft ?? 0, 0, maxScrollLeft);
      const scrollTop = clamp(previousViewState.scrollTop ?? 0, 0, maxScrollTop);
      frame.scrollLeft = scrollLeft;
      frame.scrollTop = scrollTop;
      return frame.clientWidth > 0
        && frame.clientHeight > 0
        && frame.scrollLeft === scrollLeft
        && frame.scrollTop === scrollTop;
    };

    if (shouldStageReplacement) {
      restoreScrollPosition();
      replacementFrameId = this.window.requestAnimationFrame(() => {
        replacementFrameId = null;
        shell.replaceChildren(...nextChildren);
        frame.removeAttribute('style');
        if (shouldRestoreShellPosition) {
          shell.style.position = '';
        }
        applyZoom(initialZoom);
        restoreScrollPosition();
      });
    } else if (shouldRestoreScrollPosition) {
      if (!restoreScrollPosition()) {
        this.window.requestAnimationFrame(() => {
          if (frame.isConnected) {
            restoreScrollPosition();
            frame.style.visibility = '';
          }
        });
      } else {
        frame.style.visibility = '';
      }
    }

    const controller = {
      destroy: () => {
        if (zoomAnimationFrameId) {
          this.window.cancelAnimationFrame(zoomAnimationFrameId);
        }
        if (resetZoomFrameId) {
          this.window.cancelAnimationFrame(resetZoomFrameId);
        }
        if (replacementFrameId) {
          this.window.cancelAnimationFrame(replacementFrameId);
        }
        resizeObserver?.disconnect?.();
        this.resizeObservers.delete(resizeObserver);
      },
      getViewState: () => ({
        hasManualZoom,
        scrollLeft: frame.scrollLeft,
        scrollTop: frame.scrollTop,
        zoom: currentZoom,
      }),
      scheduleResetZoomToFit,
      syncMaximizeButtonState: () => this.syncMaximizeButtonState(shell, maximizeButton),
    };

    this.shellControllers.set(shell, controller);
    this.shellRefits.set(shell, scheduleResetZoomToFit);
    this.syncMaximizeButtonState(shell, maximizeButton);
    if (!hasInitialViewport && !hasRestorableViewState) {
      scheduleResetZoomToFit({ force: true });
    }
    return controller;
  }
}
