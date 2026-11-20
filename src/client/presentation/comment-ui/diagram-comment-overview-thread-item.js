import { createElement } from 'react';
import { renderCommentMarkdownToHtml } from '../comment-markdown-renderer.js';

export function DiagramCommentOverviewThreadItem({ active, model, onOpen }) {
  return createElement('button', {
    className: `comment-overview-thread comments-drawer-item${active ? ' is-active' : ''}`,
    onClick: onOpen,
    type: 'button',
  },
  createElement('div', { className: 'comment-overview-thread-header comments-drawer-item-header' },
    createElement('span', { className: 'comment-overview-thread-line comments-drawer-item-title' }, model.lineLabel),
    createElement('span', { className: 'comment-overview-thread-meta' }, model.timestamp)),
  createElement('div', { className: 'comment-overview-thread-body' },
    createElement('div', {
      className: 'comment-markdown comment-overview-thread-preview comments-drawer-item-preview',
      dangerouslySetInnerHTML: { __html: renderCommentMarkdownToHtml(model.previewBody) },
    }),
    createElement('div', { className: 'comment-overview-thread-section comment-overview-thread-reference' },
      createElement('span', { className: 'comment-overview-thread-section-label' }, 'Reference'),
      createElement('span', { className: 'comment-overview-thread-quote comments-drawer-item-quote' }, model.quote))),
  createElement('div', { className: 'comment-overview-thread-footer comments-drawer-item-footer' },
    createElement('span', { className: 'comment-overview-thread-author' }, model.author),
    createElement('span', { className: 'comment-overview-thread-message-count' }, model.countText)));
}
