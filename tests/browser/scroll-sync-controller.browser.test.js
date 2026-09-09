import { expect, it } from 'vitest';

import { ScrollSyncController } from '../../src/client/presentation/scroll-sync-controller.js';

function nextFrame() {
  return new Promise((resolve) => requestAnimationFrame(resolve));
}

it('lets real input take over while layout realignment is synchronizing the other pane', () => {
  const preview = document.createElement('div');
  const editor = document.createElement('div');
  for (const element of [preview, editor]) {
    element.style.cssText = 'height: 100px; overflow: auto;';
    element.innerHTML = '<div data-source-line="1" data-source-line-end="100" style="height: 2000px"></div>';
    document.body.append(element);
  }
  const controller = new ScrollSyncController({
    getEditorLineNumber: () => 30,
    previewContainer: preview,
    previewElement: preview,
    scrollEditorToLine: () => { editor.scrollTop = 400; },
  });
  controller.initialize();
  controller.attachEditorScroller(editor);
  try {
    for (const type of ['wheel', 'touchstart', 'pointerdown', 'keydown']) {
      preview.scrollTop = 500;
      controller.syncEditorToPreview();
      controller.scheduleSync(preview, editor);
      editor.dispatchEvent(new Event(type));
      editor.scrollTop = 600;
      controller.realignAfterLayoutChange();
      expect(editor.scrollTop).toBe(600);
      expect(controller.lastInteractionSource).toBe('editor');
      expect(controller.pendingSync).toBeNull();
      controller.handlePreviewScroll();
      expect(controller.pendingSync).toBeNull();

      // Input in the preview must also take over immediately while it is locked.
      preview.dispatchEvent(new Event(type));
      preview.scrollTop = 700;
      controller.realignAfterLayoutChange();
      expect(preview.scrollTop).toBe(700);
      expect(editor.scrollTop).toBe(400);
      expect(controller.lastInteractionSource).toBe('preview');
    }
  } finally {
    controller.destroy();
    preview.remove();
    editor.remove();
  }
});

it('does not feed a delayed editor layout scroll back into the preview', async () => {
  const preview = document.createElement('div');
  const editor = document.createElement('div');
  for (const element of [preview, editor]) {
    element.style.cssText = 'height: 100px; overflow: auto;';
    element.innerHTML = '<div data-source-line="1" data-source-line-end="100" style="height: 2000px"></div>';
    document.body.append(element);
  }
  preview.scrollTop = 500;
  await nextFrame();
  const controller = new ScrollSyncController({
    getEditorLineNumber: () => 1,
    previewContainer: preview,
    previewElement: preview,
    scrollEditorToLine: () => {
      // Reproduce CodeMirror measuring wrapped lines in the next animation frame.
      requestAnimationFrame(() => { editor.scrollTop = 400; });
    },
  });
  controller.initialize();
  controller.attachEditorScroller(editor);
  try {
    controller.syncEditorToPreview();
    for (let frame = 0; frame < 5; frame += 1) await nextFrame();
    expect(editor.scrollTop).toBe(400);
    expect(preview.scrollTop).toBe(500);
    expect(controller.lastInteractionSource).toBe('preview');
    expect(controller.scrollUnlockFrames.size).toBe(0);

    // Once layout settles, scrolling the other pane must work normally.
    editor.scrollTop = 600;
    for (let frame = 0; frame < 4; frame += 1) await nextFrame();
    expect(controller.lastInteractionSource).toBe('editor');
    expect(preview.scrollTop).toBe(0);
  } finally {
    controller.destroy();
    preview.remove();
    editor.remove();
  }
});

it('keeps the pane receiving input in control after delayed layout scrolling', async () => {
  const preview = document.createElement('div');
  const editor = document.createElement('div');
  for (const element of [preview, editor]) {
    element.style.cssText = 'height: 100px; overflow: auto;';
    element.innerHTML = '<div data-source-line="1" data-source-line-end="100" style="height: 2000px"></div>';
    document.body.append(element);
  }
  preview.scrollTop = 500;
  await nextFrame();
  const controller = new ScrollSyncController({
    getEditorLineNumber: () => 1,
    previewContainer: preview,
    previewElement: preview,
    scrollEditorToLine: () => {
      // Reproduce a layout adjustment after the temporary scroll lock has expired.
      void (async () => {
        for (let frame = 0; frame < 6; frame += 1) await nextFrame();
        editor.scrollTop = 400;
      })();
    },
  });
  controller.initialize();
  controller.attachEditorScroller(editor);
  try {
    preview.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    controller.syncEditorToPreview();
    for (let frame = 0; frame < 12; frame += 1) await nextFrame();
    expect(editor.scrollTop).toBe(400);
    expect(preview.scrollTop).toBe(500);
    expect(controller.lastInteractionSource).toBe('preview');
    expect(controller.scrollUnlockFrames.size).toBe(0);

    // Once layout settles, scrolling the other pane must work normally.
    editor.dispatchEvent(new WheelEvent('wheel', { deltaY: 100 }));
    editor.scrollTop = 600;
    for (let frame = 0; frame < 4; frame += 1) await nextFrame();
    expect(controller.lastInteractionSource).toBe('editor');
    expect(preview.scrollTop).toBe(0);

    // Late preview hydration must not move the editor after input transfers control.
    preview.scrollTop = 700;
    for (let frame = 0; frame < 6; frame += 1) await nextFrame();
    expect(editor.scrollTop).toBe(600);
    expect(controller.lastInteractionSource).toBe('editor');
  } finally {
    controller.destroy();
    preview.remove();
    editor.remove();
  }
});

it('maps Markdown blocks without treating SVG source lines as document lines', () => {
  const preview = document.createElement('div');
  preview.innerHTML = `
    <h1 data-source-line="1" data-source-line-end="1">Title</h1>
    <ul data-source-line="3" data-source-line-end="4">
      <li data-source-line="3" data-source-line-end="3">First</li>
      <li data-source-line="4" data-source-line-end="4">Second</li>
    </ul>
    <div data-source-line="20" data-source-line-end="30">
      <svg data-source-line="1"><g data-source-line="3"><text>Actor</text></g></svg>
    </div>`;
  document.body.append(preview);
  const controller = new ScrollSyncController({
    previewContainer: preview,
    previewElement: preview,
  });

  try {
    const blocks = controller.buildPreviewBlocks();
    expect(blocks.map(({ element, start }) => [element.tagName, start])).toEqual([
      ['H1', 1], ['LI', 3], ['LI', 4], ['DIV', 20],
    ]);
    expect(controller.findBlockForLine(blocks, 3).block.element.tagName).toBe('LI');
    expect(controller.findBlockForLine(blocks, 25).block.start).toBe(20);
    const diagram = blocks.at(-1);
    expect(controller.findBlockForScrollTop(blocks, diagram.top + 1).block).toBe(diagram);
  } finally {
    controller.destroy();
    preview.remove();
  }
});
