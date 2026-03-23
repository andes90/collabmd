import {
  COMMENT_BODY_MAX_LENGTH,
  COMMENT_CARD_OFFSET,
  COMMENT_CARD_WIDTH,
  COMMENT_REACTION_MORE_EMOJIS,
  COMMENT_REACTION_PRESET_EMOJIS,
  clamp,
  createRenderedCommentBody,
  formatAnchorLabel,
  formatReactionCount,
  getReactionPickerBounds,
  hasLocalReaction,
  isReactionPickerOpen,
} from './comment-ui-shared.js';

/** @this {any} */
function ensureCardRoot() {
  if (this.cardRoot?.isConnected && this.cardRoot.parentElement === document.body) {
    return this.cardRoot;
  }

  const root = document.createElement('div');
  root.className = 'comment-card-root hidden';
  document.body.appendChild(root);
  this.cardRoot = root;
  return root;
}

/** @this {any} */
function openComposerForSelection(origin = 'editor', sourceRect = null) {
  const anchor = this.session?.getCurrentSelectionCommentAnchor?.();
  if (!anchor) {
    return;
  }

  this.selectionAnchor = anchor;
  this.reactionPicker = null;
  const nextOrigin = origin === 'editor' && sourceRect ? 'editor-chip' : origin;
  const nextSourceRect = sourceRect ?? (origin === 'toolbar'
    ? this.commentSelectionButton?.getBoundingClientRect?.()
    : this.session?.getCommentAnchorClientRect?.(anchor));
  this.activeCard = {
    anchor,
    mode: 'create',
    origin: nextOrigin,
    replyThreadId: null,
    sourceRect: nextSourceRect,
  };
  this.render();
}

/** @this {any} */
function openThreadGroup(group, { anchor, origin, sourceRect }) {
  this.reactionPicker = null;
  this.activeCard = {
    anchor,
    groupKey: group.key,
    mode: 'group',
    origin,
    replyThreadId: null,
    sourceRect,
  };
  this.renderDrawer();
  this.renderCard();
}

/** @this {any} */
function closeCard() {
  this.activeCard = null;
  this.pendingCardFocusElement = null;
  this.reactionPicker = null;
  this.renderCard();
  this.scheduleLayoutRefresh();
}

/** @this {any} */
function updateCardSourceRect() {
  if (!this.activeCard) {
    return null;
  }

  if (this.activeCard.origin === 'editor') {
    return this.session?.getCommentAnchorClientRect?.(this.activeCard.anchor) ?? this.activeCard.sourceRect;
  }
  if (this.activeCard.origin === 'editor-chip') {
    return this.activeCard.sourceRect;
  }
  if (this.activeCard.origin === 'preview') {
    return this.resolvePreviewTarget(this.activeCard.anchor)?.bubbleRect ?? this.activeCard.sourceRect;
  }
  if (this.activeCard.origin === 'toolbar') {
    return this.commentSelectionButton?.getBoundingClientRect?.() ?? this.activeCard.sourceRect;
  }

  return this.activeCard.sourceRect;
}

/** @this {any} */
function renderCard() {
  const root = this.ensureCardRoot();
  root.replaceChildren();
  root.classList.toggle('hidden', !this.activeCard);
  if (!this.activeCard) {
    this.pendingCardFocusElement = null;
    root.style.visibility = '';
    return;
  }

  this.pendingCardFocusElement = null;

  const card = document.createElement('section');
  card.className = 'comment-card';
  card.addEventListener('click', (event) => {
    if (
      !this.reactionPicker
      || event.target?.closest?.('.comment-reaction-picker-wrap')
    ) {
      return;
    }

    this.reactionPicker = null;
    requestAnimationFrame(() => {
      if (this.activeCard) {
        this.renderCard();
      }
    });
  });

  const header = document.createElement('div');
  header.className = 'ui-record-header comment-card-header';

  const titleWrap = document.createElement('div');
  titleWrap.className = 'comment-card-title-wrap';

  const title = document.createElement('h3');
  title.className = 'comment-card-title';
  title.textContent = this.activeCard.mode === 'create' ? 'New comment' : 'Comment threads';

  const meta = document.createElement('p');
  meta.className = 'comment-card-meta';
  meta.textContent = formatAnchorLabel(this.activeCard.anchor);

  titleWrap.append(title, meta);

  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-card-close';
  closeButton.setAttribute('aria-label', 'Close comments');
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => this.closeCard());

  header.append(titleWrap, closeButton);
  card.appendChild(header);

  const content = document.createElement('div');
  content.className = 'comment-card-scroll';

  if (this.activeCard.anchor?.quote) {
    const quote = document.createElement('p');
    quote.className = 'comment-card-quote';
    quote.textContent = this.activeCard.anchor.quote;
    content.appendChild(quote);
  }

  if (this.activeCard.mode === 'create') {
    content.appendChild(this.createComposer());
  } else {
    const group = this.getThreadGroups().find((entry) => entry.key === this.activeCard.groupKey);
    if (!group) {
      this.closeCard();
      return;
    }

    group.threads.forEach((thread) => {
      content.appendChild(this.createThreadElement(thread));
    });
  }

  root.style.visibility = 'hidden';
  card.appendChild(content);
  root.appendChild(card);
  this.updateReactionPickerPosition(card);
  this.positionCard(card);
  root.style.visibility = '';
  this.flushPendingCardFocus();
  this.scheduleLayoutRefresh();
}

