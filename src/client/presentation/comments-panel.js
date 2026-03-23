import { COMMENT_BODY_MAX_LENGTH } from '../../domain/comment-threads.js';

function isLeafSourceBlock(element) {
  return !element.querySelector('[data-source-line]');
}

function isCommentablePreviewBlock(element) {
  if (!element) {
    return false;
  }

  const interactiveEmbedSelector = '.mermaid-shell, .plantuml-shell, .drawio-embed, .drawio-embed-placeholder, .excalidraw-embed, .excalidraw-embed-placeholder';
  return !element.matches(interactiveEmbedSelector) && !element.querySelector(interactiveEmbedSelector);
}

function parseLineNumber(value) {
  const parsed = Number.parseInt(value || '', 10);
  return Number.isFinite(parsed) ? parsed : null;
}

function formatLineLabel(anchor) {
  if (!anchor) {
    return 'No source anchor';
  }

  return anchor.startLine === anchor.endLine
    ? `Line ${anchor.startLine}`
    : `Lines ${anchor.startLine}-${anchor.endLine}`;
}

function sortThreads(threads = []) {
  return [...threads].sort((left, right) => (
    (left.anchor?.startLine ?? 0) - (right.anchor?.startLine ?? 0)
      || left.createdAt - right.createdAt
  ));
}

export class CommentsPanel {
  constructor({
    panelElement,
    previewContainer,
    previewElement,
    toggleButton,
    onCreateThread,
    onNavigateToLine,
    onReplyToThread,
    onResolveThread,
  }) {
    this.panel = panelElement;
    this.previewContainer = previewContainer;
    this.previewElement = previewElement;
    this.toggleButton = toggleButton;
    this.onCreateThread = onCreateThread;
    this.onNavigateToLine = onNavigateToLine;
    this.onReplyToThread = onReplyToThread;
    this.onResolveThread = onResolveThread;

    this.header = this.panel?.querySelector('.comments-header');
    this.toggle = this.panel?.querySelector('.comments-toggle');
    this.countBadge = this.panel?.querySelector('.comments-count');
    this.body = this.panel?.querySelector('.comments-body');
    this.emptyState = this.panel?.querySelector('.comments-empty-state');
    this.list = this.panel?.querySelector('.comments-list');
    this.composer = this.panel?.querySelector('.comment-composer');
    this.composerForm = this.panel?.querySelector('#commentComposerForm');
    this.composerLabel = this.panel?.querySelector('#commentComposerLabel');
    this.composerInput = this.panel?.querySelector('#commentComposerInput');
    this.composerCancel = this.panel?.querySelector('#commentComposerCancel');
    this.replyDraftThreadId = null;
    this.currentFile = null;
    this.draftAnchor = null;
    this.expanded = false;
    this.pendingFocusTarget = null;
    this.supported = false;
    this.threads = [];
    this.timeFormatter = new Intl.DateTimeFormat(undefined, {
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      month: 'short',
    });

    if (this.composerInput) {
      this.composerInput.setAttribute('maxlength', String(COMMENT_BODY_MAX_LENGTH));
    }

    this.bindEvents();
    this.render();
  }

  bindEvents() {
    this.header?.addEventListener('click', () => {
      if (!this.currentFile || !this.supported) {
        return;
      }

      this.expanded = !this.expanded;
      this.render();
      if (this.expanded) {
        this.scrollIntoView();
      }
    });

    this.header?.addEventListener('keydown', (event) => {
      if (event.key !== 'Enter' && event.key !== ' ') {
        return;
      }

      event.preventDefault();
      this.header.click();
    });

    this.toggleButton?.addEventListener('click', (event) => {
      event.preventDefault();
      if (!this.currentFile || !this.supported) {
        return;
      }

      this.expanded = !this.expanded;
      this.render();
      if (this.expanded) {
        this.scrollIntoView();
      }
    });

    this.composerCancel?.addEventListener('click', () => {
      this.clearDraft();
    });

    this.composerForm?.addEventListener('submit', async (event) => {
      event.preventDefault();
      if (!this.draftAnchor || !this.composerInput) {
        return;
      }

      const threadId = await this.onCreateThread?.({
        body: this.composerInput.value,
        endLine: this.draftAnchor.endLine,
        startLine: this.draftAnchor.startLine,
      });

      if (!threadId) {
        this.composerInput.focus();
        return;
      }

      this.composerInput.value = '';
      this.clearDraft({ keepExpanded: true });
    });
  }

