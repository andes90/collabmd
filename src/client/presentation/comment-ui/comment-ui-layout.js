import {
  COMMENT_CONTROL_SLOT_HEIGHT,
  COMMENT_PREVIEW_BADGE_MIN_WIDTH,
  COMMENT_PREVIEW_RAIL_BREAKPOINT,
  COMMENT_PREVIEW_RAIL_MIN_WIDTH,
  COMMENT_PREVIEW_RAIL_SLOT_HEIGHT,
  COMMENT_SELECTION_CHIP_GAP,
  clamp,
  createCommentMarkerContent,
  createRectFromRects,
  findUniqueQuoteRange,
  isLeafSourceBlock,
  normalizeGroupKeys,
  overlapsAnchorRange,
  pointIntersectsRect,
  serializeGroupKeys,
  toRelativeRect,
} from './comment-ui-shared.js';

/** @this {any} */
function refreshLayout() {
  this.renderEditorLayer();
  this.renderPreviewLayer();
  this.repositionActiveCard();
}

/** @this {any} */
function syncPreviewRailLayout(maxBubbleWidth = 0) {
  if (!this.previewElement) {
    return false;
  }

  const shouldShowRail = this.supported && maxBubbleWidth > 0;
  const nextReserved = 0;
  const nextOffset = 0;
  let reserved = nextReserved;
  let offset = nextOffset;

  if (shouldShowRail) {
    const previewStyle = getComputedStyle(this.previewElement);
    const currentReserved = Number.parseFloat(
      previewStyle.getPropertyValue('--preview-comment-rail-reserved'),
    ) || 0;
    const currentPaddingRight = Number.parseFloat(previewStyle.paddingRight) || 0;
    const railInset = Number.parseFloat(
      previewStyle.getPropertyValue('--preview-comment-rail-inset'),
    ) || 0;
    const basePaddingRight = Math.max(currentPaddingRight - currentReserved, 0);
    const requiredRail = Math.max(maxBubbleWidth + railInset - basePaddingRight, 0);
    const previewContainerRect = this.previewContainer?.getBoundingClientRect();
    const previewRect = this.previewElement.getBoundingClientRect();
    const availableRightGutter = previewContainerRect
      ? Math.max(previewContainerRect.right - previewRect.right, 0)
      : 0;

    offset = Math.min(availableRightGutter, requiredRail);
    reserved = Math.max(requiredRail - offset, 0);
  }

  const nextReservedValue = `${Math.ceil(reserved)}px`;
  const nextOffsetValue = `${Math.floor(offset)}px`;
  const didChange = this.previewElement.style.getPropertyValue('--preview-comment-rail-reserved') !== nextReservedValue
    || this.previewElement.style.getPropertyValue('--preview-comment-rail-offset') !== nextOffsetValue;

  if (didChange) {
    this.previewElement.style.setProperty('--preview-comment-rail-reserved', nextReservedValue);
    this.previewElement.style.setProperty('--preview-comment-rail-offset', nextOffsetValue);
  }

  return didChange;
}

/** @this {any} */
function scheduleLayoutRefresh() {
  if (this.layoutFrame) {
    return;
  }

  this.layoutFrame = requestAnimationFrame(() => {
    this.layoutFrame = 0;
    this.refreshLayout();
  });
}

/** @this {any} */
function ensureEditorLayer() {
  if (this.editorLayer?.isConnected && this.editorLayer.parentElement === this.editorContainer) {
    return this.editorLayer;
  }

  const layer = document.createElement('div');
  layer.className = 'comment-editor-layer';
  this.editorContainer?.appendChild(layer);
  this.editorLayer = layer;
  return layer;
}