/** @this {any} */
function updateReactionPickerPosition(card) {
  const bounds = getReactionPickerBounds(card);
  if (!bounds) {
    return;
  }

  const { picker, scroll, wrap } = bounds;
  picker.classList.remove('is-upward');
  picker.style.maxHeight = '';

  const wrapRect = wrap.getBoundingClientRect();
  const scrollRect = scroll.getBoundingClientRect();
  const pickerRect = picker.getBoundingClientRect();
  const safeViewportTop = 12;
  const safeViewportBottom = window.innerHeight - 12;
  const lowerBoundary = Math.min(scrollRect.bottom, safeViewportBottom);
  const upperBoundary = Math.max(scrollRect.top, safeViewportTop);
  const availableBelow = Math.max(lowerBoundary - wrapRect.bottom - 8, 0);
  const availableAbove = Math.max(wrapRect.top - upperBoundary - 8, 0);
  const shouldOpenUpward = pickerRect.height > availableBelow && availableAbove > availableBelow;
  const maxHeight = Math.max((shouldOpenUpward ? availableAbove : availableBelow), 120);

  picker.classList.toggle('is-upward', shouldOpenUpward);
  picker.style.maxHeight = `${maxHeight}px`;
}

/** @this {any} */
function repositionActiveCard() {
  const card = this.cardRoot?.firstElementChild;
  if (!card || !this.activeCard) {
    if (this.cardRoot) {
      this.cardRoot.style.visibility = '';
    }
    return;
  }

  this.positionCard(card);
  this.cardRoot.style.visibility = '';
  this.flushPendingCardFocus();
}

/** @this {any} */
function createComposer() {
  const form = document.createElement('form');
  form.className = 'comment-card-form';

  const textarea = document.createElement('textarea');
  textarea.className = 'input comment-card-input';
  textarea.rows = 4;
  textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
  textarea.placeholder = 'Add context, feedback, or a question...';

  const actions = document.createElement('div');
  actions.className = 'ui-record-actions comment-card-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ui-button btn btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => this.closeCard());

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'ui-button btn btn-primary';
  submit.textContent = 'Post comment';

  actions.append(cancel, submit);
  form.append(textarea, actions);

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const threadId = await this.onCreateThread?.({
      anchor: this.activeCard?.anchor,
      body: textarea.value,
    });
    if (!threadId) {
      textarea.focus();
      return;
    }

    this.closeCard();
  });

  this.pendingCardFocusElement = textarea;
  return form;
}

/** @this {any} */
function createThreadElement(thread) {
  const article = document.createElement('article');
  article.className = 'comment-thread-card';

  const header = document.createElement('div');
  header.className = 'ui-record-header comment-thread-card-header';

  const heading = document.createElement('div');
  heading.className = 'comment-thread-card-heading';

  const author = document.createElement('span');
  author.className = 'comment-thread-card-author';
  author.textContent = thread.createdByName;

  const time = document.createElement('span');
  time.className = 'comment-thread-card-time';
  time.textContent = this.formatTimestamp(thread.createdAt);

  const actions = document.createElement('div');
  actions.className = 'ui-record-actions comment-thread-card-actions';

  const jump = document.createElement('button');
  jump.type = 'button';
  jump.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-thread-card-action';
  jump.textContent = 'Jump';
  jump.addEventListener('click', () => this.onNavigateToLine?.(thread.anchor?.startLine ?? 1));

  const reply = document.createElement('button');
  reply.type = 'button';
  reply.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-thread-card-action';
  const isReplying = this.activeCard?.replyThreadId === thread.id;
  reply.classList.toggle('is-active', isReplying);
  reply.textContent = 'Reply';
  reply.setAttribute('aria-pressed', String(isReplying));
  reply.setAttribute('aria-label', isReplying ? 'Cancel reply' : 'Reply to thread');
  reply.title = isReplying ? 'Cancel reply' : 'Reply to thread';
  reply.addEventListener('click', () => {
    this.activeCard = {
      ...this.activeCard,
      replyThreadId: isReplying ? null : thread.id,
    };
    this.renderCard();
  });

  const resolve = document.createElement('button');
  resolve.type = 'button';
  resolve.className = 'ui-button ui-button--compact btn btn-ghost ui-pill-button ui-action-pill comment-thread-card-action is-danger';
  resolve.textContent = 'Resolve';
  resolve.addEventListener('click', async () => {
    await this.onResolveThread?.(thread.id);
  });

  actions.append(jump, reply, resolve);
  heading.append(author, time);
  header.append(heading, actions);

  article.append(header);

  thread.messages.forEach((message) => {
    article.appendChild(this.createMessageElement(thread, message));
  });

  if (this.activeCard?.replyThreadId === thread.id) {
    article.appendChild(this.createReplyComposer(thread));
  }

  return article;
}