  setCurrentFile(filePath, { supported = false } = {}) {
    const didChangeFile = this.currentFile !== filePath;
    this.currentFile = filePath;
    this.supported = Boolean(filePath && supported);

    if (!this.supported) {
      this.draftAnchor = null;
      this.replyDraftThreadId = null;
      this.expanded = false;
      this.threads = [];
    } else if (didChangeFile) {
      this.draftAnchor = null;
      this.replyDraftThreadId = null;
      this.expanded = false;
    }

    this.render();
    this.decoratePreviewAnchors();
  }

  setThreads(threads = []) {
    this.threads = sortThreads(threads);
    if (this.replyDraftThreadId && !this.threads.some((thread) => thread.id === this.replyDraftThreadId)) {
      this.replyDraftThreadId = null;
    }

    this.render();
    this.decoratePreviewAnchors();
  }

  openComposerForRange(anchor, { scrollIntoView = true } = {}) {
    if (!this.supported) {
      return;
    }

    this.draftAnchor = {
      endLine: Math.max(Math.round(anchor?.endLine ?? anchor?.startLine ?? 1), 1),
      startLine: Math.max(Math.round(anchor?.startLine ?? 1), 1),
    };
    if (this.draftAnchor.endLine < this.draftAnchor.startLine) {
      this.draftAnchor.endLine = this.draftAnchor.startLine;
    }

    this.replyDraftThreadId = null;
    this.expanded = true;
    this.pendingFocusTarget = 'composer';
    this.render();
    this.decoratePreviewAnchors();

    if (scrollIntoView) {
      this.scrollIntoView();
    }
  }

  clearDraft({ keepExpanded = false } = {}) {
    this.draftAnchor = null;
    this.pendingFocusTarget = null;
    if (!keepExpanded) {
      this.expanded = false;
    }

    this.render();
    this.decoratePreviewAnchors();
  }

  decoratePreviewAnchors() {
    if (!this.previewElement) {
      return;
    }

    Array.from(this.previewElement.querySelectorAll('.comment-anchor-btn')).forEach((button) => button.remove());
    Array.from(this.previewElement.querySelectorAll('.comment-anchor-target')).forEach((element) => {
      element.classList.remove('comment-anchor-target', 'has-comments', 'is-comment-target');
    });

    if (!this.supported) {
      return;
    }

    if (this.previewElement.querySelector('.mermaid-shell, .plantuml-shell, .drawio-embed, .drawio-embed-placeholder, .excalidraw-embed, .excalidraw-embed-placeholder')) {
      return;
    }

    const blocks = Array.from(this.previewElement.querySelectorAll('[data-source-line]'))
      .filter((element) => isLeafSourceBlock(element) && isCommentablePreviewBlock(element));

    blocks.forEach((block) => {
      const startLine = parseLineNumber(block.getAttribute('data-source-line'));
      const endLine = parseLineNumber(block.getAttribute('data-source-line-end')) ?? (startLine ?? 1);
      if (!startLine) {
        return;
      }

      const matchingThreads = this.threads.filter((thread) => (
        thread.anchor?.startLine >= startLine && thread.anchor?.startLine < Math.max(endLine, startLine + 1)
      ));
      const totalCount = matchingThreads.length;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'comment-anchor-btn';
      button.setAttribute('aria-label', totalCount > 0
        ? `${totalCount} comments on ${formatLineLabel({ endLine, startLine })}`
        : `Add comment on ${formatLineLabel({ endLine, startLine })}`);
      button.title = totalCount > 0
        ? `${totalCount} comments`
        : `Add comment on ${formatLineLabel({ endLine, startLine })}`;
      button.dataset.count = totalCount > 0 ? String(totalCount) : '+';

      button.addEventListener('click', (event) => {
        event.preventDefault();
        event.stopPropagation();
        this.openComposerForRange({ endLine, startLine });
      });

      block.classList.add('comment-anchor-target');
      block.classList.toggle('has-comments', totalCount > 0);
      block.classList.toggle(
        'is-comment-target',
        this.draftAnchor?.startLine === startLine && this.draftAnchor?.endLine === endLine,
      );
      button.classList.toggle('has-comments', totalCount > 0);
      button.classList.toggle('has-open-comments', totalCount > 0);
      block.appendChild(button);
    });
  }

