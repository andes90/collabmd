import {
  isDiagramFilePath,
  isMarkdownFilePath,
} from '../../domain/file-kind.js';

export class WorkspacePreviewController {
  constructor({
    backlinksPanel,
    elements,
    excalidrawEmbed,
    getDisplayName,
    getSession,
    isExcalidrawFile,
    isMermaidFile,
    isPlantUmlFile,
    layoutController,
    outlineController,
    previewRenderer,
    schedulePreviewLayoutSync,
    scrollSyncController,
  }) {
    this.backlinksPanel = backlinksPanel;
    this.elements = elements;
    this.excalidrawEmbed = excalidrawEmbed;
    this.getDisplayName = getDisplayName;
    this.getSession = getSession;
    this.isExcalidrawFile = isExcalidrawFile;
    this.isMermaidFile = isMermaidFile;
    this.isPlantUmlFile = isPlantUmlFile;
    this.layoutController = layoutController;
    this.outlineController = outlineController;
    this.previewRenderer = previewRenderer;
    this.schedulePreviewLayoutSyncCallback = schedulePreviewLayoutSync;
    this.scrollSyncController = scrollSyncController;
  }

  createDiagramPreviewDocument(language, source = '') {
    const text = String(source ?? '');
    const longestFence = Math.max(...(text.match(/`+/g)?.map((fence) => fence.length) ?? [0]));
    const fence = '`'.repeat(Math.max(3, longestFence + 1));
    return `${fence}${language}\n${text}\n${fence}`;
  }

  getPreviewSource(filePath) {
    const source = this.getSession()?.getText() ?? '';
    if (this.isMermaidFile(filePath)) {
      return this.createDiagramPreviewDocument('mermaid', source);
    }

    if (this.isPlantUmlFile(filePath)) {
      return this.createDiagramPreviewDocument('plantuml', source);
    }

    return source;
  }

  resetPreviewMode() {
    this.elements.previewContent?.classList.remove('is-excalidraw-file-preview');
    this.elements.previewContent?.classList.remove('is-mermaid-file-preview');
    this.elements.previewContent?.classList.remove('is-plantuml-file-preview');
  }

  syncFileChrome(filePath) {
    const isExcalidraw = this.isExcalidrawFile(filePath);
    const isMarkdown = isMarkdownFilePath(filePath);
    const isMermaid = this.isMermaidFile(filePath);
    const isPlantUml = this.isPlantUmlFile(filePath);
    const isDiagramFile = isDiagramFilePath(filePath);

    this.elements.markdownToolbar?.classList.toggle('hidden', !isMarkdown);
    this.elements.outlineToggle?.classList.toggle('hidden', isDiagramFile);
    this.elements.previewContent?.classList.toggle('is-mermaid-file-preview', isMermaid);
    this.elements.previewContent?.classList.toggle('is-plantuml-file-preview', isPlantUml);

    if (isExcalidraw) {
      this.layoutController.setView('preview');
      this.outlineController.close();
      this.backlinksPanel.clear();
      return;
    }

    if (isMermaid || isPlantUml) {
      this.outlineController.close();
      this.backlinksPanel.clear();
    }
  }

  renderExcalidrawFilePreview(filePath) {
    const previewElement = this.elements.previewContent;
    if (!previewElement) {
      return;
    }

    this.excalidrawEmbed.detachForCommit();
    this.resetPreviewMode();
    previewElement.classList.add('is-excalidraw-file-preview');
    const renderHost = this.previewRenderer.ensureRenderHost();
    this.previewRenderer.normalizePreviewChildren(renderHost);

    const placeholder = document.createElement('div');
    placeholder.className = 'excalidraw-embed-placeholder';
    placeholder.dataset.embedKey = `${filePath}#file-preview`;
    placeholder.dataset.embedLabel = this.getDisplayName(filePath);
    placeholder.dataset.embedTarget = filePath;
    const loadingShell = document.createElement('div');
    loadingShell.className = 'preview-shell';
    loadingShell.textContent = 'Loading Excalidraw preview…';
    placeholder.appendChild(loadingShell);
    if (renderHost) {
      renderHost.replaceChildren(placeholder);
      renderHost.style.minHeight = '';
    }

    previewElement.dataset.renderPhase = 'ready';
    this.outlineController.refresh();
    this.scrollSyncController.setLargeDocumentMode(false);
    this.scrollSyncController.invalidatePreviewBlocks();
    this.excalidrawEmbed.reconcileEmbeds(previewElement, { isLargeDocument: false });
    this.excalidrawEmbed.hydrateVisibleEmbeds();
    this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
  }

  createResizeHandler(restoreSidebarState) {
    let resizeTimer = null;
    return () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => {
        restoreSidebarState?.();
        this.schedulePreviewLayoutSyncCallback({ delayMs: 0 });
      }, 100);
    };
  }

  initializePreviewLayoutObserver(onSchedule = () => {}) {
    if (typeof ResizeObserver !== 'function' || !this.elements.previewContent) {
      return null;
    }

    const observer = new ResizeObserver(() => {
      onSchedule();
    });
    observer.observe(this.elements.previewContent);
    return observer;
  }

  schedulePreviewLayoutSync({
    hydrationPaused,
    previewLayoutSyncTimer,
    setPendingPreviewLayoutSync,
    setPreviewLayoutSyncTimer,
    delayMs = 120,
  }) {
    if (hydrationPaused) {
      setPendingPreviewLayoutSync(true);
      return;
    }

    clearTimeout(previewLayoutSyncTimer);

    const nextTimer = setTimeout(() => {
      setPreviewLayoutSyncTimer(null);

      const hasSession = Boolean(this.getSession());
      const isExcalidrawPreview = this.elements.previewContent?.classList?.contains?.('is-excalidraw-file-preview') ?? false;
      if ((!hasSession && !isExcalidrawPreview) || !this.elements.previewContent) {
        return;
      }

      if (this.elements.previewContent.dataset.renderPhase === 'shell') {
        return;
      }

      if (hydrationPaused) {
        setPendingPreviewLayoutSync(true);
        return;
      }

      this.previewRenderer.scheduleActiveMermaidRefit();
      this.previewRenderer.scheduleActivePlantUmlRefit();
      this.excalidrawEmbed.syncLayout();
      if (isExcalidrawPreview && !hasSession) {
        return;
      }

      this.scrollSyncController.invalidatePreviewBlocks();
      this.scrollSyncController.warmPreviewBlocks({
        onReady: () => {
          if (!this.getSession()) {
            return;
          }

          this.scrollSyncController.realignAfterLayoutChange();
          this.outlineController.scheduleActiveHeadingUpdate();
        },
      });
    }, delayMs);

    setPreviewLayoutSyncTimer(nextTimer);
  }

  handleEditorScrollActivityChange({
    isActive,
    pendingPreviewLayoutSync,
    previewLayoutSyncTimer,
    setHydrationPaused,
    setPendingPreviewLayoutSync,
    setPreviewLayoutSyncTimer,
  }) {
    const nextPaused = Boolean(isActive);
    setHydrationPaused(nextPaused);
    this.previewRenderer.setHydrationPaused(nextPaused);
    this.excalidrawEmbed.setHydrationPaused(nextPaused);

    if (nextPaused) {
      clearTimeout(previewLayoutSyncTimer);
      setPreviewLayoutSyncTimer(null);
      setPendingPreviewLayoutSync(true);
      return;
    }

    if (pendingPreviewLayoutSync) {
      setPendingPreviewLayoutSync(false);
      this.schedulePreviewLayoutSync({
        delayMs: 0,
        hydrationPaused: false,
        previewLayoutSyncTimer: null,
        setPendingPreviewLayoutSync,
        setPreviewLayoutSyncTimer,
      });
    }
  }
}