/** @this {any} */
function createMessageElement(thread, message) {
  const container = document.createElement('div');
  container.className = 'comment-message-card';

  const meta = document.createElement('div');
  meta.className = 'ui-record-meta comment-message-card-meta';

  const author = document.createElement('span');
  author.className = 'comment-message-card-author';
  author.textContent = message.userName;

  const time = document.createElement('span');
  time.className = 'comment-message-card-time';
  time.textContent = this.formatTimestamp(message.createdAt);

  const renderedBody = createRenderedCommentBody(
    message.body,
    'comment-message-card-body comment-markdown',
  );

  meta.append(author, time);
  container.append(meta, renderedBody);
  container.appendChild(this.createReactionBar(thread, message));
  return container;
}

/** @this {any} */
function createReactionBar(thread, message) {
  const localUserId = this.session?.getLocalUser?.()?.userId ?? '';
  const wrap = document.createElement('div');
  wrap.className = 'comment-reaction-bar';

  const existingReactionEmojis = new Set((message.reactions ?? []).map((reaction) => reaction.emoji));

  const chips = document.createElement('div');
  chips.className = 'comment-reaction-chips';

  (message.reactions ?? []).forEach((reaction) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'ui-chip-button ui-chip-button--comment comment-reaction-chip';
    chip.classList.toggle('is-active', hasLocalReaction(reaction, localUserId));
    chip.setAttribute('aria-pressed', String(hasLocalReaction(reaction, localUserId)));
    chip.title = reaction.users?.map((user) => user.userName).join(', ') || reaction.emoji;

    const emoji = document.createElement('span');
    emoji.className = 'comment-reaction-chip-emoji';
    emoji.textContent = reaction.emoji;

    const count = document.createElement('span');
    count.className = 'comment-reaction-chip-count';
    count.textContent = formatReactionCount(reaction);

    chip.append(emoji, count);
    chip.addEventListener('click', async () => {
      await this.onToggleReaction?.(thread.id, message.id, reaction.emoji);
    });
    chips.appendChild(chip);
  });

  const actions = document.createElement('div');
  actions.className = 'comment-reaction-actions';

  COMMENT_REACTION_PRESET_EMOJIS
    .filter((emoji) => !existingReactionEmojis.has(emoji))
    .forEach((emoji) => {
      actions.appendChild(this.createQuickReactionButton(thread, message, emoji));
    });

  const pickerWrap = document.createElement('div');
  pickerWrap.className = 'comment-reaction-picker-wrap';

  const moreButton = document.createElement('button');
  moreButton.type = 'button';
  moreButton.className = 'ui-chip-button ui-chip-button--comment comment-reaction-more-trigger';
  moreButton.dataset.reactionPickerToggle = 'true';
  moreButton.setAttribute('aria-expanded', String(
    isReactionPickerOpen(this.reactionPicker, thread.id, message.id),
  ));
  moreButton.textContent = 'More';
  moreButton.addEventListener('click', () => {
    const isOpen = isReactionPickerOpen(this.reactionPicker, thread.id, message.id);
    this.reactionPicker = isOpen
      ? null
      : {
        messageId: message.id,
        threadId: thread.id,
      };
    this.renderCard();
  });

  pickerWrap.appendChild(moreButton);

  if (isReactionPickerOpen(this.reactionPicker, thread.id, message.id)) {
    pickerWrap.appendChild(this.createReactionPicker(thread, message));
  }

  actions.appendChild(pickerWrap);
  wrap.append(chips, actions);
  return wrap;
}

/** @this {any} */
function createQuickReactionButton(thread, message, emoji) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-icon-chip ui-icon-chip--comment comment-reaction-quick-add';
  button.textContent = emoji;
  button.title = `React with ${emoji}`;
  button.addEventListener('click', async () => {
    await this.onToggleReaction?.(thread.id, message.id, emoji);
  });
  return button;
}

