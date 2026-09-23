import {
  cancelIdleRender,
  createDiagramErrorPlaceholderCard,
  IDLE_RENDER_TIMEOUT_MS,
  isNearViewport,
  requestIdleRender,
  shouldPreserveHydratedDiagram,
  syncAttribute,
  normalizeDiagramError,
} from './preview-diagram-utils.js';

function datasetKeyToAttributeName(datasetKey) {
  return `data-${datasetKey.replace(/[A-Z]/g, (match) => `-${match.toLowerCase()}`)}`;
}

export class DiagramPreviewHydrator {
  constructor(renderer, {
    batchSize,
    datasetKeys,
    loadFileSource = null,
    filePathLabel,
    requestIdleRenderFn = requestIdleRender,
    cancelIdleRenderFn = cancelIdleRender,
    intersectionObserverFactory = (callback, options) => new IntersectionObserver(callback, options),
    isNearViewportFn = isNearViewport,
    requestAnimationFrameFn = (callback) => requestAnimationFrame(callback),
    shellClassName,
    sourceClassName,
  }) {
    this.renderer = renderer;
    this.batchSize = batchSize;
    this.datasetKeys = datasetKeys;
    this.loadFileSource = loadFileSource;
    this.filePathLabel = filePathLabel;
    this.requestIdleRenderFn = requestIdleRenderFn;
    this.cancelIdleRenderFn = cancelIdleRenderFn;
    this.intersectionObserverFactory = intersectionObserverFactory;
    this.isNearViewportFn = isNearViewportFn;
    this.requestAnimationFrameFn = requestAnimationFrameFn;
    this.shellClassName = shellClassName;
    this.sourceClassName = sourceClassName;
    this.shellSelector = `.${shellClassName}`;
    this.sourceSelector = `.${sourceClassName}`;
    this.attributeNames = Object.fromEntries(
      Object.entries(datasetKeys).map(([name, datasetKey]) => [name, datasetKeyToAttributeName(datasetKey)]),
    );

    this.observer = null;
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
    this.hydrationToken = 0;
    this.hydrationRenderVersion = null;
    this.instanceCounter = 0;
    this.preservedShells = [];
    this.fileInflightRequests = new Map();
  }

  destroy() {
    this.cancelHydration();
    this.clearPreservedShells();
  }

