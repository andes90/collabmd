import markdownIt from 'markdown-it';
import hljs from 'highlight.js';

const MERMAID_ZOOM = {
  default: 1,
  animationDurationMs: 160,
  max: 3,
  min: 0.5,
  step: 0.1,
};

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getSvgSize(svg) {
  const viewBox = svg.viewBox?.baseVal;
  const attributeWidth = Number.parseFloat(svg.getAttribute('width') || '');
  const attributeHeight = Number.parseFloat(svg.getAttribute('height') || '');
  const rect = svg.getBoundingClientRect();
  const bbox = typeof svg.getBBox === 'function' ? svg.getBBox() : null;

  return {
    height: viewBox?.height || bbox?.height || attributeHeight || rect.height || 480,
    width: viewBox?.width || bbox?.width || attributeWidth || rect.width || 640,
  };
}

function getFrameViewportSize(frame) {
  const styles = window.getComputedStyle(frame);
  const paddingX = Number.parseFloat(styles.paddingLeft || '0') + Number.parseFloat(styles.paddingRight || '0');
  const paddingY = Number.parseFloat(styles.paddingTop || '0') + Number.parseFloat(styles.paddingBottom || '0');

  return {
    height: Math.max(frame.clientHeight - paddingY, 0),
    width: Math.max(frame.clientWidth - paddingX, 0),
  };
}

function easeOutCubic(progress) {
  return 1 - ((1 - progress) ** 3);
}

function createMarkdownRenderer() {
  const markdown = markdownIt({
    highlight(source, language) {
      if (language === 'mermaid') {
        return '';
      }

      try {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(source, { language }).value;
        }

        return hljs.highlightAuto(source).value;
      } catch {
        return '';
      }
    },
    html: true,
    linkify: true,
    typographer: true,
  });

  markdown.core.ruler.push('collabmd-source-lines', (state) => {
    state.tokens.forEach((token) => {
      if (!token.map) {
        return;
      }

      const [start, end] = token.map;
      const sourceStart = start + 1;
      const sourceEnd = Math.max(end, start + 1);

      if (token.nesting === 1 || token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') {
        token.attrSet('data-source-line', String(sourceStart));
        token.attrSet('data-source-line-end', String(sourceEnd));
      }
    });
  });

  let mermaidCounter = 0;
  const fallbackFence = markdown.renderer.rules.fence ?? ((tokens, index, options, env, self) => (
    self.renderToken(tokens, index, options)
  ));

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const info = token.info ? token.info.trim().toLowerCase() : '';
    const sourceLine = token.attrGet('data-source-line');
    const sourceLineEnd = token.attrGet('data-source-line-end');
    const sourceAttributes = sourceLine
      ? ` data-source-line="${sourceLine}" data-source-line-end="${sourceLineEnd}"`
      : '';

    if (info === 'mermaid') {
      mermaidCounter += 1;
      return `<div class="mermaid" id="mermaid-${mermaidCounter}"${sourceAttributes}>${markdown.utils.escapeHtml(token.content)}</div>`;
    }

    const rendered = fallbackFence(tokens, index, options, env, self);
    if (!sourceLine) {
      return rendered;
    }

    return rendered.replace(
      /^<pre/,
      `<pre data-source-line="${sourceLine}" data-source-line-end="${sourceLineEnd}"`,
    );
  };

  markdown.renderer.rules.list_item_open = (tokens, index, options, env, self) => {
    const inlineToken = tokens[index + 2];
    const content = inlineToken?.content ?? '';

    if (content.startsWith('[ ] ') || content.startsWith('[x] ') || content.startsWith('[X] ')) {
      tokens[index].attrJoin('class', 'task-list-item');
    }

    return self.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.text = (tokens, index) => {
    const content = tokens[index].content;

    if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
      return `<input type="checkbox" checked disabled> ${markdown.utils.escapeHtml(content.slice(4))}`;
    }

    if (content.startsWith('[ ] ')) {
      return `<input type="checkbox" disabled> ${markdown.utils.escapeHtml(content.slice(4))}`;
    }

    return markdown.utils.escapeHtml(content);
  };

  const fallbackLinkOpen = markdown.renderer.rules.link_open ?? ((tokens, index, options, env, self) => (
    self.renderToken(tokens, index, options)
  ));

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return fallbackLinkOpen(tokens, index, options, env, self);
  };

  return markdown;
}

