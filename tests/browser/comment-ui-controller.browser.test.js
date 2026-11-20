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

function createController({ isMobile = false, onNavigateToLine = () => {}, sourceText = '' } = {}) {
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

  const controller = new CommentUiController({
    commentSelectionButton,
    commentsDrawer,
    commentsDrawerEmpty,
    commentsDrawerList,
    commentsToggleButton,
    editorContainer,
    mobileBreakpointQuery: { matches: isMobile },
    onCreateThread: async () => 'thread-1',
    onNavigateToLine,
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
    getText: () => sourceText,
  };

  controller.attachSession(session);
  controller.setCurrentFile('README.md', { supported: true });

  return { controller, commentSelectionButton, commentsDrawer, commentsToggleButton, previewElement };
}

describe('CommentUiController browser behavior', () => {
  let controller;

  afterEach(() => {
    controller?.destroy();
    controller = null;
    window.getSelection()?.removeAllRanges();
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

  it('navigates to a thread anchor when its drawer item is clicked', () => {
    const navigatedLines = [];
    const setup = createController({
      onNavigateToLine: (lineNumber) => navigatedLines.push(lineNumber),
    });
    controller = setup.controller;

    controller.setThreads([
      {
        anchor: { endLine: 8, quote: 'Anchored range', startLine: 5 },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'Existing thread', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);
    controller.setDrawerOpen(true);

    setup.commentsDrawer.querySelector('.comments-drawer-item').click();

    expect(navigatedLines).toEqual([5]);
    expect(controller.activeCard).toMatchObject({
      groupKey: controller.getThreadGroups()[0].key,
      mode: 'group',
      origin: 'editor',
      sourceRect: expect.objectContaining({ left: 12, top: 24 }),
    });
  });

  it('closes the comments drawer after opening a thread on mobile', () => {
    const setup = createController({ isMobile: true });
    controller = setup.controller;

    controller.setThreads([
      {
        anchor: { endLine: 8, quote: 'Anchored range', startLine: 5 },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'Existing thread', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);
    controller.setDrawerOpen(true);

    setup.commentsDrawer.querySelector('.comments-drawer-item').click();

    expect(controller.drawerOpen).toBe(false);
    expect(setup.commentsDrawer.classList.contains('hidden')).toBe(true);
    expect(setup.commentsToggleButton.getAttribute('aria-expanded')).toBe('false');
    expect(controller.activeCard).toMatchObject({ mode: 'group' });
  });

  it('opens overview-selected threads as editor-anchored cards', () => {
    const setup = createController();
    controller = setup.controller;

    controller.setThreads([
      {
        anchor: { endLine: 6, quote: 'Line 5', startLine: 5 },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'Existing thread', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);

    expect(controller.openThreadFromOverview('thread-1')).toBe(true);

    expect(setup.commentsDrawer.classList.contains('hidden')).toBe(true);
    expect(controller.activeCard).toMatchObject({
      groupThreadIds: ['thread-1'],
      mode: 'group',
      origin: 'editor',
    });
  });

  it('keeps overview-selected comment content inside the mobile viewport', () => {
    const setup = createController();
    controller = setup.controller;
    const originalInnerWidth = window.innerWidth;
    const originalInnerHeight = window.innerHeight;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: 844 });

    try {
      controller.setThreads([
        {
          anchor: { endLine: 21, quote: 'How this will looks like', startLine: 19 },
          createdAt: 1,
          createdByName: 'Alice',
          id: 'thread-1',
          messages: [{ body: 'Full comment content', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
        },
      ]);

      expect(controller.openThreadFromOverview('thread-1')).toBe(true);

      const root = controller.cardRoot;
      const card = root.querySelector('.comment-card');
      root.style.top = '-20px';
      root.style.left = '16px';
      card.getBoundingClientRect = () => createRect({ left: 16, top: -20, width: 358, height: 700 });
      controller.repositionActiveCard();

      expect(Number.parseFloat(root.style.top)).toBeGreaterThanOrEqual(16);
      expect(Number.parseFloat(root.style.left)).toBeGreaterThanOrEqual(16);
      expect(Number.parseFloat(root.style.width)).toBeLessThanOrEqual(358);
      expect(root.textContent).toContain('Full comment content');
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalInnerWidth });
      Object.defineProperty(window, 'innerHeight', { configurable: true, value: originalInnerHeight });
    }
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

  it('shows the initial comment author once with thread actions in the message header', () => {
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

    expect(controller.cardRoot.querySelectorAll('.comment-message-card-author')).toHaveLength(1);
    expect(controller.cardRoot.querySelector('.comment-message-card-author')?.textContent).toBe('Alice');
    expect(controller.cardRoot.querySelector('.comment-thread-card-author')).toBeNull();
    expect(
      controller.cardRoot.querySelector('.comment-message-card-meta > .comment-thread-card-actions'),
    ).not.toBeNull();
    expect(controller.cardRoot.querySelector('.comment-message-card')?.classList.contains('is-thread-start')).toBe(true);
  });

  it('keeps thread actions focused on reply and resolve', () => {
    const setup = createController();
    controller = setup.controller;

    controller.setThreads([
      {
        anchor: { startLine: 1, endLine: 1, quote: 'Line 1' },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'First comment', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);

    const group = controller.getThreadGroups()[0];
    controller.openThreadGroup(group, {
      anchor: group.anchor,
      origin: 'editor',
      sourceRect: createRect({ left: 12, top: 24, width: 100, height: 24 }),
    });

    expect(Array.from(controller.cardRoot.querySelectorAll('.comment-thread-card-action')).map((button) => button.textContent))
      .toEqual(['Reply', 'Resolve']);
  });

  it('preserves a new comment draft when thread updates trigger a card rerender', async () => {
    const setup = createController();
    controller = setup.controller;

    controller.activeCard = {
      anchor: {
        anchorKind: 'text',
        endIndex: 12,
        endLine: 1,
        quote: 'Selected text',
        startIndex: 0,
        startLine: 1,
      },
      composerDraft: null,
      mode: 'create',
      origin: 'editor',
      replyThreadId: null,
      sourceRect: createRect({ left: 12, top: 24, width: 100, height: 24 }),
    };
    controller.renderCard();

    const textarea = controller.cardRoot.querySelector('.comment-card-input');
    textarea.value = 'Draft reply';
    textarea.setSelectionRange(2, 7);
    textarea.focus();

    controller.setThreads([
      {
        anchor: { endLine: 3, quote: 'Line 3', startLine: 3 },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'Existing thread', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);
    await flushFrame();

    const refreshedTextarea = controller.cardRoot.querySelector('.comment-card-input');
    expect(refreshedTextarea.value).toBe('Draft reply');
    expect(refreshedTextarea.selectionStart).toBe(2);
    expect(refreshedTextarea.selectionEnd).toBe(7);
    expect(document.activeElement).toBe(refreshedTextarea);
  });

  it('preserves an open reply draft when collaborative edits move the thread anchor', async () => {
    const setup = createController();
    controller = setup.controller;

    controller.setThreads([
      {
        anchor: { endLine: 1, quote: 'Line 1', startLine: 1 },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'First comment', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);

    let group = controller.getThreadGroups()[0];
    controller.openThreadGroup(group, {
      anchor: group.anchor,
      origin: 'editor',
      sourceRect: createRect({ left: 12, top: 24, width: 100, height: 24 }),
    });

    const replyButton = Array.from(controller.cardRoot.querySelectorAll('.comment-thread-card-action'))
      .find((button) => button.textContent === 'Reply');
    replyButton.click();
    const textarea = controller.cardRoot.querySelector('.comment-reply-form .comment-card-input');
    textarea.value = 'Still typing';
    textarea.setSelectionRange(3, 8);
    textarea.focus();

    controller.setThreads([
      {
        anchor: { endLine: 4, quote: 'Line 1 updated', startLine: 4 },
        createdAt: 1,
        createdByName: 'Alice',
        id: 'thread-1',
        messages: [{ body: 'First comment', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
      },
    ]);
    await flushFrame();

    group = controller.getThreadGroups()[0];
    const refreshedTextarea = controller.cardRoot.querySelector('.comment-reply-form .comment-card-input');
    expect(controller.activeCard.groupKey).toBe(group.key);
    expect(controller.activeCard.anchor).toEqual(group.anchor);
    expect(refreshedTextarea.value).toBe('Still typing');
    expect(refreshedTextarea.selectionStart).toBe(3);
    expect(refreshedTextarea.selectionEnd).toBe(8);
    expect(document.activeElement).toBe(refreshedTextarea);

    const cancelReplyButton = Array.from(controller.cardRoot.querySelectorAll('.comment-thread-card-action'))
      .find((button) => button.textContent === 'Reply' && button.getAttribute('aria-label') === 'Cancel reply');
    cancelReplyButton.click();
    const reopenReplyButton = Array.from(controller.cardRoot.querySelectorAll('.comment-thread-card-action'))
      .find((button) => button.textContent === 'Reply' && button.getAttribute('aria-label') === 'Reply to thread');
    reopenReplyButton.click();

    expect(controller.cardRoot.querySelector('.comment-reply-form .comment-card-input').value).toBe('');
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

  it('keeps comment markers in the editor and out of the preview', () => {
    const setup = createController();
    controller = setup.controller;

    const sourceLine = document.createElement('p');
    sourceLine.dataset.sourceLine = '1';
    sourceLine.dataset.sourceLineEnd = '1';
    sourceLine.textContent = 'Line 1';
    sourceLine.getBoundingClientRect = () => createRect({ left: 40, top: 40, width: 180, height: 24 });
    setup.previewElement.appendChild(sourceLine);
    controller.setThreads([{
      anchor: { endLine: 1, quote: 'Line 1', startLine: 1 },
      createdAt: 1,
      createdByName: 'Alice',
      id: 'thread-1',
      messages: [{ body: 'First comment', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
    }]);

    const groupKey = controller.getThreadGroups()[0].key;
    controller.hoveredPreviewGroupKeys = [groupKey];
    controller.refreshLayout();
    const editorBadge = controller.editorLayer.querySelector('.comment-editor-badge');

    controller.refreshLayout();
    controller.updateHoveredEditorGroups([groupKey]);
    controller.updateHoveredPreviewGroups([groupKey]);

    expect(controller.editorLayer.querySelector('.comment-editor-badge')).toBe(editorBadge);
    expect(controller.previewLayer.querySelector('.comment-preview-badge')).toBeNull();
    expect(editorBadge.classList.contains('is-hovered')).toBe(true);
  });

  it('places the selection chip without hanging when an existing badge sits at the bottom edge', () => {
    const setup = createController();
    controller = setup.controller;
    const editorContainer = document.getElementById('editor');
    editorContainer.getBoundingClientRect = () => createRect({ left: 0, top: 0, width: 320, height: 120 });

    controller.session.getCommentAnchorClientRect = () => createRect({ left: 12, top: 96, width: 160, height: 24 });
    controller.session.getSelectionChipClientRect = () => createRect({ left: 10, top: 96, width: 80, height: 24 });
    controller.setThreads([{
      anchor: { endLine: 5, quote: 'Bottom line', startLine: 5 },
      createdAt: 1,
      createdByName: 'Alice',
      id: 'thread-bottom',
      messages: [{ body: 'Bottom comment', createdAt: 2, id: 'message-1', reactions: [], userName: 'Alice' }],
    }]);
    controller.committedSelectionAnchor = {
      anchorKind: 'text',
      endIndex: 10,
      endLine: 5,
      quote: 'Bottom sel',
      startIndex: 0,
      startLine: 5,
    };

    controller.refreshLayout();

    const chip = controller.editorLayer.querySelector('.comment-selection-chip');
    expect(chip).not.toBeNull();
    expect(Number.parseFloat(chip.style.top)).toBeLessThan(96);
  });
});

describe('CommentUiController preview creation', () => {
  let controller;

  afterEach(() => {
    controller?.destroy();
    controller = null;
    window.getSelection()?.removeAllRanges();
    document.body.innerHTML = '';
  });

  it('opens the existing composer for an exact preview text selection', async () => {
    const setup = createController({ sourceText: 'Read the selected words here.' });
    controller = setup.controller;
    const paragraph = document.createElement('p');
    paragraph.dataset.sourceLine = '1';
    paragraph.dataset.sourceLineEnd = '1';
    paragraph.textContent = 'Read the selected words here.';
    paragraph.getBoundingClientRect = () => createRect({ left: 40, top: 40, width: 240, height: 24 });
    setup.previewElement.appendChild(paragraph);

    const range = document.createRange();
    range.setStart(paragraph.firstChild, 9);
    range.setEnd(paragraph.firstChild, 23);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushFrame();
    await flushFrame();

    setup.previewElement.querySelector('.comment-preview-selection-chip').click();
    await flushFrame();

    expect(controller.activeCard).toMatchObject({
      anchor: {
        anchorKind: 'text',
        endIndex: 23,
        fallbackToLines: false,
        quote: 'selected words',
        startIndex: 9,
      },
      mode: 'create',
      origin: 'preview',
    });
    expect(controller.cardRoot.querySelector('.comment-card-anchor-note')).toBeNull();
    expect(setup.previewElement.querySelector('.comment-preview-highlight')).not.toBeNull();
  });

  it('shows the comment pill for selected task-list text', async () => {
    const setup = createController({ sourceText: '- [ ] First todo' });
    controller = setup.controller;
    const taskItem = document.createElement('li');
    taskItem.className = 'task-list-item';
    taskItem.dataset.sourceLine = '1';
    taskItem.dataset.sourceLineEnd = '1';
    taskItem.getBoundingClientRect = () => createRect({ left: 40, top: 40, width: 240, height: 24 });
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.dataset.taskCheckbox = 'true';
    const text = document.createTextNode(' First todo');
    taskItem.append(checkbox, text);
    setup.previewElement.appendChild(taskItem);

    const range = document.createRange();
    range.setStart(text, 1);
    range.setEnd(text, text.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushFrame();
    await flushFrame();

    const pill = setup.previewElement.querySelector('.comment-preview-selection-chip');
    expect(pill?.classList.contains('ui-chip-button')).toBe(true);
    expect(pill?.classList.contains('ui-selection-pill')).toBe(false);
  });

  it('discloses the line-range fallback for a cross-block preview selection', async () => {
    const setup = createController({ sourceText: 'First paragraph.\n\nSecond paragraph.' });
    controller = setup.controller;
    const first = document.createElement('p');
    first.dataset.sourceLine = '1';
    first.dataset.sourceLineEnd = '1';
    first.textContent = 'First paragraph.';
    first.getBoundingClientRect = () => createRect({ left: 40, top: 40, width: 180, height: 24 });
    const second = document.createElement('p');
    second.dataset.sourceLine = '3';
    second.dataset.sourceLineEnd = '3';
    second.textContent = 'Second paragraph.';
    second.getBoundingClientRect = () => createRect({ left: 40, top: 80, width: 190, height: 24 });
    setup.previewElement.append(first, second);

    const range = document.createRange();
    range.setStart(first.firstChild, 0);
    range.setEnd(second.firstChild, second.textContent.length);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushFrame();
    await flushFrame();

    setup.previewElement.querySelector('.comment-preview-selection-chip').click();

    expect(controller.activeCard.anchor).toMatchObject({
      anchorKind: 'line',
      endLine: 3,
      fallbackToLines: true,
      startLine: 1,
    });
    expect(controller.cardRoot.querySelector('.comment-card-anchor-note')?.textContent).toContain('lines 1-3');
  });

  it('falls back to the source line when selected text is ambiguous', async () => {
    const setup = createController({ sourceText: 'Repeat this, then Repeat this.' });
    controller = setup.controller;
    const paragraph = document.createElement('p');
    paragraph.dataset.sourceLine = '1';
    paragraph.dataset.sourceLineEnd = '1';
    paragraph.textContent = 'Repeat this, then Repeat this.';
    paragraph.getBoundingClientRect = () => createRect({ left: 40, top: 40, width: 240, height: 24 });
    setup.previewElement.appendChild(paragraph);

    const range = document.createRange();
    range.setStart(paragraph.firstChild, 0);
    range.setEnd(paragraph.firstChild, 11);
    window.getSelection().removeAllRanges();
    window.getSelection().addRange(range);
    document.dispatchEvent(new Event('selectionchange'));
    await flushFrame();
    await flushFrame();

    expect(controller.previewSelection.anchor).toMatchObject({
      anchorKind: 'line',
      fallbackToLines: true,
      startLine: 1,
    });
  });
});
