import { commentUiCardMethods } from './comment-ui/comment-ui-card.js';
import { commentUiLayoutMethods } from './comment-ui/comment-ui-layout.js';
import { commentUiRenderMethods } from './comment-ui/comment-ui-render.js';
import { commentUiStateMethods } from './comment-ui/comment-ui-state.js';
import { isTextSelectionAnchor } from './comment-ui/comment-ui-shared.js';

export class CommentUiController {
  constructor({
    commentSelectionButton,
    commentsDrawer,
    commentsDrawerEmpty,
    commentsDrawerList,
    commentsToggleButton,
    editorContainer,
    onWillOpenDrawer,
    onCreateThread,
    onNavigateToLine,
    onReplyToThread,
    onToggleReaction,
    onResolveThread,
    previewContainer,
    previewElement,
  }) {
    this.commentSelectionButton = commentSelectionButton;
    this.commentsDrawer = commentsDrawer;
    this.commentsDrawerEmpty = commentsDrawerEmpty;
    this.commentsDrawerList = commentsDrawerList;
    this.commentsToggleButton = commentsToggleButton;
    this.editorContainer = editorContainer;
    this.onWillOpenDrawer = onWillOpenDrawer;
    this.onCreateThread = onCreateThread;
    this.onNavigateToLine = onNavigateToLine;
    this.onReplyToThread = onReplyToThread;
    this.onToggleReaction = onToggleReaction;
    this.onResolveThread = onResolveThread;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;

    this.currentFile = null;
    this.fileKind = 'markdown';
    this.supported = false;
    this.drawerOpen = false;
    this.threads = [];
    this.selectionAnchor = null;
    this.pendingSelectionAnchor = null;
    this.committedSelectionAnchor = null;
    this.selectionRevealTimer = 0;
    this.pointerSelecting = false;
    this.session = null;
    this.activeCard = null;
    this.hoveredEditorGroupKeys = [];
    this.hoveredEditorGroupKeysSignature = '';
    this.hoveredPreviewGroupKeys = [];
    this.hoveredPreviewGroupKeysSignature = '';
    this.previewHoverRegions = [];
    this.lastPreviewPointerPosition = null;
    this.editorLayer = null;
    this.previewLayer = null;
    this.previewHighlightLayer = null;
    this.cardRoot = null;
    this.pendingCardFocusElement = null;
    this.reactionPicker = null;
    this.layoutFrame = 0;
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    });
    this.handleEditorScroll = () => this.scheduleLayoutRefresh();
    this.handlePreviewScroll = () => this.scheduleLayoutRefresh();
    this.handleWindowResize = () => this.scheduleLayoutRefresh();
    this.handlePreviewPointerMove = (event) => {
      this.lastPreviewPointerPosition = { x: event.clientX, y: event.clientY };
      this.updateHoveredPreviewGroups(this.getPreviewGroupKeysAtPoint(event.clientX, event.clientY));
    };
    this.handlePreviewPointerLeave = () => {
      this.lastPreviewPointerPosition = null;
      this.updateHoveredPreviewGroups([]);
    };
    this.handlePreviewFocusIn = (event) => {
      this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(event.target));
    };
    this.handlePreviewFocusOut = (event) => {
      this.updateHoveredPreviewGroups(this.getPreviewGroupKeysForTarget(event.relatedTarget));
    };
    this.handleCommentSelectionButtonPointerDown = (event) => {
      event.preventDefault();
    };
    this.handleEditorPointerDown = (event) => {
      if (event.button !== 0 || !this.supported || !this.session) {
        return;
      }
      if (!event.target?.closest?.('.cm-editor') || event.target?.closest?.('.comment-editor-layer')) {
        return;
      }

      this.pointerSelecting = true;
      this.clearSelectionRevealTimer();
      if (this.committedSelectionAnchor) {
        this.committedSelectionAnchor = null;
        this.scheduleLayoutRefresh();
      }
    };
    this.handleDocumentPointerUp = () => {
      if (!this.pointerSelecting) {
        return;
      }

      requestAnimationFrame(() => {
        const anchor = this.supported ? (this.session?.getCurrentSelectionCommentAnchor?.() ?? null) : null;
        this.pointerSelecting = false;
        this.selectionAnchor = anchor;
        this.renderToolbar();
        this.pendingSelectionAnchor = isTextSelectionAnchor(anchor) ? anchor : null;
        this.clearSelectionRevealTimer();
        this.committedSelectionAnchor = (
          isTextSelectionAnchor(anchor) && this.activeCard?.mode !== 'create'
        ) ? anchor : null;
        this.scheduleLayoutRefresh();
      });
    };
    this.handleEditorFocusOut = (event) => {
      const nextTarget = event.relatedTarget;
      if (
        nextTarget instanceof Node
        && (
          this.editorContainer?.contains(nextTarget)
          || this.cardRoot?.contains(nextTarget)
          || this.commentSelectionButton?.contains(nextTarget)
        )
      ) {
        return;
      }

      this.clearSelectionRevealTimer();
      this.pendingSelectionAnchor = null;
      this.committedSelectionAnchor = null;
      this.scheduleLayoutRefresh();
    };
    this.handleDocumentPointerDown = (event) => {
      const target = event.target;

      if (this.activeCard && this.cardRoot) {
        if (this.cardRoot.contains(target)) {
          return;
        }
        this.closeCard();
      }

      if (!this.drawerOpen) {
        return;
      }

      if (
        target instanceof Node
        && (
          this.commentsDrawer?.contains(target)
          || this.commentsToggleButton?.contains(target)
        )
      ) {
        return;
      }

      this.closeDrawer();
    };
    this.handleDocumentKeyDown = (event) => {
      if (event.key === 'Escape' && this.reactionPicker) {
        this.reactionPicker = null;
        this.renderCard();
        return;
      }
      if (event.key === 'Escape' && this.activeCard) {
        this.closeCard();
      }
      if (event.key === 'Escape' && this.committedSelectionAnchor) {
        this.clearSelectionRevealTimer();
        this.pendingSelectionAnchor = null;
        this.committedSelectionAnchor = null;
        this.scheduleLayoutRefresh();
      }
    };

    this.commentSelectionButton?.addEventListener('pointerdown', this.handleCommentSelectionButtonPointerDown);
    this.commentSelectionButton?.addEventListener('click', () => {
      this.openComposerForSelection('toolbar');
    });
    this.commentsToggleButton?.addEventListener('click', () => {
      this.setDrawerOpen(!this.drawerOpen);
    });
    this.previewContainer?.addEventListener('scroll', this.handlePreviewScroll, { passive: true });
    this.previewElement?.addEventListener('pointermove', this.handlePreviewPointerMove, { passive: true });
    this.previewElement?.addEventListener('pointerleave', this.handlePreviewPointerLeave);
    this.previewElement?.addEventListener('focusin', this.handlePreviewFocusIn);
    this.previewElement?.addEventListener('focusout', this.handlePreviewFocusOut);
    this.editorContainer?.addEventListener('pointerdown', this.handleEditorPointerDown);
    this.editorContainer?.addEventListener('focusout', this.handleEditorFocusOut);
    window.addEventListener('resize', this.handleWindowResize);
    document.addEventListener('pointerup', this.handleDocumentPointerUp);
    document.addEventListener('pointercancel', this.handleDocumentPointerUp);
    document.addEventListener('pointerdown', this.handleDocumentPointerDown);
    document.addEventListener('keydown', this.handleDocumentKeyDown);
  }

  destroy() {
    if (this.layoutFrame) {
      cancelAnimationFrame(this.layoutFrame);
      this.layoutFrame = 0;
    }
    this.attachSession(null);
    this.previewContainer?.removeEventListener('scroll', this.handlePreviewScroll);
    this.previewElement?.removeEventListener('pointermove', this.handlePreviewPointerMove);
    this.previewElement?.removeEventListener('pointerleave', this.handlePreviewPointerLeave);
    this.previewElement?.removeEventListener('focusin', this.handlePreviewFocusIn);
    this.previewElement?.removeEventListener('focusout', this.handlePreviewFocusOut);
    this.commentSelectionButton?.removeEventListener('pointerdown', this.handleCommentSelectionButtonPointerDown);
    this.editorContainer?.removeEventListener('pointerdown', this.handleEditorPointerDown);
    this.editorContainer?.removeEventListener('focusout', this.handleEditorFocusOut);
    window.removeEventListener('resize', this.handleWindowResize);
    document.removeEventListener('pointerup', this.handleDocumentPointerUp);
    document.removeEventListener('pointercancel', this.handleDocumentPointerUp);
    document.removeEventListener('pointerdown', this.handleDocumentPointerDown);
    document.removeEventListener('keydown', this.handleDocumentKeyDown);
    this.previewHoverRegions = [];
    this.cardRoot?.remove();
    this.editorLayer?.remove();
    this.previewLayer?.remove();
    this.pendingCardFocusElement = null;
  }
}

Object.assign(
  CommentUiController.prototype,
  commentUiStateMethods,
  commentUiRenderMethods,
  commentUiLayoutMethods,
  commentUiCardMethods,
);
