import { clamp } from '../domain/vault-utils.js';

const VIEWPORT_FOCUS_RATIO = 0.35;
const LARGE_DOCUMENT_EDITOR_IDLE_MS = 120;
const MIN_VIEWPORT_FOCUS_OFFSET = 12;
const TOP_SCROLL_EPSILON = 2;

function getScrollableRange(element) {
  return Math.max(element.scrollHeight - element.clientHeight, 0);
}

function clampScrollTop(value) {
  return Math.max(value, 0);
}

function getViewportFocusOffset(element) {
  return Math.max(element.clientHeight * VIEWPORT_FOCUS_RATIO, MIN_VIEWPORT_FOCUS_OFFSET);
}

function isNearTopOfScrollRange(element) {
  return (element?.scrollTop ?? 0) <= TOP_SCROLL_EPSILON;
}

function getElementScrollTop(container, element) {
  const containerRect = container.getBoundingClientRect();
  const elementRect = element.getBoundingClientRect();
  return elementRect.top - containerRect.top + container.scrollTop;
}

function isLeafSourceBlock(element) {
  return !element.querySelector('[data-source-line]');
}

function requestIdleWork(callback) {
  if (typeof window.requestIdleCallback === 'function') {
    return window.requestIdleCallback(callback, { timeout: 500 });
  }

  return window.setTimeout(() => {
    callback({
      didTimeout: false,
      timeRemaining: () => 0,
    });
  }, 1);
}

function cancelIdleWork(id) {
  if (id === null) {
    return;
  }

  if (typeof window.cancelIdleCallback === 'function') {
    window.cancelIdleCallback(id);
    return;
  }

  window.clearTimeout(id);
}

