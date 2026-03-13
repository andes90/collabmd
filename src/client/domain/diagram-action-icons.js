const DIAGRAM_ACTION_ICONS = {
  edit: `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M11.8 1.8a1.5 1.5 0 0 1 2.1 2.1l-7.2 7.2-3.2.9.9-3.2z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
      <path d="M10.7 2.9l2.4 2.4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
    </svg>
  `,
  maximize: `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 2H2v4M10 2h4v4M14 10v4h-4M2 10v4h4" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
    </svg>
  `,
  refresh: `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M13 4.5V1.8M13 1.8h-2.7M13 11.5v2.7M13 14.2h-2.7" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
      <path d="M12.3 4.2A5.3 5.3 0 1 0 13 11.8" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
    </svg>
  `,
  restore: `
    <svg viewBox="0 0 16 16" aria-hidden="true" focusable="false">
      <path d="M6 5V2H2M10 5V2h4M10 11v3h4M6 11v3H2" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
      <path d="M4.5 4.5h7v7h-7z" fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round" stroke-width="1.4"/>
    </svg>
  `,
};

export function setDiagramActionButtonIcon(button, iconName) {
  if (!(button instanceof HTMLElement)) {
    return;
  }

  const markup = DIAGRAM_ACTION_ICONS[iconName];
  if (!markup) {
    button.classList.remove('is-icon-only');
    return;
  }

  button.classList.add('is-icon-only');
  button.dataset.icon = iconName;
  button.innerHTML = markup.trim();
}
