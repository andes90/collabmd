export function commitButtonLabel(count) {
  return count > 0
    ? `Commit ${count} file${count === 1 ? '' : 's'}`
    : 'Commit included files';
}

const GIT_STATUS_BADGE_CLASSES = {
  added: 'ui-status-badge--success',
  deleted: 'ui-status-badge--danger',
  renamed: 'ui-status-badge--accent',
};

export function gitStatusBadgeClass(status, { untrackedClass = 'ui-status-badge--muted' } = {}) {
  if (status === 'untracked') return untrackedClass;
  return GIT_STATUS_BADGE_CLASSES[status] ?? 'ui-status-badge--warning';
}

export function gitSectionChevronSvg(className, size, collapsed = false) {
  return `<svg class="${className}${collapsed ? ' collapsed' : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" aria-hidden="true"><polyline points="6 9 12 15 18 9"/></svg>`;
}