  render() {
    if (!this.panel) {
      return;
    }

    const totalCount = this.threads.length;
    const label = totalCount === 0
      ? 'Comments'
      : `${totalCount} comment${totalCount === 1 ? '' : 's'}`;
    const shouldShowPanel = Boolean(
      this.currentFile && this.supported && (this.expanded || this.draftAnchor || totalCount > 0),
    );

    this.panel.classList.toggle('hidden', !shouldShowPanel);
    this.panel.classList.toggle('expanded', this.expanded);
    this.body?.setAttribute('aria-hidden', String(!this.expanded));
    this.header?.setAttribute('aria-expanded', String(this.expanded));

    if (this.body) {
      this.body.toggleAttribute('inert', !this.expanded);
    }

    if (this.toggle) {
      this.toggle.textContent = label;
    }

    if (this.countBadge) {
      this.countBadge.textContent = totalCount > 0 ? String(totalCount) : '';
    }

    if (this.toggleButton) {
      this.toggleButton.classList.toggle('hidden', !this.currentFile || !this.supported);
      this.toggleButton.classList.toggle('active', this.expanded);
      this.toggleButton.setAttribute('aria-expanded', String(this.expanded));
      this.toggleButton.textContent = totalCount > 0 ? `Comments ${totalCount}` : 'Comments';
    }

    this.renderComposer();
    this.renderThreads();
    this.focusPendingTarget();
  }

  renderComposer() {
    if (!this.composer || !this.composerLabel || !this.composerInput) {
      return;
    }

    const visible = Boolean(this.draftAnchor);
    this.composer.classList.toggle('hidden', !visible);
    this.composerLabel.textContent = visible
      ? `New comment on ${formatLineLabel(this.draftAnchor)}`
      : '';
    this.composerInput.disabled = !visible;

    if (!visible) {
      this.composerInput.value = '';
    }

    if (this.emptyState) {
      this.emptyState.classList.toggle('hidden', visible || this.threads.length > 0);
    }
  }

  renderThreads() {
    if (!this.list) {
      return;
    }

    this.list.replaceChildren();
    if (this.threads.length === 0) {
      return;
    }

    const fragment = document.createDocumentFragment();
    this.threads.forEach((thread) => {
      fragment.appendChild(this.createThreadElement(thread));
    });
    this.list.appendChild(fragment);
  }

