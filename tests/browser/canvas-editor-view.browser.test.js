import { afterEach, expect, it, vi } from 'vitest';
import { CanvasEditorView } from '../../src/client/presentation/canvas-editor-view.js';

afterEach(() => document.body.replaceChildren());

it('keeps canvas wheel gestures moving across cards and hands off content scrolling at its edges', () => {
  const root = document.createElement('div');
  document.body.append(root);
  const view = new CanvasEditorView({ root, actions: { presence: vi.fn() } });
  const content = document.createElement('div');
  content.className = 'canvas-card-content';
  Object.assign(content.style, { width: '120px', height: '80px', overflow: 'auto' });
  const child = document.createElement('div');
  child.textContent = 'Short content';
  content.append(child);
  view.world.append(content);
  let timestamp = 1000;
  const wheel = (target, options = {}, gap = 16) => {
    const event = new WheelEvent('wheel', { bubbles: true, cancelable: true, deltaY: 20, ...options });
    timestamp += gap;
    Object.defineProperty(event, 'timeStamp', { value: timestamp });
    target.dispatchEvent(event);
    return event.defaultPrevented;
  };

  try {
    const initial = { ...view.viewport };
    expect(wheel(child)).toBe(true);
    expect(view.viewport.y).toBe(initial.y - 20);
    Object.assign(child.style, { width: '600px', height: '600px' });
    expect(wheel(child)).toBe(true);
    expect(view.viewport.y).toBe(initial.y - 40);
    expect(content.scrollTop).toBe(0);

    // A fresh gesture inside overflowing content belongs to the native scroller.
    expect(wheel(child, {}, 1000)).toBe(false);
    expect(view.viewport.y).toBe(initial.y - 40);
    content.scrollTop = content.scrollHeight;
    expect(wheel(child)).toBe(true);
    expect(view.viewport.y).toBe(initial.y - 60);
    expect(wheel(child, { deltaY: -20 }, 1000)).toBe(false);
    content.scrollTop = 0;
    expect(wheel(child, { deltaY: -20 })).toBe(true);
    expect(view.viewport.y).toBe(initial.y - 40);

    expect(wheel(child, { shiftKey: true }, 1000)).toBe(false);
    content.scrollLeft = content.scrollWidth;
    expect(wheel(child, { shiftKey: true })).toBe(true);
    expect(view.viewport.x).toBe(initial.x - 20);
    expect(wheel(child, { deltaX: -20, deltaY: 0 }, 1000)).toBe(false);
    content.scrollLeft = 0;
    expect(wheel(child, { deltaX: -20, deltaY: 0 })).toBe(true);
    expect(view.viewport.x).toBe(initial.x);

    const nested = document.createElement('div');
    Object.assign(nested.style, { width: '60px', height: '40px', overflow: 'auto', overscrollBehavior: 'contain' });
    const nestedContent = document.createElement('div');
    nestedContent.style.height = '200px';
    nested.append(nestedContent);
    child.append(nested);
    expect(wheel(nestedContent, {}, 1000)).toBe(false);
    nested.scrollTop = nested.scrollHeight;
    expect(wheel(nestedContent)).toBe(true);

    // Clicking into content releases the preceding pan immediately.
    root.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    expect(wheel(child)).toBe(false);
    expect(wheel(child, { ctrlKey: true, deltaY: -20 })).toBe(true);
    expect(view.viewport.zoom).toBeGreaterThan(initial.zoom);
    const zoom = view.viewport.zoom;
    child.addEventListener('wheel', (event) => event.preventDefault(), { once: true });
    wheel(child, { ctrlKey: true, deltaY: -20 });
    expect(view.viewport.zoom).toBe(zoom);
  } finally {
    view.destroy();
  }
});

it('rejects an old heading choice after a collaborator changes the referenced file', async () => {
  const root = document.createElement('div');
  document.body.append(root);
  let node = { id: 'note', type: 'file', file: 'first.md' };
  const context = {
    root, canEdit: true,
    getNode: () => node,
    readFile: async () => ({ content: '# First section' }),
    actions: { updateNode: vi.fn() },
  };
  CanvasEditorView.prototype.openHeadingPicker.call(context, node.id);
  await vi.waitFor(() => expect(root.querySelectorAll('[role="option"]')).toHaveLength(2));
  node = { ...node, file: 'second.md' };
  root.querySelectorAll('[role="option"]')[1].click();
  expect(context.actions.updateNode).not.toHaveBeenCalled();
  expect(root.querySelector('[role="status"]').textContent).toContain('no longer available');
  context.picker.close();
});
