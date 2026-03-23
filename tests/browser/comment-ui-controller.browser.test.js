import { afterEach, describe, expect, it } from 'vitest';

import { CommentUiController } from '../../src/client/presentation/comment-ui-controller.js';

function createRect({ left = 0, top = 0, width = 0, height = 0 } = {}) {
  return {
    bottom: top + height,
    height,
    left,
    right: left + width,
    top,
    width,
  };
}

function flushFrame() {
  return new Promise((resolve) => {
    requestAnimationFrame(() => resolve());
  });
}

function createController() {
  document.body.innerHTML = `
    <div id="editor"></div>
    <button id="comment-selection"><span class="ui-action-label">Comment</span></button>
    <button id="comments-toggle"><span class="ui-action-label">Comments</span></button>
    <aside id="comments-drawer" class="hidden">
      <div id="comments-drawer-empty"></div>
      <div id="comments-drawer-list"></div>
    </aside>
    <div id="preview-container">
      <div id="preview-content"></div>
    </div>
  `;

  const editorContainer = document.getElementById('editor');
  const previewContainer = document.getElementById('preview-container');
  const previewElement = document.getElementById('preview-content');
  const commentSelectionButton = document.getElementById('comment-selection');
  const commentsToggleButton = document.getElementById('comments-toggle');
  const commentsDrawer = document.getElementById('comments-drawer');
  const commentsDrawerEmpty = document.getElementById('comments-drawer-empty');
  const commentsDrawerList = document.getElementById('comments-drawer-list');

  editorContainer.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 320, height: 240 });
  previewContainer.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 520, height: 320 });
  previewElement.getBoundingClientRect = () => createRect({ left: 20, top: 0, width: 400, height: 320 });
  Object.defineProperty(previewElement, 'clientHeight', { configurable: true, value: 320 });
  Object.defineProperty(previewElement, 'clientWidth', { configurable: true, value: 400 });
  Object.defineProperty(previewContainer, 'clientWidth', { configurable: true, value: 520 });
  previewElement.style.paddingRight = '20px';
  previewElement.style.setProperty('--preview-comment-rail-inset', '16px');

  const controller = new CommentUiController({
    commentSelectionButton,
    commentsDrawer,
    commentsDrawerEmpty,
    commentsDrawerList,
    commentsToggleButton,
    editorContainer,
    onCreateThread: async () => 'thread-1',
    onNavigateToLine: () => {},
    onReplyToThread: async () => 'message-2',
    onResolveThread: async () => true,
    onToggleReaction: async () => true,
    onWillOpenDrawer: () => {},
    previewContainer,
    previewElement,
  });

  const session = {
    getCommentAnchorClientRect: () => createRect({ left: 12, top: 24, width: 160, height: 24 }),
    getCurrentSelectionCommentAnchor: () => null,
    getLocalUser: () => ({ userId: 'local-user' }),
    getScrollContainer: () => editorContainer,
    getSelectionChipClientRect: () => createRect({ left: 10, top: 16, width: 80, height: 24 }),
  };

  controller.attachSession(session);
  controller.setCurrentFile('README.md', { supported: true });

  return { controller, commentSelectionButton, commentsDrawer, previewElement };
}

describe('CommentUiController browser behavior', () => {
  let controller;

  afterEach(() => {
    controller?.destroy();
    controller = null;
    document.body.innerHTML = '';
  });

  it('opens and closes the comments drawer', () => {
    const setup = createController();
    controller = setup.controller;

    controller.setDrawerOpen(true);
    expect(setup.commentsDrawer.classList.contains('hidden')).toBe(false);

    controller.closeDrawer();
    expect(setup.commentsDrawer.classList.contains('hidden')).toBe(true);
  });

  it('updates selection state and enables the toolbar action', () => {
    const setup = createController();
    controller = setup.controller;

    expect(setup.commentSelectionButton.disabled).toBe(true);

    controller.setSelectionAnchor({
      anchorKind: 'text',
      endIndex: 12,
      endLine: 1,
      quote: 'selected text',
      startIndex: 0,
      startLine: 1,
    });

    expect(setup.commentSelectionButton.disabled).toBe(false);
  });

  it('opens and closes the reaction picker for the targeted thread message', async () => {
    const setup = createController();
    controller = setup.controller;

    controller.setThreads([
      {
        anchor: { startLine: 1, endLine: 1, quote: 'Line 1' },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [
          {
            body: 'First comment',
            createdAt: 2,
            id: 'message-1',
            reactions: [],
            userName: 'Alice',
          },
        ],
      },
    ]);

    const group = controller.getThreadGroups()[0];
    controller.openThreadGroup(group, {
      anchor: group.anchor,
      origin: 'editor',
      sourceRect: createRect({ left: 12, top: 24, width: 100, height: 24 }),
    });

    const moreButton = controller.cardRoot.querySelector('[data-reaction-picker-toggle="true"]');
    moreButton.click();
    await flushFrame();

    expect(controller.reactionPicker).toEqual({
      messageId: 'message-1',
      threadId: 'thread-1',
    });
    expect(controller.cardRoot.querySelector('.comment-reaction-picker')).not.toBeNull();

    moreButton.click();
    await flushFrame();

    expect(controller.reactionPicker).toBeNull();
  });

  it('tracks preview hover regions for rendered thread groups', () => {
    const setup = createController();
    controller = setup.controller;

    const sourceLine = document.createElement('p');
    sourceLine.dataset.sourceLine = '1';
    sourceLine.dataset.sourceLineEnd = '1';
    sourceLine.textContent = 'Line 1';
    sourceLine.getBoundingClientRect = () => createRect({ left: 40, top: 40, width: 180, height: 24 });
    setup.previewElement.appendChild(sourceLine);

    controller.setThreads([
      {
        anchor: { startLine: 1, endLine: 1, quote: 'Line 1' },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'First comment', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);

    controller.renderPreviewLayer();

    const keys = controller.getPreviewGroupKeysAtPoint(60, 50);
    expect(keys).toEqual([controller.getThreadGroups()[0].key]);
  });

  it('updates preview rail CSS variables when comment markers need gutter space', () => {
    const setup = createController();
    controller = setup.controller;

    const didChange = controller.syncPreviewRailLayout(140);

    expect(didChange).toBe(true);
    expect(setup.previewElement.style.getPropertyValue('--preview-comment-rail-reserved')).toBe('36px');
    expect(setup.previewElement.style.getPropertyValue('--preview-comment-rail-offset')).toBe('100px');
  });
});
