const ELEMENT_ID_OVERRIDES = {
  commentsToggleButton: 'commentsToggle',
  diffPage: 'diff-page',
  editorPage: 'editor-page',
  fileHistoryButtonLabel: 'fileHistoryBtnLabel',
  htmlPreviewMaximizeButton: 'htmlPreviewMaximize',
};

export function bindAppShellElements(doc = document) {
  return new Proxy({}, {
    get(_target, property) {
      if (typeof property !== 'string') return undefined;
      const id = ELEMENT_ID_OVERRIDES[property] ?? property.replace(/Button$/, 'Btn');
      return doc.getElementById(id);
    },
  });
}
