import { afterEach, expect, it, vi } from 'vitest';
import { CanvasEditorView } from '../../src/client/presentation/canvas-editor-view.js';

afterEach(() => document.body.replaceChildren());

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
