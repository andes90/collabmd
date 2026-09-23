import { Compartment, EditorState } from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import { defaultKeymap } from '@codemirror/commands';
import { markdown } from '@codemirror/lang-markdown';
import { yCollab, yUndoManagerKeymap } from 'y-codemirror.next';

export function createCanvasTextEditor({ parent, text, awareness, undoManager, onClose }) {
  const editable = new Compartment();
  let readOnly = false;
  const view = new EditorView({
    parent,
    state: EditorState.create({
      doc: text.toString(),
      extensions: [
        markdown(), EditorView.lineWrapping,
        EditorView.contentAttributes.of({ 'aria-label': 'Edit canvas text' }),
        editable.of(EditorView.editable.of(true)),
        yCollab(text, awareness, { undoManager }),
        keymap.of([
          { key: 'Escape', run: () => { onClose(); return true; } },
          ...yUndoManagerKeymap, ...defaultKeymap,
        ]),
      ],
    }),
  });
  view.focus();
  return {
    text,
    destroy: () => view.destroy(),
    setReadOnly: (nextReadOnly) => {
      if (readOnly === nextReadOnly) return;
      readOnly = nextReadOnly;
      view.dispatch({ effects: editable.reconfigure(EditorView.editable.of(!readOnly)) });
    },
  };
}
