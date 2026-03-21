export class LayoutController {
  constructor({ mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'), onMeasureEditor }) {
    this.mobileBreakpointQuery = mobileBreakpointQuery;
    this.onMeasureEditor = onMeasureEditor;
    this.preferredView = 'split';
    this.mobileShowsEditor = !this.isMobileViewport();
    this.currentView = this.mobileShowsEditor ? this.preferredView : 'preview';
    this.editorLayout = document.getElementById('editorLayout');
    this.editorPane = document.getElementById('editorPane');
    this.previewPane = document.getElementById('previewPane');
    this.mobileToggleButton = document.getElementById('mobileViewToggle');
    this.resizer = document.getElementById('resizer');
    this.viewButtons = Array.from(document.querySelectorAll('.view-btn'));
  }

  isMobileViewport() {
    return this.mobileBreakpointQuery.matches;
  }

  initialize() {
    this.viewButtons.forEach((button) => {
      button.addEventListener('click', () => this.setView(button.dataset.view));
    });

    this.mobileToggleButton?.addEventListener('click', () => this.toggleMobileView());
    this.initializeResizer();
    this.restorePreferredView();
  }

  reset() {
    this.restorePreferredView();

    if (this.editorPane) {
      this.editorPane.style.flex = '';
    }

    if (this.previewPane) {
      this.previewPane.style.flex = '';
    }

    this.updateResizerValue();
  }

  restorePreferredView() {
    const nextView = this.isMobileViewport()
      ? (this.mobileShowsEditor ? 'split' : 'preview')
      : this.preferredView;

    this.applyView(nextView);
    this.updateMobileToggleButton(this.mobileShowsEditor ? 'Preview' : 'Editor');
  }

  applyView(view) {
    this.currentView = view;
    this.editorLayout?.setAttribute('data-view', view);
    this.syncViewButtons();
  }

  setView(view, { persist = true } = {}) {
    if (!view) {
      return;
    }

    if (persist) {
      this.preferredView = view;
    }

    this.applyView(view);

    if (view === 'split' || view === 'editor') {
      this.scheduleEditorMeasure();
    }
  }

  toggleMobileView() {
    this.mobileShowsEditor = !this.mobileShowsEditor;
    this.applyView(this.mobileShowsEditor ? 'split' : 'preview');
    this.updateMobileToggleButton(this.mobileShowsEditor ? 'Preview' : 'Editor');

    if (this.mobileShowsEditor) {
      this.scheduleEditorMeasure();
    }
  }

  scheduleEditorMeasure() {
    if (!this.onMeasureEditor) {
      return;
    }

    setTimeout(() => this.onMeasureEditor(), 50);
  }

  updateMobileToggleButton(label) {
    if (!this.mobileToggleButton) {
      return;
    }

    const previewIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/><circle cx="12" cy="12" r="3"/></svg>';
    const editorIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="18" height="18" rx="2"/><line x1="8" y1="8" x2="16" y2="8"/><line x1="8" y1="12" x2="14" y2="12"/><line x1="8" y1="16" x2="12" y2="16"/></svg>';

    this.mobileToggleButton.innerHTML = `${label === 'Editor' ? editorIcon : previewIcon}<span class="ui-toolbar-button-label">${label}</span>`;
  }

  syncViewButtons() {
    this.viewButtons.forEach((button) => {
      const isActive = button.dataset.view === this.currentView;
      button.classList.toggle('active', isActive);
      button.setAttribute('aria-pressed', String(isActive));
    });
  }

  updateResizerValue() {
    if (!this.resizer || !this.editorLayout || !this.editorPane) {
      return;
    }

    const totalWidth = this.editorLayout.offsetWidth;
    if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
      return;
    }

    const percentage = Math.round((this.editorPane.offsetWidth / totalWidth) * 100);
    this.resizer.setAttribute('aria-valuenow', String(Math.max(20, Math.min(80, percentage))));
  }

  applyEditorPaneWidth(width) {
    if (!this.editorLayout || !this.editorPane || !this.previewPane) {
      return;
    }

    const totalWidth = this.editorLayout.offsetWidth;
    if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
      return;
    }

    const minPaneWidth = 200;
    const nextWidth = Math.max(minPaneWidth, Math.min(totalWidth - minPaneWidth, width));
    const percentage = (nextWidth / totalWidth) * 100;

    this.editorPane.style.flex = `0 0 ${percentage}%`;
    this.previewPane.style.flex = '1';
    this.updateResizerValue();
  }

  initializeResizer() {
    if (!this.resizer || !this.editorLayout || !this.editorPane || !this.previewPane) {
      return;
    }

    let isResizing = false;
    let startX = 0;
    let startWidth = 0;

    this.resizer.addEventListener('mousedown', (event) => {
      isResizing = true;
      startX = event.clientX;
      startWidth = this.editorPane.offsetWidth;
      this.resizer.classList.add('dragging');
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
      event.preventDefault();
    });

    document.addEventListener('mousemove', (event) => {
      if (!isResizing) {
        return;
      }

      const delta = event.clientX - startX;
      this.applyEditorPaneWidth(startWidth + delta);
    });

    document.addEventListener('mouseup', () => {
      if (!isResizing) {
        return;
      }

      isResizing = false;
      this.resizer.classList.remove('dragging');
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      this.scheduleEditorMeasure();
    });

    this.resizer.addEventListener('keydown', (event) => {
      const totalWidth = this.editorLayout.offsetWidth;
      if (!Number.isFinite(totalWidth) || totalWidth <= 0) {
        return;
      }

      const step = Math.max(24, Math.round(totalWidth * 0.05));
      if (event.key === 'ArrowLeft') {
        event.preventDefault();
        this.applyEditorPaneWidth(this.editorPane.offsetWidth - step);
        this.scheduleEditorMeasure();
        return;
      }

      if (event.key === 'ArrowRight') {
        event.preventDefault();
        this.applyEditorPaneWidth(this.editorPane.offsetWidth + step);
        this.scheduleEditorMeasure();
        return;
      }

      if (event.key === 'Home') {
        event.preventDefault();
        this.applyEditorPaneWidth(totalWidth * 0.2);
        this.scheduleEditorMeasure();
        return;
      }

      if (event.key === 'End') {
        event.preventDefault();
        this.applyEditorPaneWidth(totalWidth * 0.8);
        this.scheduleEditorMeasure();
      }
    });

    this.updateResizerValue();
  }
}