export class PreviewRenderer {
  constructor({ getContent, onRenderComplete, outlineController, previewElement }) {
    this.getContent = getContent;
    this.onRenderComplete = onRenderComplete;
    this.outlineController = outlineController;
    this.previewElement = previewElement;
    this.markdown = createMarkdownRenderer();
    this.frameId = null;
    this.timeoutId = null;
  }

  applyTheme(theme) {
    const mermaid = window.mermaid;
    const highlightTheme = document.getElementById('hljs-theme');
    if (highlightTheme) {
      const { darkHref, lightHref } = highlightTheme.dataset;
      highlightTheme.href = theme === 'dark' ? darkHref : lightHref;
    }

    if (!mermaid) {
      return;
    }

    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      themeVariables: theme === 'dark' ? {
        background: '#161822',
        clusterBkg: '#1a1c28',
        edgeLabelBackground: '#161822',
        lineColor: '#8b8ba0',
        mainBkg: '#1c1e2c',
        nodeBorder: '#383a50',
        primaryBorderColor: '#383a50',
        primaryColor: '#818cf8',
        primaryTextColor: '#e2e2ea',
        secondaryColor: '#1c1e2c',
        tertiaryColor: '#161822',
        titleColor: '#e2e2ea',
      } : {},
    });
  }

  queueRender() {
    clearTimeout(this.timeoutId);
    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
    }

    this.timeoutId = setTimeout(() => {
      this.frameId = requestAnimationFrame(() => {
        void this.render();
      });
    }, 100);
  }

  async render() {
    if (!this.previewElement) {
      return;
    }

    const mermaid = window.mermaid;
    const markdownText = this.getContent();
    const html = this.markdown.render(markdownText);
    this.previewElement.innerHTML = html;

    this.wrapTables();

    try {
      const mermaidNodes = this.previewElement.querySelectorAll('.mermaid');
      if (mermaid && mermaidNodes.length > 0) {
        try {
          await mermaid.run({ nodes: mermaidNodes });
          this.enhanceMermaidDiagrams();
        } catch (error) {
          console.warn('[preview] Mermaid render failed:', error);
        }
      }

      this.outlineController.refresh();
    } finally {
      this.onRenderComplete?.();
    }
  }

  wrapTables() {
    this.previewElement.querySelectorAll('table').forEach((table) => {
      if (table.parentElement?.classList.contains('table-wrapper')) {
        return;
      }

      const wrapper = document.createElement('div');
      wrapper.className = 'table-wrapper';
      table.parentNode.insertBefore(wrapper, table);
      wrapper.appendChild(table);
    });
  }

  enhanceMermaidDiagrams() {
    this.previewElement.querySelectorAll('.mermaid').forEach((container) => {
      const svg = container.querySelector('svg');
      if (!svg) {
        return;
      }

      const toolbar = document.createElement('div');
      toolbar.className = 'mermaid-toolbar';

      const decreaseButton = this.createMermaidZoomButton('−', 'Zoom out');
      const increaseButton = this.createMermaidZoomButton('+', 'Zoom in');
      const resetButton = this.createMermaidZoomButton('Reset', 'Reset zoom');
      const zoomLabel = document.createElement('span');
      zoomLabel.className = 'mermaid-zoom-label';
      zoomLabel.setAttribute('aria-live', 'polite');

      toolbar.append(decreaseButton, zoomLabel, resetButton, increaseButton);

      const frame = document.createElement('div');
      frame.className = 'mermaid-frame';

      const { width: baseWidth, height: baseHeight } = getSvgSize(svg);
      let currentZoom = MERMAID_ZOOM.default;
      let defaultZoom = MERMAID_ZOOM.default;
      let zoomAnimationFrameId = null;
      let isPanning = false;
      let activePointerId = null;
      let panStartX = 0;
      let panStartY = 0;
      let panStartScrollLeft = 0;
      let panStartScrollTop = 0;

      svg.style.display = 'block';
      svg.style.margin = '0';
      svg.style.maxWidth = 'none';

      const applyZoom = (nextZoom) => {
        currentZoom = clamp(nextZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);

        svg.style.width = `${baseWidth * currentZoom}px`;
        svg.style.height = `${baseHeight * currentZoom}px`;
        zoomLabel.textContent = `${Math.round(currentZoom * 100)}%`;

        decreaseButton.disabled = currentZoom <= MERMAID_ZOOM.min;
        increaseButton.disabled = currentZoom >= MERMAID_ZOOM.max;

        const viewport = getFrameViewportSize(frame);
        const isPannable = (baseWidth * currentZoom) > viewport.width || (baseHeight * currentZoom) > viewport.height;
        frame.classList.toggle('is-pannable', isPannable);
      };

      const getViewportCenter = () => ({
        x: frame.scrollLeft + (frame.clientWidth / 2),
        y: frame.scrollTop + (frame.clientHeight / 2),
      });

      const restoreViewportCenter = (previousZoom, nextZoom, center) => {
        if (previousZoom === 0) {
          return;
        }

        const scale = nextZoom / previousZoom;
        frame.scrollLeft = (center.x * scale) - (frame.clientWidth / 2);
        frame.scrollTop = (center.y * scale) - (frame.clientHeight / 2);
      };

      const animateZoomTo = (nextZoom) => {
        const targetZoom = clamp(nextZoom, MERMAID_ZOOM.min, MERMAID_ZOOM.max);
        const startZoom = currentZoom;

        if (targetZoom === startZoom) {
          return;
        }

        const center = getViewportCenter();
        const startedAt = performance.now();

        if (zoomAnimationFrameId) {
          cancelAnimationFrame(zoomAnimationFrameId);
        }

        const tick = (now) => {
          const progress = clamp((now - startedAt) / MERMAID_ZOOM.animationDurationMs, 0, 1);
          const easedProgress = easeOutCubic(progress);
          const animatedZoom = startZoom + ((targetZoom - startZoom) * easedProgress);

          applyZoom(animatedZoom);
          restoreViewportCenter(startZoom, animatedZoom, center);

          if (progress < 1) {
            zoomAnimationFrameId = requestAnimationFrame(tick);
            return;
          }

          zoomAnimationFrameId = null;
          applyZoom(targetZoom);
          restoreViewportCenter(startZoom, targetZoom, center);
        };

        zoomAnimationFrameId = requestAnimationFrame(tick);
      };

      const zoomBy = (delta) => {
        animateZoomTo(currentZoom + delta);
      };

      decreaseButton.addEventListener('click', () => zoomBy(-MERMAID_ZOOM.step));
      increaseButton.addEventListener('click', () => zoomBy(MERMAID_ZOOM.step));
      resetButton.addEventListener('click', () => animateZoomTo(defaultZoom));

      const stopPanning = () => {
        if (!isPanning) {
          return;
        }

        isPanning = false;
        frame.classList.remove('is-dragging');

        if (activePointerId !== null && typeof frame.releasePointerCapture === 'function') {
          try {
            frame.releasePointerCapture(activePointerId);
          } catch {
            // Ignore capture release issues during drag end.
          }
        }

        activePointerId = null;
      };

      frame.addEventListener('pointerdown', (event) => {
        if (event.button !== 0 || !frame.classList.contains('is-pannable')) {
          return;
        }

        if (zoomAnimationFrameId) {
          cancelAnimationFrame(zoomAnimationFrameId);
          zoomAnimationFrameId = null;
        }

        isPanning = true;
        activePointerId = event.pointerId;
        panStartX = event.clientX;
        panStartY = event.clientY;
        panStartScrollLeft = frame.scrollLeft;
        panStartScrollTop = frame.scrollTop;

        frame.classList.add('is-dragging');
        frame.setPointerCapture?.(event.pointerId);
        event.preventDefault();
      });

      frame.addEventListener('pointermove', (event) => {
        if (!isPanning) {
          return;
        }

        frame.scrollLeft = panStartScrollLeft - (event.clientX - panStartX);
        frame.scrollTop = panStartScrollTop - (event.clientY - panStartY);
      });

      frame.addEventListener('pointerup', stopPanning);
      frame.addEventListener('pointercancel', stopPanning);
      frame.addEventListener('lostpointercapture', stopPanning);

      frame.appendChild(svg);
      container.replaceChildren(toolbar, frame);

      const viewport = getFrameViewportSize(frame);
      if (viewport.width > 0) {
        defaultZoom = clamp(viewport.width / baseWidth, MERMAID_ZOOM.min, MERMAID_ZOOM.max);
      }

      applyZoom(defaultZoom);
    });
  }

  createMermaidZoomButton(label, ariaLabel) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'mermaid-zoom-btn';
    button.setAttribute('aria-label', ariaLabel);
    button.textContent = label;
    return button;
  }
}
