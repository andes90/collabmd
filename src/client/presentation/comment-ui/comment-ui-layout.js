import {
  COMMENT_CONTROL_SLOT_HEIGHT,
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

function setInteractionClasses(element, isActive, isHovered) {
  element.classList.toggle('is-active', isActive);
  element.classList.toggle('is-hovered', isHovered);
  element.classList.toggle('is-passive', !isActive && !isHovered);
}

/** @this {any} */
function refreshLayout() {
  const groups = this.getThreadGroups();
  this.renderEditorLayer(groups);
  this.renderPreviewLayer(groups);
  this.repositionActiveCard();
}

/** @this {any} */
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
function renderEditorLayer(groups = this.getThreadGroups()) {
  const layer = this.ensureEditorLayer();

  if (!this.supported || !this.session) {
    if (layer.childElementCount > 0) {
      layer.replaceChildren();
    }
    return;
  }

  const containerRect = this.editorContainer?.getBoundingClientRect?.();
  if (!containerRect) {
    if (layer.childElementCount > 0) {
      layer.replaceChildren();
    }
    return;
  }

  const existingBadges = new Map(
    Array.from(layer.querySelectorAll('.comment-editor-badge'))
      .map((button) => [button.dataset.commentEditorGroupKey, button]),
  );
  const visibleGroupKeys = new Set();
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

    let button = existingBadges.get(group.key);
    if (!button) {
      button = document.createElement('button');
      button.type = 'button';
      button.className = 'ui-state-marker ui-state-marker--comment comment-editor-badge';
      button.dataset.commentEditorGroupKey = group.key;
      button.addEventListener('pointerdown', (event) => {
        event.preventDefault();
      });
      button.addEventListener('pointerenter', () => {
        this.updateHoveredEditorGroups([button.dataset.commentEditorGroupKey]);
      });
      button.addEventListener('pointerleave', () => {
        this.updateHoveredEditorGroups([]);
      });
      button.addEventListener('focusin', () => {
        this.updateHoveredEditorGroups([button.dataset.commentEditorGroupKey]);
      });
      button.addEventListener('focusout', () => {
        this.updateHoveredEditorGroups([]);
      });
      button.addEventListener('click', () => {
        const currentGroup = button.commentGroup;
        if (!currentGroup) {
          return;
        }
        this.openThreadGroup(currentGroup, {
          anchor: currentGroup.anchor,
          origin: 'editor',
          sourceRect: button.commentSourceRect,
        });
      });
      layer.appendChild(button);
    }

    button.commentGroup = group;
    button.commentSourceRect = rect;
    if (button.dataset.count !== String(group.threads.length)) {
      button.dataset.count = String(group.threads.length);
      button.replaceChildren(createCommentMarkerContent(group.threads.length));
    }
    const isActive = this.activeCard?.groupKey === group.key;
    const isHovered = this.hoveredEditorGroupKeys.includes(group.key);
    setInteractionClasses(button, isActive, isHovered);
    button.setAttribute('aria-label', `${group.threads.length} comment thread${group.threads.length === 1 ? '' : 's'}`);
    const top = Math.max(relativeRect.top, 8);
    button.style.top = `${top}px`;
    button.style.left = `${Math.max(containerRect.width - 36, 8)}px`;
    button.title = `${group.threads.length} comment${group.threads.length === 1 ? '' : 's'}`;
    visibleGroupKeys.add(group.key);
    occupiedTops.push(top);
  });

  existingBadges.forEach((button, groupKey) => {
    if (!visibleGroupKeys.has(groupKey)) {
      button.remove();
    }
  });

  let button = layer.querySelector('.comment-selection-chip');

  if (!this.committedSelectionAnchor || this.activeCard?.mode === 'create') {
    button?.remove();
    return;
  }

  const rect = this.session.getCommentAnchorClientRect?.(this.committedSelectionAnchor);
  const chipRect = this.session.getSelectionChipClientRect?.(this.committedSelectionAnchor) ?? rect;
  if (!chipRect) {
    button?.remove();
    return;
  }

  const relativeRect = toRelativeRect(chipRect, containerRect);
  if (relativeRect.bottom < 0 || relativeRect.top > containerRect.height) {
    button?.remove();
    return;
  }

  const minTop = 8;
  const maxTop = Math.max(containerRect.height - COMMENT_CONTROL_SLOT_HEIGHT, minTop);
  const initialTop = clamp(relativeRect.top, minTop, maxTop);
  const collides = (candidateTop) => occupiedTops.some(
    (top) => Math.abs(top - candidateTop) < (COMMENT_CONTROL_SLOT_HEIGHT - 4),
  );
  let chipTop = initialTop;
  if (collides(chipTop)) {
    let foundTop = null;
    for (
      let candidate = initialTop + COMMENT_CONTROL_SLOT_HEIGHT;
      candidate <= maxTop;
      candidate += COMMENT_CONTROL_SLOT_HEIGHT
    ) {
      if (!collides(candidate)) {
        foundTop = candidate;
        break;
      }
    }
    if (foundTop === null) {
      for (
        let candidate = initialTop - COMMENT_CONTROL_SLOT_HEIGHT;
        candidate >= minTop;
        candidate -= COMMENT_CONTROL_SLOT_HEIGHT
      ) {
        if (!collides(candidate)) {
          foundTop = candidate;
          break;
        }
      }
    }
    chipTop = foundTop ?? initialTop;
  }
  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-selection-pill ui-selection-pill--comment comment-selection-chip';
    button.textContent = 'Comment';
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
      this.openComposerForSelection('editor', button.getBoundingClientRect());
    });
    layer.appendChild(button);
  }
  button.style.top = `${chipTop}px`;
  button.style.right = `${COMMENT_SELECTION_CHIP_GAP}px`;
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
function syncPreviewSelectionButton(previewRect) {
  let button = this.previewLayer?.querySelector('.comment-preview-selection-chip');
  const previewSelection = this.activeCard?.mode !== 'create' ? this.previewSelection : null;
  if (!previewSelection) {
    button?.remove();
    return;
  }

  const selectionRect = createRectFromRects(Array.from(previewSelection.range?.getClientRects?.() ?? []))
    || previewSelection.rect;
  if (!selectionRect) {
    button?.remove();
    return;
  }

  if (!button) {
    button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-chip-button ui-chip-button--comment comment-preview-selection-chip';
    button.textContent = 'Comment';
    button.setAttribute('aria-label', 'Comment on selected preview text');
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
      event.stopPropagation();
    });
    button.addEventListener('click', () => {
      this.openComposerForSelection(
        'preview',
        button.getBoundingClientRect(),
        button.previewSelection,
      );
    });
    this.previewLayer?.appendChild(button);
  }

  button.previewSelection = previewSelection;
  button.style.left = `${clamp(
    selectionRect.left - previewRect.left,
    8,
    Math.max(this.previewElement.clientWidth - 88, 8),
  )}px`;
  button.style.top = `${clamp(
    selectionRect.bottom - previewRect.top + 8,
    8,
    Math.max(this.previewElement.clientHeight - COMMENT_CONTROL_SLOT_HEIGHT, 8),
  )}px`;
}