  createThreadElement(thread) {
    const article = document.createElement('article');
    article.className = 'comment-thread';

    const header = document.createElement('div');
    header.className = 'comment-thread-header';

    const meta = document.createElement('div');
    meta.className = 'comment-thread-meta';

    const anchorButton = document.createElement('button');
    anchorButton.type = 'button';
    anchorButton.className = 'comment-thread-anchor';
    anchorButton.textContent = formatLineLabel(thread.anchor);
    anchorButton.addEventListener('click', () => {
      this.onNavigateToLine?.(thread.anchor?.startLine ?? 1);
    });

    const status = document.createElement('span');
    status.className = 'comment-thread-status';
    status.textContent = 'Open';

    meta.append(anchorButton, status);

    const actions = document.createElement('div');
    actions.className = 'comment-thread-actions';

    const replyButton = document.createElement('button');
    replyButton.type = 'button';
    replyButton.className = 'comment-thread-action';
    replyButton.textContent = this.replyDraftThreadId === thread.id ? 'Cancel reply' : 'Reply';
    replyButton.addEventListener('click', () => {
      this.replyDraftThreadId = this.replyDraftThreadId === thread.id ? null : thread.id;
      this.pendingFocusTarget = this.replyDraftThreadId ? thread.id : null;
      this.render();
    });

    const resolveButton = document.createElement('button');
    resolveButton.type = 'button';
    resolveButton.className = 'comment-thread-action';
    resolveButton.textContent = 'Resolve';
    resolveButton.addEventListener('click', async () => {
      await this.onResolveThread?.(thread.id, true);
    });

    actions.append(replyButton, resolveButton);
    header.append(meta, actions);

    const excerpt = document.createElement('p');
    excerpt.className = 'comment-thread-excerpt';
    excerpt.textContent = thread.anchor?.excerpt || 'No source excerpt';

    const messages = document.createElement('div');
    messages.className = 'comment-thread-messages';
    thread.messages.forEach((message) => {
      messages.appendChild(this.createMessageElement(message));
    });

    article.append(header, excerpt, messages);

    if (this.replyDraftThreadId === thread.id) {
      article.appendChild(this.createReplyComposer(thread));
    }

    return article;
  }

  createMessageElement(message) {
    const container = document.createElement('div');
    container.className = 'comment-message';

    const meta = document.createElement('div');
    meta.className = 'comment-message-meta';

    const author = document.createElement('span');
    author.className = 'comment-message-author';
    author.textContent = message.userName;

    const time = document.createElement('span');
    time.className = 'comment-message-time';
    time.textContent = this.formatTimestamp(message.createdAt);

    meta.append(author, time);

    const body = document.createElement('p');
    body.className = 'comment-message-body';
    body.textContent = message.body;

    container.append(meta, body);
    return container;
  }

  createReplyComposer(thread) {
    const form = document.createElement('form');
    form.className = 'comment-reply-form';

    const textarea = document.createElement('textarea');
    textarea.className = 'input comment-reply-input';
    textarea.rows = 3;
    textarea.placeholder = `Reply on ${formatLineLabel(thread.anchor)}...`;
    textarea.maxLength = COMMENT_BODY_MAX_LENGTH;
    textarea.dataset.replyThreadId = thread.id;

    const actions = document.createElement('div');
    actions.className = 'comment-reply-actions';

    const cancelButton = document.createElement('button');
    cancelButton.type = 'button';
    cancelButton.className = 'ui-button btn btn-secondary';
    cancelButton.textContent = 'Cancel';
    cancelButton.addEventListener('click', () => {
      this.replyDraftThreadId = null;
      this.render();
    });

    const submitButton = document.createElement('button');
    submitButton.type = 'submit';
    submitButton.className = 'ui-button btn btn-primary';
    submitButton.textContent = 'Reply';

    actions.append(cancelButton, submitButton);
    form.append(textarea, actions);

    form.addEventListener('submit', async (event) => {
      event.preventDefault();
      const messageId = await this.onReplyToThread?.(thread.id, textarea.value);
      if (!messageId) {
        textarea.focus();
        return;
      }

      this.replyDraftThreadId = null;
      this.render();
    });

    return form;
  }

  focusPendingTarget() {
    if (!this.pendingFocusTarget) {
      return;
    }

    const target = this.pendingFocusTarget;
    this.pendingFocusTarget = null;
    requestAnimationFrame(() => {
      if (target === 'composer') {
        this.composerInput?.focus();
        return;
      }

      this.panel?.querySelector(`textarea[data-reply-thread-id="${target}"]`)?.focus();
    });
  }

  formatTimestamp(value) {
    if (!Number.isFinite(value)) {
      return '';
    }

    try {
      return this.timeFormatter.format(new Date(value));
    } catch {
      return '';
    }
  }

  scrollIntoView() {
    this.panel?.scrollIntoView({
      behavior: 'smooth',
      block: 'start',
    });
  }
}
