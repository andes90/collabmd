import { getDiagramActionIconMarkup } from '../domain/diagram-action-icons.js';

export function setDiagramActionButtonIcon(button, iconName) {
  if (!(button instanceof HTMLElement)) {
    return;
  }

  const markup = getDiagramActionIconMarkup(iconName);
  if (!markup) {
    button.classList.remove('is-icon-only');
    button.classList.remove('ui-preview-action--icon-only');
    return;
  }

  button.classList.add('is-icon-only');
  button.classList.add('ui-preview-action--icon-only');
  button.dataset.icon = iconName;
  button.innerHTML = markup.trim();
}
