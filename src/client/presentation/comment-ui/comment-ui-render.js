import { createRenderedCommentBody, formatAnchorLabel, getLatestGroupMessage } from './comment-ui-shared.js';

/**
 * @typedef {object} CommentUiRenderContext
 * @property {boolean} supported
 * @property {boolean} drawerOpen
 * @property {Array<any>} threads
 * @property {any} session
 * @property {any} activeCard
 * @property {HTMLElement | null} commentSelectionButton
 * @property {HTMLElement | null} commentsToggleButton
 * @property {HTMLElement | null} commentsDrawer
 * @property {HTMLElement | null} commentsDrawerList
 * @property {HTMLElement | null} commentsDrawerEmpty
 * @property {HTMLElement | null} cardRoot
 * @property {HTMLElement | null} pendingCardFocusElement
 * @property {any} reactionPicker
 * @property {() => Array<any>} getThreadGroups
 * @property {() => void} renderToolbar
 * @property {() => void} renderDrawer
 * @property {() => void} renderCard
 * @property {() => void} scheduleLayoutRefresh
 * @property {(value: number) => string} formatTimestamp
 * @property {(group: any, options: { anchor: any, origin: string, sourceRect: DOMRect }) => void} openThreadGroup
 */

/** @this {CommentUiRenderContext} */
function render() {
  this.renderToolbar();
  this.renderDrawer();
  this.renderCard();
  this.scheduleLayoutRefresh();
}

/** @this {CommentUiRenderContext} */
function renderToolbar() {
  const totalCount = this.threads.length;
  const showControls = this.supported && Boolean(this.session);
  this.commentSelectionButton?.classList.toggle('hidden', !showControls);
  this.commentsToggleButton?.classList.toggle('hidden', !this.supported);
  if (this.commentSelectionButton) {
    this.commentSelectionButton.disabled = !this.selectionAnchor;
  }
  if (this.commentsToggleButton) {
    this.commentsToggleButton.classList.toggle('active', this.drawerOpen);
    this.commentsToggleButton.setAttribute('aria-expanded', String(this.drawerOpen));
    const label = totalCount > 0 ? `Comments ${totalCount}` : 'Comments';
    const labelElement = this.commentsToggleButton.querySelector('.ui-action-label');
    if (labelElement) {
      labelElement.textContent = label;
    } else {
      this.commentsToggleButton.textContent = label;
    }
  }
}

/** @this {CommentUiRenderContext} */
function renderDrawer() {
  if (!this.commentsDrawer || !this.commentsDrawerList) {
    return;
  }

  this.commentsDrawer.classList.toggle('hidden', !this.supported || !this.drawerOpen);
  this.commentsDrawerList.replaceChildren();
  const groups = this.getThreadGroups();
  this.commentsDrawerEmpty?.classList.toggle('hidden', groups.length > 0);
  if (!this.supported || groups.length === 0) {
    return;
  }

  const fragment = document.createDocumentFragment();
  groups.forEach((group) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'ui-record-surface comments-drawer-item';
    button.classList.toggle('is-active', this.activeCard?.groupKey === group.key);
    button.addEventListener('pointerdown', (event) => {
      event.preventDefault();
    });
    button.addEventListener('click', () => {
      this.openThreadGroup(group, {
        anchor: group.anchor,
        origin: 'drawer',
        sourceRect: button.getBoundingClientRect(),
      });
    });

    const header = document.createElement('div');
    header.className = 'ui-record-header comments-drawer-item-header';

    const title = document.createElement('span');
    title.className = 'comments-drawer-item-title';
    title.textContent = formatAnchorLabel(group.anchor);

    const count = document.createElement('span');
    count.className = 'ui-pill-badge ui-pill-badge--count ui-pill-badge--accent comments-drawer-item-count';
    count.textContent = String(group.threads.length);

    header.append(title, count);

    const quote = document.createElement('p');
    quote.className = 'comments-drawer-item-quote';
    quote.textContent = group.anchor.quote || group.anchor.excerpt || 'Source anchored comment';

    const latestMessage = getLatestGroupMessage(group);
    const preview = createRenderedCommentBody(
      latestMessage?.body || '',
      'comment-markdown comments-drawer-item-preview',
    );

    const footer = document.createElement('div');
    footer.className = 'ui-record-meta comments-drawer-item-footer';
    const countLabel = document.createElement('span');
    countLabel.textContent = `${group.threads.length} thread${group.threads.length === 1 ? '' : 's'}`;

    const updatedLabel = document.createElement('span');
    updatedLabel.className = 'comments-drawer-item-updated';
    updatedLabel.textContent = latestMessage
      ? `${latestMessage.userName} • ${this.formatTimestamp(latestMessage.createdAt)}`
      : '';

    footer.append(countLabel, updatedLabel);

    button.append(header, quote, preview, footer);
    fragment.appendChild(button);
  });

  this.commentsDrawerList.appendChild(fragment);
}

/** @this {CommentUiRenderContext} */
function formatTimestamp(value) {
  if (!Number.isFinite(value)) {
    return '';
  }

  try {
    return this.timeFormatter.format(new Date(value));
  } catch {
    return '';
  }
}

export const commentUiRenderMethods = {
  formatTimestamp,
  render,
  renderDrawer,
  renderToolbar,
};