/** @this {any} */
function renderEditorLayer() {
  const layer = this.ensureEditorLayer();
  layer.replaceChildren();

  if (!this.supported || !this.session) {
    return;
  }

  const containerRect = this.editorContainer?.getBoundingClientRect?.();
  if (!containerRect) {
    return;
  }

  const groups = this.getThreadGroups();
  const occupiedTops = [];
  groups.forEach((group) => {
    const rect = this.session.getCommentAnchorClientRect?.(group.anchor);
    if (!rect) {
      return;
    }

    const relativeRect = toRelativeRect(rect, containerRect);
    if (relativeRect.bottom < 0 || relativeRect.top > containerRect.height) {
      return;
    }

    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-state-marker ui-state-marker--comment comment-editor-badge';
    button.dataset.count = String(group.threads.length);
    const isActive = this.activeCard?.groupKey === group.key;
    const isHovered = this.hoveredEditorGroupKeys.includes(group.key);
    button.classList.toggle('is-active', isActive);
    button.classList.toggle('is-hovered', isHovered);
    button.classList.toggle('is-passive', !isActive && !isHovered);
    button.setAttribute('aria-label', `${group.threads.length} comment thread${group.threads.length === 1 ? '' : 's'}`);
    button.appendChild(createCommentMarkerContent(group.threads.length));
    const top = Math.max(relativeRect.top, 8);
    button.style.top = `${top}px`;
    button.style.left = `${Math.max(containerRect.width - 36, 8)}px`;
    button.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('pointerenter', () => {
      this.updateHoveredEditorGroups([group.key]);
    });
    button.addEventListener('pointerleave', () => {
      this.updateHoveredEditorGroups([]);
    });
    button.addEventListener('focusin', () => {
      this.updateHoveredEditorGroups([group.key]);
    });
    button.addEventListener('focusout', () => {
      this.updateHoveredEditorGroups([]);
    });
    button.addEventListener('click', () => {
      this.openThreadGroup(group, {
        anchor: group.anchor,
        origin: 'editor',
        sourceRect: rect,
      });
    });
    layer.appendChild(button);
    occupiedTops.push(top);
  });

  if (!this.committedSelectionAnchor || this.activeCard?.mode === 'create') {
    return;
  }

  const rect = this.session.getCommentAnchorClientRect?.(this.committedSelectionAnchor);
  const chipRect = this.session.getSelectionChipClientRect?.(this.committedSelectionAnchor) ?? rect;
  if (!chipRect) {
    return;
  }

  const relativeRect = toRelativeRect(chipRect, containerRect);
  if (relativeRect.bottom < 0 || relativeRect.top > containerRect.height) {
    return;
  }

  let chipTop = clamp(relativeRect.top, 8, Math.max(containerRect.height - COMMENT_CONTROL_SLOT_HEIGHT, 8));
  while (occupiedTops.some((top) => Math.abs(top - chipTop) < (COMMENT_CONTROL_SLOT_HEIGHT - 4))) {
    chipTop = clamp(
      chipTop + COMMENT_CONTROL_SLOT_HEIGHT,
      8,
      Math.max(containerRect.height - COMMENT_CONTROL_SLOT_HEIGHT, 8),
    );
  }
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-selection-pill ui-selection-pill--comment comment-selection-chip';
  button.textContent = 'Comment';
  button.style.top = `${chipTop}px`;
  button.style.right = `${COMMENT_SELECTION_CHIP_GAP}px`;
  button.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    event.stopPropagation();
    this.openComposerForSelection('editor', button.getBoundingClientRect());
  });
  layer.appendChild(button);
}

/** @this {any} */
function ensurePreviewLayer() {
  if (this.previewLayer?.isConnected && this.previewLayer.parentElement === this.previewElement) {
    return this.previewLayer;
  }

  const highlightLayer = document.createElement('div');
  highlightLayer.className = 'comment-preview-highlights';
  const markerLayer = document.createElement('div');
  markerLayer.className = 'comment-preview-layer';
  this.previewElement?.append(highlightLayer, markerLayer);
  this.previewHighlightLayer = highlightLayer;
  this.previewLayer = markerLayer;
  return markerLayer;
}