/** @this {any} */
function renderPreviewLayer(groups = this.getThreadGroups()) {
  this.ensurePreviewLayer();

  if (!this.supported || !this.previewElement) {
    if (this.previewLayer?.childElementCount > 0) {
      this.previewLayer.replaceChildren();
    }
    if (this.previewHighlightLayer?.childElementCount > 0) {
      this.previewHighlightLayer.replaceChildren();
    }
    this.previewHoverRegions = [];
    return;
  }

  const previewRect = this.previewElement.getBoundingClientRect();
  const targetContext = {
    diagramShells: Array.from(this.previewElement.querySelectorAll('.mermaid-shell, .plantuml-shell')),
    sourceBlocks: Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
      .filter((element) => isLeafSourceBlock(element)),
  };
  const existingHighlights = new Map(
    Array.from(this.previewHighlightLayer?.querySelectorAll('[data-comment-preview-highlight-key]') ?? [])
      .map((highlight) => [highlight.dataset.commentPreviewHighlightKey, highlight]),
  );
  const visibleHighlightKeys = new Set();
  const renderHighlight = ({ groupKey = '', isActive, isHovered, key, rect }) => {
    let highlight = existingHighlights.get(key);
    if (!highlight) {
      highlight = document.createElement('div');
      highlight.className = 'comment-preview-highlight';
      highlight.dataset.commentPreviewHighlightKey = key;
      this.previewHighlightLayer?.appendChild(highlight);
    }
    if (groupKey) {
      highlight.dataset.commentPreviewGroupKey = groupKey;
      highlight.dataset.commentPreviewGroupKeys = groupKey;
    } else {
      delete highlight.dataset.commentPreviewGroupKey;
      delete highlight.dataset.commentPreviewGroupKeys;
    }
    setInteractionClasses(highlight, isActive, isHovered);
    highlight.style.left = `${rect.left - previewRect.left}px`;
    highlight.style.top = `${rect.top - previewRect.top}px`;
    highlight.style.width = `${rect.width}px`;
    highlight.style.height = `${rect.height}px`;
    visibleHighlightKeys.add(key);
  };

  if (this.activeCard?.mode === 'create' && this.activeCard.origin === 'preview') {
    const selectionRects = Array.from(this.activeCard.previewRange?.getClientRects?.() ?? []);
    const highlightRects = selectionRects.length > 0
      ? selectionRects
      : [this.resolvePreviewTarget(this.activeCard.anchor, targetContext)?.bubbleRect].filter(Boolean);
    highlightRects.forEach((rect, index) => {
      renderHighlight({
        isActive: true,
        isHovered: false,
        key: `selection:${index}`,
        rect,
      });
    });
  }

  const hoverRegions = [];
  groups.forEach((group) => {
    const target = this.resolvePreviewTarget(group.anchor, targetContext);
    if (!target?.bubbleRect) {
      return;
    }

    hoverRegions.push({
      key: group.key,
      rects: target.hoverRects?.length > 0 ? target.hoverRects : [target.bubbleRect],
    });

    const isActive = this.activeCard?.groupKey === group.key;
    const isHovered = this.hoveredPreviewGroupKeys.includes(group.key);

    target.highlightRects?.forEach((rect, index) => {
      renderHighlight({
        groupKey: group.key,
        isActive,
        isHovered,
        key: `${group.key}:highlight:${index}`,
        rect,
      });
    });
  });

  syncPreviewSelectionButton.call(this, previewRect);

  existingHighlights.forEach((highlight, key) => {
    if (!visibleHighlightKeys.has(key)) {
      highlight.remove();
    }
  });
  this.previewHoverRegions = hoverRegions;
  if (this.lastPreviewPointerPosition) {
    this.updateHoveredPreviewGroups(
      this.getPreviewGroupKeysAtPoint(this.lastPreviewPointerPosition.x, this.lastPreviewPointerPosition.y),
    );
  }
}

