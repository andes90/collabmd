import {
  getVaultFileKind,
  isBaseFilePath,
  isDrawioFilePath,
  isExcalidrawFilePath,
  isImageAttachmentFilePath,
  isMermaidFilePath,
  isPdfFilePath,
  isPlantUmlFilePath,
  isStructurizrFilePath,
  stripVaultFileExtension,
} from '../../../domain/file-kind.js';

export const workspaceFeature = {
  isBaseFile: isBaseFilePath,
  isDrawioFile: isDrawioFilePath,
  isExcalidrawFile: isExcalidrawFilePath,
  isImageFile: isImageAttachmentFilePath,
  isPdfFile: isPdfFilePath,
  isMermaidFile: isMermaidFilePath,
  isPlantUmlFile: isPlantUmlFilePath,
  isStructurizrWorkspaceFile: isStructurizrFilePath,

  getPreviewSource() {
    const previewDocument = this.getStaticPreviewDocument?.();
    const previewFilePath = previewDocument?.currentFilePath ?? previewDocument?.filePath ?? null;
    if (previewDocument && previewFilePath && previewFilePath === this.currentFilePath) {
      if (this.isMermaidFile(this.currentFilePath)) {
        return this.workspacePreviewController.createDiagramPreviewDocument('mermaid', previewDocument.content);
      }

      if (this.isPlantUmlFile(this.currentFilePath)) {
        return this.workspacePreviewController.createDiagramPreviewDocument('plantuml', previewDocument.content);
      }

      return String(previewDocument.content ?? '');
    }

    return this.workspacePreviewController.getPreviewSource(this.currentFilePath, {
      drawioMode: this.currentDrawioMode ?? null,
    });
  },

  getStaticPreviewDocument() {
    return this._staticPreviewDocument ?? null;
  },

  setStaticPreviewDocument(document) {
    const normalizedFilePath = document?.filePath ?? document?.path ?? null;
    const normalizedCurrentFilePath = document?.currentFilePath ?? normalizedFilePath;
    this._staticPreviewDocument = document
      ? {
        content: String(document.content ?? ''),
        currentFilePath: normalizedCurrentFilePath,
        fileKind: document.fileKind ?? getVaultFileKind(normalizedFilePath),
        filePath: normalizedFilePath,
        hash: document.hash ?? null,
      }
      : null;
  },

  clearStaticPreviewDocument() {
    this._staticPreviewDocument = null;
  },

  supportsFileHistory(filePath) {
    const kind = getVaultFileKind(filePath);
    return kind !== null && kind !== 'image' && kind !== 'pdf';
  },

  getDisplayName(filePath) {
    return stripVaultFileExtension(String(filePath ?? '')
      .split('/')
      .pop());
  },

  handleLayoutViewRequest(view) {
    if (!this.currentFilePath || !this.isDrawioFile(this.currentFilePath)) {
      return true;
    }

    if (this.currentDrawioMode === 'text') {
      if (view !== 'preview') {
        return true;
      }

      if (this.layoutController.isMobileViewport?.()) {
        this.layoutController.primeView(view);
      }
      this.navigation.navigateToFile(this.currentFilePath);
      return false;
    }

    if (view === 'preview') {
      return true;
    }

    this.layoutController.primeView(view);
    this.navigation.navigateToFile(this.currentFilePath, { drawioMode: 'text' });
    return false;
  },

  renderBaseFilePreview(filePath, options) {
    clearTimeout(this._basePreviewRenderTimer);
    this._basePreviewRenderTimer = null;
    return this.workspacePreviewController.renderBaseFilePreview(filePath, options);
  },

  scheduleBaseFilePreview(filePath, options) {
    const loadToken = this.sessionLoadToken;
    clearTimeout(this._basePreviewRenderTimer);
    this._basePreviewRenderTimer = setTimeout(() => {
      this._basePreviewRenderTimer = null;
      if (filePath !== this.currentFilePath || loadToken !== this.sessionLoadToken) {
        return;
      }
      void this.renderBaseFilePreview(filePath, options);
    }, 180);
  },

  createResizeHandler() {
    return this.workspacePreviewController.createResizeHandler(() => this.restoreSidebarState());
  },

  initializePreviewLayoutObserver() {
    this._previewLayoutResizeObserver?.disconnect();
    this._previewLayoutResizeObserver = this.workspacePreviewController.initializePreviewLayoutObserver(
      () => this.schedulePreviewLayoutSync(),
    );
  },

  schedulePreviewLayoutSync(options) {
    this.workspacePreviewController.schedulePreviewLayoutSync(options);
  },

  handleEditorScrollActivityChange(isActive) {
    this.workspacePreviewController.handleEditorScrollActivityChange(isActive);
  },

  showEmptyState() {
    this.workspacePreviewController.resetPreviewLayoutSync();
    this.workspaceRouteController.showEmptyState();
  },

  showDiffState() {
    this.workspacePreviewController.resetPreviewLayoutSync();
    this.workspaceRouteController.showDiffState();
  },

};
