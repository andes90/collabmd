import assert from 'node:assert/strict';
import test from 'node:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { createCommentOverviewThreadModel } from '../../src/client/presentation/comment-ui/comment-ui-shared.js';
import { DiagramCommentOverviewThreadItem } from '../../src/client/presentation/comment-ui/diagram-comment-overview-thread-item.js';

test('comment overview model supplies defaults and formats message counts', () => {
  assert.deepEqual(createCommentOverviewThreadModel(), {
    author: 'Anonymous',
    countText: '0 messages',
    lineLabel: '',
    previewBody: '',
    quote: 'Source anchored comment',
    timestamp: '',
  });
  assert.equal(createCommentOverviewThreadModel({ messageCount: 1 }).countText, '1 message');
});

test('Excalidraw overview renders formatted Markdown and escapes raw HTML', () => {
  const model = createCommentOverviewThreadModel({
    authorName: '<em>Reviewer</em>',
    lineLabel: 'Diagram element',
    messageCount: 2,
    previewBody: '**Review** the diagram <img src=x onerror=alert(1)>',
    quote: 'Entry point',
  });
  const markup = renderToStaticMarkup(createElement(DiagramCommentOverviewThreadItem, { active: true, model }));

  assert.match(markup, /<strong>Review<\/strong> the diagram &lt;img/);
  assert.doesNotMatch(markup, /<img/);
  assert.match(markup, /&lt;em&gt;Reviewer&lt;\/em&gt;/);
  assert.match(markup, /comments-drawer-item is-active/);
  assert.match(markup, />2 messages</);
});