/** @this {any} */
function renderPreviewLayer() {
  this.ensurePreviewLayer();
  this.previewLayer?.replaceChildren();
  this.previewHighlightLayer?.replaceChildren();

  if (!this.supported || !this.previewElement) {
    this.previewHoverRegions = [];
    this.syncPreviewRailLayout(0);
    return;
  }

  const previewRect = this.previewElement.getBoundingClientRect();
  const groups = this.getThreadGroups();
  const occupiedTops = [];
  const hoverRegions = [];
  const showPassiveMarkers = this.shouldRenderPassivePreviewMarkers();
  const previewBubbles = [];
  groups.forEach((group) => {
    const target = this.resolvePreviewTarget(group.anchor);
    if (!target?.bubbleRect) {
      return;
    }

    hoverRegions.push({
      key: group.key,
      rects: target.hoverRects?.length > 0 ? target.hoverRects : [target.bubbleRect],
    });

    const isActive = this.activeCard?.groupKey === group.key;
    const isHovered = this.hoveredPreviewGroupKeys.includes(group.key);
    const isEmphasized = isActive || isHovered;

    target.highlightRects?.forEach((rect) => {
      const highlight = document.createElement('div');
      highlight.className = 'comment-preview-highlight';
      highlight.classList.toggle('is-active', isActive);
      highlight.classList.toggle('is-hovered', isHovered);
      highlight.classList.toggle('is-passive', !isEmphasized);
      highlight.style.left = `${rect.left - previewRect.left}px`;
      highlight.style.top = `${rect.top - previewRect.top}px`;
      highlight.style.width = `${rect.width}px`;
      highlight.style.height = `${rect.height}px`;
      this.previewHighlightLayer?.appendChild(highlight);
    });

    if (!showPassiveMarkers && !isEmphasized) {
      return;
    }

    const bubble = document.createElement('button');
    bubble.type = 'button';
    bubble.className = 'ui-state-marker ui-state-marker--comment comment-preview-badge';
    bubble.dataset.commentPreviewGroupKeys = group.key;
    bubble.classList.toggle('is-active', isActive);
    bubble.classList.toggle('is-hovered', isHovered);
    bubble.classList.toggle('is-passive', !isEmphasized);
    bubble.setAttribute('aria-label', `${group.threads.length} comment thread${group.threads.length === 1 ? '' : 's'}`);
    bubble.appendChild(createCommentMarkerContent(group.threads.length));
    let bubbleTop = clamp(
      target.bubbleRect.top - previewRect.top,
      6,
      Math.max(this.previewElement.clientHeight - COMMENT_PREVIEW_RAIL_SLOT_HEIGHT, 6),
    );
    while (occupiedTops.some((top) => Math.abs(top - bubbleTop) < (COMMENT_PREVIEW_RAIL_SLOT_HEIGHT - 4))) {
      bubbleTop = clamp(
        bubbleTop + COMMENT_PREVIEW_RAIL_SLOT_HEIGHT,
        6,
        Math.max(this.previewElement.clientHeight - COMMENT_PREVIEW_RAIL_SLOT_HEIGHT, 6),
      );
    }
    bubble.style.top = `${bubbleTop}px`;
    bubble.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
    bubble.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    bubble.addEventListener('click', () => {
      this.openThreadGroup(group, {
        anchor: group.anchor,
        origin: 'preview',
        sourceRect: bubble.getBoundingClientRect(),
      });
    });
    this.previewLayer?.appendChild(bubble);
    occupiedTops.push(bubbleTop);
    previewBubbles.push(bubble);
  });

  this.previewHoverRegions = hoverRegions;
  const maxBubbleWidth = previewBubbles.reduce(
    (maxWidth, bubble) => Math.max(maxWidth, bubble.offsetWidth || COMMENT_PREVIEW_BADGE_MIN_WIDTH),
    0,
  );
  if (this.syncPreviewRailLayout(maxBubbleWidth)) {
    this.scheduleLayoutRefresh();
  }
  if (this.lastPreviewPointerPosition) {
    this.updateHoveredPreviewGroups(
      this.getPreviewGroupKeysAtPoint(this.lastPreviewPointerPosition.x, this.lastPreviewPointerPosition.y),
    );
  }
}

