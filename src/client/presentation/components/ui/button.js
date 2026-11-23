function joinClasses(base, flags = {}, extra = []) {
  return [
    ...base.filter(Boolean),
    ...Object.keys(flags).filter((name) => flags[name]),
    ...[extra].flat().filter(Boolean),
  ].join(' ');
}

export function buttonClassNames({
  variant = 'secondary', size = 'md', toggle = false, toolbar = false, action = false,
  wide = false, surface = false, pill = false, hidden = false, active = false, extra = [],
} = {}) {
  return joinClasses(
    ['ui-button', variant && `ui-button--${variant}`, size !== 'md' && `ui-button--${size}`],
    {
      'ui-button--toggle': toggle, 'ui-button--toolbar': toolbar, 'ui-button--action': action,
      'ui-button--wide': wide, 'ui-button--surface': surface, 'ui-button--pill': pill, active, hidden,
    },
    extra,
  );
}

export const inputClassNames = ({ extra = [] } = {}) => joinClasses(['ui-input'], {}, extra);
export const segmentedControlClassNames = ({ pill, hidden, extra = [] } = {}) => joinClasses(['ui-segmented-control'], { 'ui-segmented-control--pill': pill, hidden }, extra);
export const segmentedButtonClassNames = ({ active, hidden, extra = [] } = {}) => joinClasses(['ui-segmented-btn'], { active, hidden }, extra);
