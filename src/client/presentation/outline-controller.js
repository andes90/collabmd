export class OutlineController {
  constructor({
    mobileBreakpointQuery = window.matchMedia('(max-width: 768px)'),
    onNavigateToHeading,
  } = {}) {
    this.outlineOpen = false;
    this.activeHeadingFrame = null;
    this.activeHeadingId = null;
    this.headings = [];
    this.onNavigateToHeading = onNavigateToHeading;
    this.panel = document.getElementById('outlinePanel');
    this.navigation = document.getElementById('outlineNav');
    this.previewContainer = document.getElementById('previewContainer');
    this.toggleButton = document.getElementById('outlineToggle');
    this.mobileBreakpointQuery = mobileBreakpointQuery;
    this.handlePreviewScroll = () => this.scheduleActiveHeadingUpdate();
  }

  initialize() {
    this.toggleButton?.addEventListener('click', () => this.toggle());
  }

  toggle() {
    this.setOpenState(!this.outlineOpen);
  }

  close() {
    this.setOpenState(false);
  }

  setOpenState(nextState) {
    this.outlineOpen = nextState;
    this.panel?.classList.toggle('hidden', !this.outlineOpen);
    this.toggleButton?.classList.toggle('active', this.outlineOpen);

    if (this.outlineOpen) {
      this.refresh();
      return;
    }

    this.cleanup();
  }

  refresh() {
    if (!this.navigation) {
      return;
    }

    if (!this.outlineOpen) {
      this.cleanup();
      return;
    }

    const previewContent = document.getElementById('previewContent');
    const headings = previewContent?.querySelectorAll('h1, h2, h3, h4, h5, h6') ?? [];

    if (headings.length === 0) {
      this.navigation.innerHTML = '<div class="outline-empty">No headings found</div>';
      this.cleanup();
      return;
    }

    const items = Array.from(headings).map((heading, index) => {
      if (!heading.id) {
        heading.id = `heading-${index}-${heading.textContent.trim().toLowerCase()
          .replace(/[^a-z0-9]+/g, '-')
          .replace(/^-|-$/g, '')
          .slice(0, 40)}`;
      }

      return {
        id: heading.id,
        level: Number.parseInt(heading.tagName[1], 10),
        sourceLine: Number.parseInt(heading.getAttribute('data-source-line') || '', 10),
        text: heading.textContent.trim(),
      };
    });

    this.navigation.innerHTML = items.map((item) => (
      `<button class="outline-item" data-level="${item.level}" data-target="${item.id}"${Number.isFinite(item.sourceLine) ? ` data-source-line="${item.sourceLine}"` : ''} title="${item.text.replace(/"/g, '&quot;')}">${item.text}</button>`
    )).join('');

    this.navigation.querySelectorAll('.outline-item').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.target);
        this.notifyHeadingNavigation(target, button.dataset.target);
        this.scrollHeadingIntoView(target, { behavior: 'auto' });
        this.setActiveItem(button.dataset.target, { behavior: 'auto' });

        if (this.mobileBreakpointQuery.matches) {
          this.close();
        }
      });
    });

    this.observeHeadings(Array.from(headings));
  }

  cleanup() {
    if (this.activeHeadingFrame) {
      cancelAnimationFrame(this.activeHeadingFrame);
      this.activeHeadingFrame = null;
    }

    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    this.headings = [];
  }

  setActiveItem(id, { scrollIntoView = true, behavior = 'smooth' } = {}) {
    this.activeHeadingId = id;

    this.navigation?.querySelectorAll('.outline-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.target === id);
    });

    if (scrollIntoView) {
      this.navigation?.querySelector('.outline-item.active')?.scrollIntoView({
        behavior,
        block: 'nearest',
      });
    }
  }

  observeHeadings(headings) {
    this.cleanup();

    if (!this.previewContainer || headings.length === 0) {
      return;
    }

    this.headings = headings;
    this.previewContainer.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
    this.updateActiveHeading();
  }

  scheduleActiveHeadingUpdate() {
    if (this.activeHeadingFrame) {
      return;
    }

    this.activeHeadingFrame = requestAnimationFrame(() => {
      this.activeHeadingFrame = null;
      this.updateActiveHeading();
    });
  }

  updateActiveHeading() {
    if (!this.previewContainer || this.headings.length === 0) {
      return;
    }

    const focusLine = this.previewContainer.scrollTop + 12;
    let activeHeading = this.headings[0];

    for (const heading of this.headings) {
      const headingOffset = this.getHeadingScrollTop(heading);
      if (headingOffset > focusLine) {
        break;
      }

      activeHeading = heading;
    }

    this.setActiveItem(activeHeading.id, {
      behavior: 'auto',
      scrollIntoView: true,
    });
  }

  getHeadingScrollTop(heading) {
    if (!this.previewContainer) {
      return 0;
    }

    const previewRect = this.previewContainer.getBoundingClientRect();
    const headingRect = heading.getBoundingClientRect();
    return this.previewContainer.scrollTop + (headingRect.top - previewRect.top);
  }

  notifyHeadingNavigation(target, headingId) {
    if (!target) {
      return;
    }

    const sourceLine = Number.parseInt(target.getAttribute('data-source-line') || '', 10);
    this.onNavigateToHeading?.({
      headingId,
      sourceLine: Number.isFinite(sourceLine) ? sourceLine : null,
    });
  }

  scrollHeadingIntoView(target, { behavior = 'smooth' } = {}) {
    if (!target || !this.previewContainer) {
      return;
    }

    const previewRect = this.previewContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop = this.previewContainer.scrollTop + (targetRect.top - previewRect.top) - 12;

    this.previewContainer.scrollTo({
      behavior,
      top: Math.max(nextScrollTop, 0),
    });
  }
}