/** @this {any} */
function createReactionPicker(thread, message) {
  const picker = document.createElement('div');
  picker.className = 'comment-reaction-picker';
  const moreGrid = document.createElement('div');
  moreGrid.className = 'comment-reaction-picker-grid';
  COMMENT_REACTION_MORE_EMOJIS.forEach((emoji) => {
    moreGrid.appendChild(this.createReactionPickerButton(thread, message, emoji));
  });
  picker.appendChild(moreGrid);

  return picker;
}

/** @this {any} */
function createReactionPickerButton(thread, message, emoji) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'ui-icon-chip ui-icon-chip--comment comment-reaction-picker-btn';
  button.textContent = emoji;
  button.title = `React with ${emoji}`;
  button.addEventListener('click', async () => {
    const didToggle = await this.onToggleReaction?.(thread.id, message.id, emoji);
    if (didToggle) {
      this.reactionPicker = null;
      this.renderCard();
    }
  });
  return button;
}

/** @this {any} */
function createReplyComposer(thread) {
  const form = document.createElement('form');
  form.className = 'comment-reply-form';

  const textarea = document.createElement('textarea');
  textarea.className = 'input comment-card-input';
  textarea.rows = 3;
  textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
  textarea.placeholder = 'Reply to thread...';

  const actions = document.createElement('div');
  actions.className = 'ui-record-actions comment-card-actions';

  const cancel = document.createElement('button');
  cancel.type = 'button';
  cancel.className = 'ui-button btn btn-secondary';
  cancel.textContent = 'Cancel';
  cancel.addEventListener('click', () => {
    this.activeCard = {
      ...this.activeCard,
      replyThreadId: null,
    };
    this.renderCard();
  });

  const submit = document.createElement('button');
  submit.type = 'submit';
  submit.className = 'ui-button btn btn-primary';
  submit.textContent = 'Reply';

  actions.append(cancel, submit);
  form.append(textarea, actions);
  this.pendingCardFocusElement = textarea;

  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const messageId = await this.onReplyToThread?.(thread.id, textarea.value);
    if (!messageId) {
      textarea.focus();
      return;
    }

    this.activeCard = {
      ...this.activeCard,
      replyThreadId: null,
    };
    this.renderCard();
  });

  return form;
}

/** @this {any} */
function positionCard(card) {
  const sourceRect = this.updateCardSourceRect();
  const viewportWidth = window.innerWidth;
  const viewportHeight = window.innerHeight;
  const cardRect = card.getBoundingClientRect();
  const fallbackLeft = clamp((viewportWidth - cardRect.width) / 2, 16, viewportWidth - cardRect.width - 16);
  const fallbackTop = clamp((viewportHeight - cardRect.height) / 4, 16, viewportHeight - cardRect.height - 16);

  let left = fallbackLeft;
  let top = fallbackTop;

  if (sourceRect) {
    left = clamp(
      sourceRect.left,
      16,
      viewportWidth - Math.min(cardRect.width, COMMENT_CARD_WIDTH) - 16,
    );
    top = sourceRect.bottom + COMMENT_CARD_OFFSET;
    if (top + cardRect.height > viewportHeight - 16) {
      top = Math.max(sourceRect.top - cardRect.height - COMMENT_CARD_OFFSET, 16);
    }
  }

  this.cardRoot.style.left = `${left}px`;
  this.cardRoot.style.top = `${top}px`;
  this.cardRoot.style.width = `${Math.min(Math.max(cardRect.width, COMMENT_CARD_WIDTH), viewportWidth - 32)}px`;
}

/** @this {any} */
function flushPendingCardFocus() {
  const element = this.pendingCardFocusElement;
  if (!(element instanceof HTMLElement) || !element.isConnected) {
    this.pendingCardFocusElement = null;
    return;
  }

  this.pendingCardFocusElement = null;
  const focusElement = () => {
    if (!element.isConnected) {
      return;
    }

    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && this.editorContainer?.contains(activeElement)) {
      activeElement.blur();
    }

    element.focus({ preventScroll: true });
  };

  focusElement();
  if (document.activeElement === element) {
    return;
  }

  requestAnimationFrame(() => {
    focusElement();
    if (document.activeElement !== element) {
      setTimeout(() => {
        focusElement();
      }, 50);
    }
  });
}

export const commentUiCardMethods = {
  closeCard,
  createComposer,
  createMessageElement,
  createQuickReactionButton,
  createReactionBar,
  createReactionPicker,
  createReactionPickerButton,
  createReplyComposer,
  createThreadElement,
  ensureCardRoot,
  flushPendingCardFocus,
  openComposerForSelection,
  openThreadGroup,
  positionCard,
  renderCard,
  repositionActiveCard,
  updateCardSourceRect,
  updateReactionPickerPosition,
};