/** @this {any} */
function resolvePreviewTarget(anchor) {
  if (!this.previewElement || !anchor) {
    return null;
  }

  const diagramShell = Array.from(this.previewElement.querySelectorAll('.mermaid-shell, .plantuml-shell'))
    .find((element) => overlapsAnchorRange(element, anchor));
  if (diagramShell) {
    return {
      bubbleRect: diagramShell.getBoundingClientRect(),
      highlightRects: [],
      hoverRects: [diagramShell.getBoundingClientRect()],
    };
  }

  const candidates = Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
    .filter((element) => isLeafSourceBlock(element) && overlapsAnchorRange(element, anchor));

  if (anchor.kind === 'text' && anchor.quote) {
    const matches = candidates
      .map((element) => ({ element, range: findUniqueQuoteRange(element, anchor.quote) }))
      .filter((candidate) => candidate.range);
    if (matches.length === 1) {
      const rects = Array.from(matches[0].range.getClientRects());
      const bubbleRect = createRectFromRects(rects) || matches[0].element.getBoundingClientRect();
      return {
        bubbleRect,
        highlightRects: rects,
        hoverRects: rects,
      };
    }
  }

  const fallback = candidates[0];
  if (!fallback) {
    return null;
  }

  return {
    bubbleRect: fallback.getBoundingClientRect(),
    highlightRects: [],
    hoverRects: [fallback.getBoundingClientRect()],
  };
}

/** @this {any} */
function getPreviewGroupKeysForTarget(target) {
  if (!(target instanceof Node)) {
    return [];
  }

  const keyCarrier = target.closest?.('[data-comment-preview-group-keys]');
  return serializeGroupKeys(
    String(keyCarrier?.dataset?.commentPreviewGroupKeys ?? '')
      .split(/\s+/)
      .filter(Boolean),
  ).split(' ').filter(Boolean);
}

/** @this {any} */
function getPreviewGroupKeysAtPoint(x, y) {
  if (!Number.isFinite(x) || !Number.isFinite(y)) {
    return [];
  }

  const targetAtPoint = document.elementFromPoint(x, y);
  const targetKeys = this.getPreviewGroupKeysForTarget(targetAtPoint);
  if (targetKeys.length > 0) {
    return targetKeys;
  }

  const matchingKeys = this.previewHoverRegions
    .filter((region) => region.rects.some((rect) => pointIntersectsRect(x, y, rect)))
    .map((region) => region.key);
  return normalizeGroupKeys(matchingKeys);
}

/** @this {any} */
function updateHoveredPreviewGroups(nextKeys = []) {
  const normalizedKeys = normalizeGroupKeys(nextKeys);
  const signature = normalizedKeys.join(' ');
  if (signature === this.hoveredPreviewGroupKeysSignature) {
    return;
  }

  this.hoveredPreviewGroupKeys = normalizedKeys;
  this.hoveredPreviewGroupKeysSignature = signature;
  this.scheduleLayoutRefresh();
}

/** @this {any} */
function updateHoveredEditorGroups(nextKeys = []) {
  const normalizedKeys = normalizeGroupKeys(nextKeys);
  const signature = normalizedKeys.join(' ');
  if (signature === this.hoveredEditorGroupKeysSignature) {
    return;
  }

  this.hoveredEditorGroupKeys = normalizedKeys;
  this.hoveredEditorGroupKeysSignature = signature;
  this.scheduleLayoutRefresh();
}

/** @this {any} */
function syncHoveredPreviewGroupsFromTarget(target) {
  this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(target));
}

/** @this {any} */
function shouldRenderPassivePreviewMarkers() {
  const previewWidth = this.previewContainer?.clientWidth ?? this.previewElement?.clientWidth ?? 0;
  return window.innerWidth >= COMMENT_PREVIEW_RAIL_BREAKPOINT && previewWidth >= COMMENT_PREVIEW_RAIL_MIN_WIDTH;
}

export const commentUiLayoutMethods = {
  ensureEditorLayer,
  ensurePreviewLayer,
  getPreviewGroupKeysAtPoint,
  getPreviewGroupKeysForTarget,
  refreshLayout,
  renderEditorLayer,
  renderPreviewLayer,
  resolvePreviewTarget,
  scheduleLayoutRefresh,
  shouldRenderPassivePreviewMarkers,
  syncHoveredPreviewGroupsFromTarget,
  syncPreviewRailLayout,
  updateHoveredEditorGroups,
  updateHoveredPreviewGroups,
};
