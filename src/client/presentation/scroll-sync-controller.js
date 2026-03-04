const VIEWPORT_FOCUS_RATIO = 0.35;
const MIN_VIEWPORT_FOCUS_OFFSET = 12;

function getScrollableRange(element) {
  return Math.max(element.scrollHeight - element.clientHeight, 0);
}

function clampScrollTop(value) {
  return Math.max(value, 0);
}

function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

function getViewportFocusOffset(element) {
  return Math.max(element.clientHeight * VIEWPORT_FOCUS_RATIO, MIN_VIEWPORT_FOCUS_OFFSET);
}

function getElementScrollTop(container, element) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return elementRect.top - containerRect.top + container.scrollTop;
}

function isLeafSourceBlock(element) {
  return !element.querySelector('[data-source-line]');
}

export class ScrollSyncController {
  constructor({
    getEditorLineNumber,
    previewContainer,
    previewElement,
    scrollEditorToLine,
  }) {
    this.getEditorLineNumber = getEditorLineNumber;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.scrollEditorToLine = scrollEditorToLine;
    this.editorScroller = null;
    this.lockedElements = new Set();
    this.pendingSync = null;
    this.frameId = null;
    this.previewBlocks = null;
    this.suspendedUntil = 0;

    this.handleEditorScroll = () => {
      this.scheduleSync(this.editorScroller, this.previewContainer);
    };

    this.handlePreviewScroll = () => {
      this.scheduleSync(this.previewContainer, this.editorScroller);
    };
  }

  initialize() {
    this.previewContainer?.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
  }

  attachEditorScroller(editorScroller) {
    if (this.editorScroller === editorScroller) {
      return;
    }

    this.editorScroller?.removeEventListener('scroll', this.handleEditorScroll);
    this.editorScroller = editorScroller;
    this.editorScroller?.addEventListener('scroll', this.handleEditorScroll, { passive: true });
  }

  syncPreviewToEditor() {
    this.sync(this.editorScroller, this.previewContainer);
  }

  syncEditorToPreview() {
    this.sync(this.previewContainer, this.editorScroller);
  }