  cancelHydration() {
    this.hydrationToken += 1;
    this.hydrationRenderVersion = null;
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }

    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
    this.pendingShells = [];
    this.hydrationInProgress = false;
  }

  cancelPendingIdleWork() {
    this.cancelIdleRenderFn(this.idleId);
    this.idleId = null;
  }

  clearPreservedShells() {
    this.preservedShells.forEach(({ shell }) => {
      this.renderer.diagramChrome?.destroyShell?.(shell);
    });
    this.preservedShells.length = 0;
  }

  getPreviewShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return [];
    }

    const shells = Array.from(previewElement.querySelectorAll(this.shellSelector));
    const maximizedShell = this.renderer.diagramChrome?.syncActiveShell?.();
    if (maximizedShell?.classList.contains(this.shellClassName) && !shells.includes(maximizedShell)) {
      shells.push(maximizedShell);
    }
    return shells;
  }

  getPreservationIdentity(shell) {
    const sourceLine = shell?.getAttribute?.(this.attributeNames.sourceLine);
    // ponytail: source-line identity can miss blocks shifted by earlier edits.
    // Upgrade to persistent block IDs if structural tracking becomes necessary.
    return sourceLine ? `${this.shellClassName}:${sourceLine}` : null;
  }

  isShellRenderable(shell) {
    return this.isShellHydrated(shell) || shell?.getAttribute?.('data-diagram-output') === 'true';
  }

  isShellError(shell) {
    return shell?.getAttribute?.('data-diagram-state') === 'error';
  }

  hasPendingWork() {
    return this.hydrationInProgress || this.pendingShells.length > 0;
  }

  preserveHydratedShellsForCommit() {
    this.preservedShells.length = 0;
    const previewElement = this.renderer.previewElement;
    if (!previewElement) {
      return;
    }

    this.getPreviewShells().filter((shell) => this.isShellRenderable(shell)).forEach((shell) => {
      const key = shell.dataset[this.datasetKeys.key];
      const source = shell.querySelector(this.sourceSelector)?.textContent ?? '';
      const target = shell.dataset[this.datasetKeys.target] ?? '';
      if (!key || (!source && !target)) {
        return;
      }

      if (shell.isConnected) {
        this.renderer.diagramChrome?.captureShellViewState?.(shell);
        shell.remove();
      }

      this.preservedShells.push({
        key,
        identity: this.getPreservationIdentity(shell),
        shell,
        source,
        target,
      });
    });
  }

  reconcileHydratedShells() {
    const previewElement = this.renderer.previewElement;
    if (!previewElement || this.preservedShells.length === 0) {
      this.clearPreservedShells();
      return;
    }

    let restoredMaximizedShell = false;
    Array.from(previewElement.querySelectorAll(`${this.shellSelector}[${this.attributeNames.key}]`)).forEach((nextShell) => {
      const key = nextShell.dataset[this.datasetKeys.key];
      let preservedIndex = key
        ? this.preservedShells.findIndex((entry) => entry.key === key)
        : -1;
      if (preservedIndex === -1) {
        const identity = this.getPreservationIdentity(nextShell);
        // ponytail: diagram counts are small; index entries if reconciliation becomes measurable.
        preservedIndex = identity
          ? this.preservedShells.findIndex((entry) => entry.identity === identity)
          : -1;
      }
      if (preservedIndex === -1) {
        return;
      }
      const preservedEntry = this.preservedShells[preservedIndex];

      const nextSource = nextShell.querySelector(this.sourceSelector)?.textContent ?? '';
      const nextTarget = nextShell.dataset[this.datasetKeys.target] ?? '';
      const canPreserveCurrentOutput = this.isShellRenderable(preservedEntry.shell)
        && nextSource !== preservedEntry.source
        && !nextTarget;
      if (!shouldPreserveHydratedDiagram({
        nextSource,
        nextTarget,
        preservedSource: preservedEntry.source,
        preservedTarget: preservedEntry.target,
      }) && !canPreserveCurrentOutput) {
        return;
      }

      this.syncPreservedShell(preservedEntry.shell, nextShell, {
        sourceChanged: canPreserveCurrentOutput,
      });
      nextShell.replaceWith(preservedEntry.shell);
      const viewState = this.renderer.diagramChrome?.getShellViewState?.(preservedEntry.shell);
      const frame = preservedEntry.shell.querySelector('.diagram-preview-frame');
      if (viewState && frame) {
        frame.scrollLeft = viewState.scrollLeft ?? 0;
        frame.scrollTop = viewState.scrollTop ?? 0;
      }
      restoredMaximizedShell = restoredMaximizedShell || preservedEntry.shell.classList.contains('is-maximized');
      this.preservedShells.splice(preservedIndex, 1);
    });

    this.preservedShells.forEach(({ shell }) => {
      this.renderer.diagramChrome?.destroyShell?.(shell);
    });
    this.preservedShells.length = 0;
    this.handleReconcile({ restoredMaximizedShell });
  }

  handleReconcile() {}

  syncPreservedShell(preservedShell, nextShell, { sourceChanged = false } = {}) {
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceLine);
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceLineEnd);
    syncAttribute(preservedShell, nextShell, this.attributeNames.key);
    syncAttribute(preservedShell, nextShell, this.attributeNames.target);
    syncAttribute(preservedShell, nextShell, this.attributeNames.label);
    syncAttribute(preservedShell, nextShell, this.attributeNames.sourceHash);

    preservedShell.classList.add(this.shellClassName);
    this.removeDatasetValue(preservedShell, 'queued');

    const nextSourceNode = nextShell.querySelector(this.sourceSelector);
    let preservedSourceNode = preservedShell.querySelector(this.sourceSelector);

    if (!preservedSourceNode && nextSourceNode) {
      preservedSourceNode = nextSourceNode.cloneNode(true);
      preservedShell.prepend(preservedSourceNode);
    }

    if (preservedSourceNode && nextSourceNode) {
      const nextSource = nextSourceNode.textContent ?? '';
      if (nextSource || !nextShell.dataset[this.datasetKeys.target]) {
        preservedSourceNode.textContent = nextSource;
      }
      preservedSourceNode.hidden = true;
    }

    if (sourceChanged) {
      this.markShellPending(preservedShell);
      return;
    }

    if (this.isShellError(preservedShell)) {
      preservedShell.dataset[this.datasetKeys.hydrated] = 'true';
      return;
    }

    this.markShellHydrated(preservedShell);
  }

  getShellErrorCard(shell) {
    return shell?.querySelector?.(':scope > .diagram-preview-error-card') ?? null;
  }

  notifyShellLayoutChange() {
    this.renderer.onPreviewLayoutChange?.({
      renderVersion: this.renderer.activeRenderVersion,
    });
  }

  clearShellErrorCard(shell) {
    if (!shell) {
      return;
    }

    this.getShellErrorCard(shell)?.remove?.();
    this.notifyShellLayoutChange();
  }

  getShellLabel(shell) {
    return shell?.dataset?.[this.datasetKeys.label] || `${this.filePathLabel} diagram`;
  }

  markShellRendered(shell) {
    if (!shell) {
      return;
    }

    shell.setAttribute('data-diagram-output', 'true');
    shell.removeAttribute('data-diagram-state');
    shell.removeAttribute('aria-busy');
    this.clearShellErrorCard(shell);
  }

  markShellPending(shell) {
    if (!this.isShellRenderable(shell)) {
      return false;
    }

    this.removeDatasetValue(shell, 'hydrated');
    shell.setAttribute('data-diagram-output', 'true');
    shell.setAttribute('data-diagram-state', 'pending');
    shell.setAttribute('aria-busy', 'true');
    if (this.getShellErrorCard(shell)) {
      this.clearShellErrorCard(shell);
    }
    return true;
  }

  markShellError(shell, error) {
    if (!this.isShellRenderable(shell)) {
      return false;
    }

    const message = normalizeDiagramError(error);
    shell.dataset[this.datasetKeys.hydrated] = 'true';
    shell.setAttribute('data-diagram-output', 'true');
    shell.setAttribute('data-diagram-state', 'error');
    shell.removeAttribute('aria-busy');
    this.getShellErrorCard(shell)?.remove?.();
    const kind = this.shellClassName.replace(/-shell$/, '');
    shell.append(createDiagramErrorPlaceholderCard({
      key: shell.dataset[this.datasetKeys.key],
      kind,
      label: this.getShellLabel(shell),
      message,
      subtitle: 'Showing the last valid result.',
    }));
    this.notifyShellLayoutChange();
    return true;
  }

  clearShellOutput(shell) {
    this.removeDatasetValue(shell, 'hydrated');
    shell?.removeAttribute?.('data-diagram-output');
    shell?.removeAttribute?.('data-diagram-state');
    shell?.removeAttribute?.('aria-busy');
    this.clearShellErrorCard(shell);
  }

  markPending() {
    this.cancelHydration();
    this.getPreviewShells().filter((shell) => this.isShellRenderable(shell)).forEach((shell) => {
      this.markShellPending(shell);
    });
  }

  retryShell(shell) {
    if (!shell?.isConnected) {
      return;
    }

    this.removeDatasetValue(shell, 'hydrated');
    this.markShellPending(shell);
    this.enqueueShell(shell, { prioritize: true });
  }

  isHydrationCurrent(renderVersion, shell, hydrationToken = this.hydrationToken) {
    return Boolean(
      shell?.isConnected
      && hydrationToken === this.hydrationToken
      && (renderVersion == null
        || (renderVersion === this.hydrationRenderVersion
          && renderVersion === this.renderer.activeRenderVersion)),
    );
  }

  setupHydration(renderVersion) {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (!previewElement || !previewContainer) {
      return 0;
    }

    const shells = Array.from(previewElement.querySelectorAll(this.shellSelector));
    if (shells.length === 0) {
      return 0;
    }

    this.hydrationToken += 1;
    const hydrationToken = this.hydrationToken;
    this.hydrationRenderVersion = renderVersion;

    this.observer = this.intersectionObserverFactory((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) {
          return;
        }

        this.enqueueShell(entry.target);
      });
    }, {
      root: previewContainer,
      rootMargin: this.renderer.isLargeDocument ? '180px 0px' : '420px 0px',
    });

    shells.forEach((shell) => this.observer.observe(shell));

    this.requestAnimationFrameFn(() => {
      if (!this.isHydrationCurrent(renderVersion, previewElement, hydrationToken)) {
        return;
      }

      this.hydrateVisibleShells();
      this.renderer.updateHydrationPhase();
    });

    return shells.length;
  }

  hydrateVisibleShells() {
    const previewElement = this.renderer.previewElement;
    const previewContainer = this.renderer.previewContainer;
    if (this.renderer.hydrationPaused || !previewElement || !previewContainer) {
      return;
    }

    if (this.observer && typeof IntersectionObserver !== 'undefined') {
      Array.from(previewElement.querySelectorAll(this.shellSelector)).forEach((shell) => {
        this.observer.observe(shell);
      });
      return;
    }

    const margin = this.renderer.isLargeDocument ? 180 : 420;
    Array.from(previewElement.querySelectorAll(this.shellSelector)).forEach((shell) => {
      if (this.isNearViewportFn(shell, previewContainer, margin)) {
        this.enqueueShell(shell, { prioritize: true });
      }
    });
  }

  enqueueShell(shell, { prioritize = false } = {}) {
    if (!shell?.isConnected || this.isShellHydrated(shell) || this.isShellQueued(shell)) {
      return;
    }

    shell.dataset[this.datasetKeys.queued] = 'true';
    if (prioritize) {
      this.pendingShells.unshift(shell);
    } else {
      this.pendingShells.push(shell);
    }

    if (this.renderer.hydrationPaused) {
      return;
    }

    this.renderer.updateHydrationPhase();
    this.scheduleHydration();
  }

  scheduleHydration() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress || this.idleId !== null) {
      return;
    }

    this.idleId = this.requestIdleRenderFn(() => {
      this.idleId = null;
      void this.flushHydrationQueue();
    }, IDLE_RENDER_TIMEOUT_MS);
  }

  async flushHydrationQueue() {
    if (this.renderer.hydrationPaused || this.hydrationInProgress) {
      return;
    }

    const hydrationToken = this.hydrationToken;
    const renderVersion = this.hydrationRenderVersion;

    const shells = [];
    while (this.pendingShells.length > 0 && shells.length < this.batchSize) {
      const nextShell = this.pendingShells.shift();
      if (!nextShell?.isConnected || this.isShellHydrated(nextShell)) {
        continue;
      }

      this.removeDatasetValue(nextShell, 'queued');
      shells.push(nextShell);
    }

    if (shells.length === 0) {
      this.renderer.updateHydrationPhase();
      return;
    }

    this.hydrationInProgress = true;
    this.renderer.setPhase('hydrating');

    let batchContext;
    try {
      batchContext = await this.prepareHydrationBatch(shells);
    } catch (error) {
      if (hydrationToken !== this.hydrationToken) {
        return;
      }
      this.handlePrepareHydrationBatchError(shells, error);
      this.hydrationInProgress = false;
      this.renderer.updateHydrationPhase();
      return;
    }

    for (const shell of shells) {
      if (hydrationToken !== this.hydrationToken) {
        return;
      }
      await this.hydrateShell(shell, batchContext, { hydrationToken, renderVersion });
    }

    if (hydrationToken !== this.hydrationToken) {
      return;
    }
    this.hydrationInProgress = false;

    if (this.pendingShells.length > 0) {
      this.scheduleHydration();
    }

    this.renderer.updateHydrationPhase();
  }

  async prepareHydrationBatch() {
    return null;
  }

  handlePrepareHydrationBatchError(_shells, _error) {}

  async hydrateShell() {
    throw new Error('hydrateShell must be implemented by subclasses');
  }

  markShellHydrated(shell) {
    this.markShellRendered(shell);
    shell.dataset[this.datasetKeys.hydrated] = 'true';
    shell.dataset[this.datasetKeys.instanceId] = String(++this.instanceCounter);
  }

  isShellHydrated(shell) {
    return shell?.dataset?.[this.datasetKeys.hydrated] === 'true';
  }

  removeDatasetValue(shell, name) {
    const datasetKey = this.datasetKeys[name];
    if (!datasetKey || !shell) {
      return;
    }

    shell.removeAttribute?.(this.attributeNames[name]);
    if (shell.dataset) {
      delete shell.dataset[datasetKey];
    }
  }

  isShellQueued(shell) {
    return shell?.dataset?.[this.datasetKeys.queued] === 'true';
  }

  async fetchSource(filePath) {
    const target = String(filePath ?? '').trim();
    if (!target) {
      throw new Error(`Missing ${this.filePathLabel} file path`);
    }

    if (this.fileInflightRequests.has(target)) {
      return this.fileInflightRequests.get(target);
    }

    if (typeof this.loadFileSource !== 'function') {
      throw new Error(`Missing ${this.filePathLabel} source loader`);
    }

    const request = this.loadFileSource(target)
      .finally(() => {
        this.fileInflightRequests.delete(target);
      });

    this.fileInflightRequests.set(target, request);
    return request;
  }
}
