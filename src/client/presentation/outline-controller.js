export class OutlineController {
  constructor() {
    this.outlineOpen = false;
    this.observer = null;
    this.activeHeadingId = null;
    this.panel = document.getElementById('outlinePanel');
    this.navigation = document.getElementById('outlineNav');
    this.previewContainer = document.getElementById('previewContainer');
    this.toggleButton = document.getElementById('outlineToggle');
  }

  initialize() {
    this.toggleButton?.addEventListener('click', () => this.toggle());
  }

  toggle() {
    this.outlineOpen = !this.outlineOpen;
    this.panel?.classList.toggle('hidden', !this.outlineOpen);
    this.toggleButton?.classList.toggle('active', this.outlineOpen);

    if (this.outlineOpen) {
      this.refresh();
    }
  }

  refresh() {
    if (!this.navigation) {
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
        text: heading.textContent.trim(),
      };
    });

    this.navigation.innerHTML = items.map((item) => (
      `<button class="outline-item" data-level="${item.level}" data-target="${item.id}" title="${item.text.replace(/"/g, '&quot;')}">${item.text}</button>`
    )).join('');

    this.navigation.querySelectorAll('.outline-item').forEach((button) => {
      button.addEventListener('click', () => {
        const target = document.getElementById(button.dataset.target);
        this.scrollHeadingIntoView(target);

        this.setActiveItem(button.dataset.target);
      });
    });

    this.observeHeadings(Array.from(headings));
  }

  cleanup() {
    if (this.observer) {
      this.observer.disconnect();
      this.observer = null;
    }
  }

  setActiveItem(id) {
    this.activeHeadingId = id;

    this.navigation?.querySelectorAll('.outline-item').forEach((item) => {
      item.classList.toggle('active', item.dataset.target === id);
    });

    this.navigation?.querySelector('.outline-item.active')?.scrollIntoView({
      behavior: 'smooth',
      block: 'nearest',
    });
  }

  observeHeadings(headings) {
    this.cleanup();

    if (!this.previewContainer || headings.length === 0) {
      return;
    }

    this.observer = new IntersectionObserver((entries) => {
      let topEntry = null;

      for (const entry of entries) {
        if (!entry.isIntersecting) {
          continue;
        }

        if (!topEntry || entry.boundingClientRect.top < topEntry.boundingClientRect.top) {
          topEntry = entry;
        }
      }

      if (topEntry) {
        this.setActiveItem(topEntry.target.id);
      }
    }, {
      root: this.previewContainer,
      rootMargin: '-12px 0px -70% 0px',
      threshold: 0,
    });

    headings.forEach((heading) => this.observer.observe(heading));
  }

  scrollHeadingIntoView(target) {
    if (!target || !this.previewContainer) {
      return;
    }

    const previewRect = this.previewContainer.getBoundingClientRect();
    const targetRect = target.getBoundingClientRect();
    const nextScrollTop = this.previewContainer.scrollTop + (targetRect.top - previewRect.top) - 12;

    this.previewContainer.scrollTo({
      behavior: 'smooth',
      top: Math.max(nextScrollTop, 0),
    });
  }
}
