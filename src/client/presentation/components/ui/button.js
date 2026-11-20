function classNames(...parts) {
  return parts.flat().flatMap((part) => (
    part && typeof part === 'object'
      ? Object.keys(part).filter((className) => part[className])
      : part || []
  )).join(' ');
}

export function buttonClassNames({
  variant = 'secondary',
  size = 'md',
  toggle = false,
  toolbar = false,
  action = false,
  wide = false,
  surface = false,
  pill = false,
  hidden = false,
  active = false,
  extra = [],
} = {}) {
  return classNames(
    'ui-button',
    variant && `ui-button--${variant}`,
    size !== 'md' && `ui-button--${size}`,
    {
      'ui-button--toggle': toggle,
      'ui-button--toolbar': toolbar,
      'ui-button--action': action,
      'ui-button--wide': wide,
      'ui-button--surface': surface,
      'ui-button--pill': pill,
      active,
      hidden,
    },
    extra,
  );
}

export function inputClassNames(options = {}) {
  return classNames('ui-input', options.extra ?? []);
}

export function segmentedControlClassNames(options = {}) {
  return classNames('ui-segmented-control', { 'ui-segmented-control--pill': options.pill, hidden: options.hidden }, options.extra ?? []);
}

export function segmentedButtonClassNames(options = {}) {
  return classNames('ui-segmented-btn', { active: options.active, hidden: options.hidden }, options.extra ?? []);
}