function clearPreviewSelection() {
  this.previewSelection = null;
  window.getSelection()?.removeAllRanges();
  this.scheduleLayoutRefresh();
}

/** @this {any} */
function resolvePreviewTarget(anchor, { diagramShells = null, sourceBlocks = null } = {}) {
  if (!this.previewElement || !anchor) {
    return null;
  }

  const diagramShell = (diagramShells ?? Array.from(
    this.previewElement.querySelectorAll('.mermaid-shell, .plantuml-shell'),
  ))
    .find((element) => overlapsAnchorRange(element, anchor));
  if (diagramShell) {
    const rect = diagramShell.getBoundingClientRect();
    return {
      bubbleRect: rect,
      highlightRects: [],
      hoverRects: [rect],
    };
  }

  const candidates = (sourceBlocks ?? Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
    .filter((element) => isLeafSourceBlock(element)))
    .filter((element) => overlapsAnchorRange(element, anchor));

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

  const rect = fallback.getBoundingClientRect();
  return {
    bubbleRect: rect,
    highlightRects: [],
    hoverRects: [rect],
  };
}

/** @this {any} */
function getPreviewGroupKeysForTarget(target) {
  if (!(target instanceof Node)) {
    return [];
  }

  const keyCarrier = target.closest?.('[data-comment-preview-group-keys]');
  if (keyCarrier?.dataset?.commentPreviewGroupKey) {
    return [keyCarrier.dataset.commentPreviewGroupKey];
  }
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
  this.syncHoveredCommentClasses();
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
  this.syncHoveredCommentClasses();
}

/** @this {any} */
function syncHoveredCommentClasses() {
  this.editorLayer?.querySelectorAll('.comment-editor-badge').forEach((button) => {
    const groupKey = button.dataset.commentEditorGroupKey;
    setInteractionClasses(
      button,
      this.activeCard?.groupKey === groupKey,
      this.hoveredEditorGroupKeys.includes(groupKey),
    );
  });

  const previewElements = [
    ...Array.from(this.previewLayer?.querySelectorAll('[data-comment-preview-group-key]') ?? []),
    ...Array.from(this.previewHighlightLayer?.querySelectorAll('[data-comment-preview-group-key]') ?? []),
  ];
  previewElements.forEach((element) => {
    const groupKey = element.dataset.commentPreviewGroupKey;
    setInteractionClasses(
      element,
      this.activeCard?.groupKey === groupKey,
      this.hoveredPreviewGroupKeys.includes(groupKey),
    );
  });
}

/** @this {any} */
function syncHoveredPreviewGroupsFromTarget(target) {
  this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(target));
}

/** @this {any} */
export const commentUiLayoutMethods = {
  clearPreviewSelection,
  ensureEditorLayer,
  ensurePreviewLayer,
  getPreviewGroupKeysAtPoint,
  getPreviewGroupKeysForTarget,
  refreshLayout,
  renderEditorLayer,
  renderPreviewLayer,
  resolvePreviewTarget,
  scheduleLayoutRefresh,
  syncHoveredCommentClasses,
  syncHoveredPreviewGroupsFromTarget,
  updateHoveredEditorGroups,
  updateHoveredPreviewGroups,
};