  destroy() {
    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    this.editorScroller?.removeEventListener('scroll', this.handleEditorScroll);
    this.editorScroller = null;
    this.pendingSync = null;
    this.previewBlocks = null;
    this.lockedElements.clear();
    this.suspendedUntil = 0;

    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  scheduleSync(source, target) {
    if (!source || !target || this.lockedElements.has(source) || this.isSuspended()) {
      return;
    }

    this.pendingSync = { source, target };
    if (this.frameId) {
      return;
    }

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;

      if (!this.pendingSync) {
        return;
      }

      const { source: pendingSource, target: pendingTarget } = this.pendingSync;
      this.pendingSync = null;
      this.sync(pendingSource, pendingTarget);
    });
  }

  invalidatePreviewBlocks() {
    this.previewBlocks = null;
  }

  suspendSync(durationMs = 250) {
    this.suspendedUntil = performance.now() + durationMs;
  }

  isSuspended() {
    return performance.now() < this.suspendedUntil;
  }

  sync(source, target) {
    if (!source || !target || this.lockedElements.has(source) || this.isSuspended()) {
      return;
    }

    if (source === this.editorScroller && target === this.previewContainer) {
      const nextScrollTop = this.getPreviewScrollTopForEditorLine();
      if (nextScrollTop !== null) {
        this.setScrollTop(target, nextScrollTop);
        return;
      }
    }

    if (source === this.previewContainer && target === this.editorScroller) {
      const targetLine = this.getEditorLineNumberForPreviewScroll();
      if (targetLine !== null) {
        this.lockedElements.add(target);
        this.scrollEditorToLine?.(targetLine, VIEWPORT_FOCUS_RATIO);
        requestAnimationFrame(() => {
          this.lockedElements.delete(target);
        });
        return;
      }
    }

    const sourceRange = getScrollableRange(source);
    const targetRange = getScrollableRange(target);
    const scrollRatio = sourceRange > 0 ? source.scrollTop / sourceRange : 0;
    const nextScrollTop = targetRange > 0 ? targetRange * scrollRatio : 0;

    this.setScrollTop(target, nextScrollTop);
  }

  setScrollTop(target, nextScrollTop) {
    this.lockedElements.add(target);
    target.scrollTop = clampScrollTop(nextScrollTop);

    requestAnimationFrame(() => {
      this.lockedElements.delete(target);
    });
  }

  getPreviewScrollTopForEditorLine() {
    const lineNumber = this.getEditorLineNumber?.();
    if (!Number.isFinite(lineNumber)) {
      return null;
    }

    const blocks = this.getPreviewBlocks();
    if (blocks.length === 0 || !this.previewContainer) {
      return null;
    }

    const { block, index } = this.findBlockForLine(blocks, lineNumber);
    const previewSpan = this.getPreviewSpan(blocks, index);
    const sourceSpan = Math.max(block.end - block.start, 1);
    const progress = clamp((lineNumber - block.start) / sourceSpan, 0, 1);
    const maxScrollTop = getScrollableRange(this.previewContainer);
    const focusOffset = getViewportFocusOffset(this.previewContainer);

    return clamp(block.top + (previewSpan * progress) - focusOffset, 0, maxScrollTop);
  }

  getEditorLineNumberForPreviewScroll() {
    if (!this.previewContainer) {
      return null;
    }

    const blocks = this.getPreviewBlocks();
    if (blocks.length === 0) {
      return null;
    }

    const previewTop = this.previewContainer.scrollTop + getViewportFocusOffset(this.previewContainer);
    const { block, index } = this.findBlockForScrollTop(blocks, previewTop);
    const previewSpan = this.getPreviewSpan(blocks, index);
    const sourceSpan = Math.max(block.end - block.start, 1);
    const progress = previewSpan > 0 ? clamp((previewTop - block.top) / previewSpan, 0, 1) : 0;

    return Math.round(block.start + (sourceSpan * progress));
  }

  getPreviewBlocks() {
    if (this.previewBlocks) {
      return this.previewBlocks;
    }

    if (!this.previewContainer || !this.previewElement) {
      return [];
    }

    const allBlocks = Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
      .map((element) => {
        const start = Number.parseInt(element.getAttribute('data-source-line') || '', 10);
        const end = Number.parseInt(element.getAttribute('data-source-line-end') || '', 10);

        if (!Number.isFinite(start)) {
          return null;
        }

        return {
          element,
          end: Number.isFinite(end) ? Math.max(end, start + 1) : start + 1,
          start,
          top: getElementScrollTop(this.previewContainer, element),
        };
      })
      .filter(Boolean)
      .sort((left, right) => (
        left.top - right.top
        || left.start - right.start
        || left.end - right.end
      ));

    const blocks = allBlocks.filter((block) => isLeafSourceBlock(block.element));
    const resolvedBlocks = blocks.length > 0 ? blocks : allBlocks;

    this.previewBlocks = resolvedBlocks.filter((block, index) => {
      const previousBlock = resolvedBlocks[index - 1];
      return !previousBlock
        || Math.abs(previousBlock.top - block.top) > 1
        || previousBlock.start !== block.start
        || previousBlock.end !== block.end;
    });

    return this.previewBlocks;
  }

  findBlockForLine(blocks, lineNumber) {
    let matchedBlock = null;
    let matchedIndex = -1;

    for (let index = 0; index < blocks.length; index += 1) {
      const block = blocks[index];
      if (lineNumber >= block.start && lineNumber < block.end) {
        if (!matchedBlock) {
          matchedBlock = block;
          matchedIndex = index;
          continue;
        }

        const matchedSpan = matchedBlock.end - matchedBlock.start;
        const candidateSpan = block.end - block.start;
        if (candidateSpan < matchedSpan || (candidateSpan === matchedSpan && block.start >= matchedBlock.start)) {
          matchedBlock = block;
          matchedIndex = index;
        }
      }
    }

    if (matchedBlock) {
      return { block: matchedBlock, index: matchedIndex };
    }

    let fallbackIndex = 0;
    for (let index = 0; index < blocks.length; index += 1) {
      if (blocks[index].start > lineNumber) {
        break;
      }

      fallbackIndex = index;
    }

    return { block: blocks[fallbackIndex], index: fallbackIndex };
  }

  findBlockForScrollTop(blocks, scrollTop) {
    for (let index = 0; index < blocks.length; index += 1) {
      const nextTop = this.getPreviewSpan(blocks, index) + blocks[index].top;
      if (scrollTop < nextTop) {
        return { block: blocks[index], index };
      }
    }

    const lastIndex = blocks.length - 1;
    return { block: blocks[lastIndex], index: lastIndex };
  }

  getPreviewSpan(blocks, index) {
    if (!this.previewContainer) {
      return 1;
    }

    const currentBlock = blocks[index];
    const nextBlock = blocks[index + 1];
    const fallbackSpan = currentBlock.element.getBoundingClientRect().height;

    if (!nextBlock) {
      const maxScrollTop = getScrollableRange(this.previewContainer);
      return Math.max(maxScrollTop - currentBlock.top + this.previewContainer.clientHeight, fallbackSpan, 1);
    }

    return Math.max(nextBlock.top - currentBlock.top, fallbackSpan, 1);
  }
}