export class ScrollSyncController {
  constructor({
    getEditorLineNumber,
    onEditorScrollActivityChange,
    previewContainer,
    previewElement,
    scrollEditorToLine,
  }) {
    this.getEditorLineNumber = getEditorLineNumber;
    this.onEditorScrollActivityChange = onEditorScrollActivityChange;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.scrollEditorToLine = scrollEditorToLine;
    this.editorScroller = null;
    this.editorScrollActive = false;
    this.editorScrollIdleTimer = null;
    this.lockedElements = new Set();
    this.pendingSync = null;
    this.frameId = null;
    this.previewBlocks = null;
    this.previewBlocksWarmId = null;
    this.previewBlocksReadyCallbacks = [];
    this.largeDocumentMode = false;
    this.lastInteractionSource = 'editor';
    this.suspendedUntil = 0;

    this.handleEditorScroll = () => {
      if (!this.editorScroller || this.lockedElements.has(this.editorScroller) || this.isSuspended()) {
        return;
      }

      this.lastInteractionSource = 'editor';
      if (this.largeDocumentMode) {
        this.setEditorScrollActive(true);
        this.scheduleEditorScrollIdle();
        this.scheduleSync(this.editorScroller, this.previewContainer, {
          preferApproximateMapping: true,
        });
        return;
      }

      this.scheduleSync(this.editorScroller, this.previewContainer);
    };

    this.handlePreviewScroll = () => {
      if (!this.previewContainer || this.lockedElements.has(this.previewContainer) || this.isSuspended()) {
        return;
      }

      this.lastInteractionSource = 'preview';
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
    this.lastInteractionSource = 'editor';
    this.sync(this.editorScroller, this.previewContainer);
  }

  syncEditorToPreview() {
    this.lastInteractionSource = 'preview';
    this.sync(this.previewContainer, this.editorScroller);
  }

  destroy() {
    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    this.editorScroller?.removeEventListener('scroll', this.handleEditorScroll);
    this.editorScroller = null;
    clearTimeout(this.editorScrollIdleTimer);
    this.editorScrollIdleTimer = null;
    this.pendingSync = null;
    this.previewBlocks = null;
    cancelIdleWork(this.previewBlocksWarmId);
    this.previewBlocksWarmId = null;
    this.previewBlocksReadyCallbacks = [];
    this.lockedElements.clear();
    this.editorScrollActive = false;
    this.lastInteractionSource = 'editor';
    this.suspendedUntil = 0;

    if (this.frameId) {
      cancelAnimationFrame(this.frameId);
      this.frameId = null;
    }
  }

  scheduleSync(source, target, { preferApproximateMapping = false } = {}) {
    if (!source || !target || this.lockedElements.has(source) || this.isSuspended()) {
      return;
    }

    this.pendingSync = { preferApproximateMapping, source, target };
    if (this.frameId) {
      return;
    }

    this.frameId = requestAnimationFrame(() => {
      this.frameId = null;

      if (!this.pendingSync) {
        return;
      }

      const {
        preferApproximateMapping: pendingPreferApproximateMapping,
        source: pendingSource,
        target: pendingTarget,
      } = this.pendingSync;
      this.pendingSync = null;
      this.sync(pendingSource, pendingTarget, {
        preferApproximateMapping: pendingPreferApproximateMapping,
      });
    });
  }

  invalidatePreviewBlocks() {
    this.previewBlocks = null;
    cancelIdleWork(this.previewBlocksWarmId);
    this.previewBlocksWarmId = null;
    this.previewBlocksReadyCallbacks = [];
  }

  setLargeDocumentMode(enabled) {
    this.largeDocumentMode = Boolean(enabled);
    if (!this.largeDocumentMode) {
      clearTimeout(this.editorScrollIdleTimer);
      this.editorScrollIdleTimer = null;
      this.setEditorScrollActive(false);
    }
  }

  warmPreviewBlocks({ onReady } = {}) {
    if (typeof onReady === 'function') {
      if (this.previewBlocks) {
        onReady(this.previewBlocks);
      } else {
        this.previewBlocksReadyCallbacks.push(onReady);
      }
    }

    if (!this.largeDocumentMode) {
      if (!this.previewBlocks) {
        this.previewBlocks = this.buildPreviewBlocks();
      }

      this.flushPreviewBlocksReadyCallbacks();
      return;
    }

    if (this.previewBlocks || this.previewBlocksWarmId !== null) {
      return;
    }

    this.previewBlocksWarmId = requestIdleWork(() => {
      this.previewBlocksWarmId = null;
      this.previewBlocks = this.buildPreviewBlocks();
      this.flushPreviewBlocksReadyCallbacks();
    });
  }

  realignAfterLayoutChange() {
    const runRealignment = () => {
      if (this.lastInteractionSource === 'preview') {
        this.syncEditorToPreview();
        return;
      }

      this.syncPreviewToEditor();
    };

    if (this.largeDocumentMode && !this.previewBlocks) {
      this.warmPreviewBlocks({
        onReady: () => runRealignment(),
      });
      return;
    }

    runRealignment();
  }

  suspendSync(durationMs = 250) {
    this.suspendedUntil = performance.now() + durationMs;
  }

  isSuspended() {
    return performance.now() < this.suspendedUntil;
  }

  flushPreviewBlocksReadyCallbacks() {
    if (this.previewBlocksReadyCallbacks.length === 0) {
      return;
    }

    const callbacks = this.previewBlocksReadyCallbacks.splice(0);
    callbacks.forEach((callback) => {
      try {
        callback(this.previewBlocks ?? []);
      } catch (error) {
        console.warn('[scroll-sync] Preview block callback failed:', error);
      }
    });
  }

  setEditorScrollActive(active) {
    if (this.editorScrollActive === active) {
      return;
    }

    this.editorScrollActive = active;
    this.onEditorScrollActivityChange?.(active);
  }

  scheduleEditorScrollIdle() {
    clearTimeout(this.editorScrollIdleTimer);
    this.editorScrollIdleTimer = setTimeout(() => {
      this.editorScrollIdleTimer = null;
      this.setEditorScrollActive(false);
      this.syncPreviewToEditor();
    }, LARGE_DOCUMENT_EDITOR_IDLE_MS);
  }

  sync(source, target, { preferApproximateMapping = false } = {}) {
    if (!source || !target || this.lockedElements.has(source) || this.isSuspended()) {
      return;
    }

    if (!preferApproximateMapping && source === this.editorScroller && target === this.previewContainer) {
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
    if (isNearTopOfScrollRange(this.editorScroller)) {
      return 0;
    }

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

    if (this.largeDocumentMode) {
      return [];
    }

    this.previewBlocks = this.buildPreviewBlocks();
    return this.previewBlocks;
  }

  buildPreviewBlocks() {
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

    return resolvedBlocks.filter((block, index) => {
      const previousBlock = resolvedBlocks[index - 1];
      return !previousBlock
        || Math.abs(previousBlock.top - block.top) > 1
        || previousBlock.start !== block.start
        || previousBlock.end !== block.end;
    });
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
