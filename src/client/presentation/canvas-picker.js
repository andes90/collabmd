import { createFileSearchEntry, findFileSearchMatch } from '../domain/file-search.js';

export function openCanvasPicker({ root, title, loadChoices, onChoose, canChoose }) {
  const previousFocus = document.activeElement;
  const dialog = document.createElement('dialog');
  dialog.className = 'canvas-picker';
  const heading = document.createElement('h2');
  heading.id = `canvas-picker-${crypto.randomUUID()}`;
  heading.textContent = title;
  dialog.setAttribute('aria-labelledby', heading.id);
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.className = 'canvas-button';
  closeButton.textContent = 'Close';
  const header = document.createElement('header');
  header.append(heading, closeButton);
  const input = document.createElement('input');
  input.type = 'search';
  input.placeholder = title;
  input.setAttribute('aria-label', title);
  input.setAttribute('role', 'combobox');
  input.setAttribute('aria-autocomplete', 'list');
  input.setAttribute('aria-expanded', 'true');
  input.autocomplete = 'off';
  const list = document.createElement('div');
  list.id = `${heading.id}-results`;
  list.className = 'canvas-picker-results';
  list.setAttribute('role', 'listbox');
  list.setAttribute('aria-label', 'Suggestions');
  input.setAttribute('aria-controls', list.id);
  const status = document.createElement('p');
  status.className = 'canvas-picker-status';
  status.setAttribute('role', 'status');
  status.textContent = 'Loading…';
  dialog.append(header, input, list, status);
  root.append(dialog);
  let choices = [];
  let filtered = [];
  let index = 0;
  let closed = false;
  const close = () => {
    if (closed) return;
    closed = true;
    dialog.close();
    dialog.remove();
    if (previousFocus?.isConnected) previousFocus.focus({ preventScroll: true });
  };
  const choose = (choice) => {
    if (!choice) return;
    if (!canChoose()) { status.textContent = 'This selection is no longer available. Close and try again.'; return; }
    close();
    onChoose(choice.value);
  };
  const select = (next) => {
    index = Math.max(0, Math.min(filtered.length - 1, next));
    [...list.children].forEach((option, position) => option.setAttribute('aria-selected', String(position === index)));
    const active = list.children[index];
    if (active) {
      input.setAttribute('aria-activedescendant', active.id);
      active.scrollIntoView({ block: 'nearest' });
    } else input.removeAttribute('aria-activedescendant');
  };
  const render = () => {
    const query = input.value.trim().toLowerCase();
    const matches = choices.map((choice) => ({ choice, score: query ? findFileSearchMatch(choice.search, query)?.score : 1 }))
      .filter(({ score }) => score !== undefined).sort((a, b) => b.score - a.score);
    filtered = matches.slice(0, 100).map(({ choice }) => choice);
    list.replaceChildren(...filtered.map((choice, position) => {
      const option = document.createElement('button');
      option.type = 'button';
      option.tabIndex = -1;
      option.id = `${list.id}-${position}`;
      option.setAttribute('role', 'option');
      const label = document.createElement('span');
      label.textContent = choice.label;
      const detail = document.createElement('small');
      detail.textContent = choice.detail || '';
      option.append(label, detail);
      option.addEventListener('click', () => choose(choice));
      return option;
    }));
    status.textContent = matches.length > 100 ? 'Showing the first 100 matches. Type to narrow the list.'
      : (matches.length ? '↑ ↓ to navigate · Enter to choose · Esc to close' : 'No matches.');
    select(0);
  };
  closeButton.addEventListener('click', close);
  dialog.addEventListener('cancel', (event) => { event.preventDefault(); close(); });
  dialog.addEventListener('click', (event) => {
    const bounds = dialog.getBoundingClientRect();
    if (event.target === dialog && (event.clientX < bounds.left || event.clientX > bounds.right
      || event.clientY < bounds.top || event.clientY > bounds.bottom)) close();
  });
  dialog.addEventListener('keydown', (event) => {
    event.stopPropagation();
    if (event.key === 'Escape') { event.preventDefault(); close(); return; }
    if (event.target !== input) return;
    if (['ArrowDown', 'ArrowUp', 'Enter'].includes(event.key)) event.preventDefault();
    if (event.key === 'ArrowDown') select(index + 1);
    if (event.key === 'ArrowUp') select(index - 1);
    if (event.key === 'Enter') choose(filtered[index]);
  });
  input.addEventListener('input', render);
  dialog.showModal();
  input.focus();
  Promise.resolve().then(loadChoices).then((loaded) => {
    if (closed) return;
    choices = loaded.map((choice) => ({ ...choice, search: createFileSearchEntry(choice.searchText || `${choice.label} ${choice.detail || ''}`) }));
    render();
  }).catch(() => { if (!closed) status.textContent = 'Suggestions unavailable. Close and try again.'; });
  return { close };
}
