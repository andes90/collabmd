const ICONS = Object.freeze({
  bold: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M7 5h6a4 4 0 0 1 0 8H7z"/>
      <path d="M7 13h7a4 4 0 0 1 0 8H7z"/>
    </svg>
  `,
  italic: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M14 4h6"/>
      <path d="M4 20h6"/>
      <path d="M14 4 10 20"/>
    </svg>
  `,
  strikethrough: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M6 6.5c1.4-1.2 3.2-1.9 5.4-1.9 3.1 0 5.6 1.4 5.6 3.9 0 2.1-1.7 3-4.3 3.5l-2.4.5c-2.7.5-4.3 1.6-4.3 3.6 0 2.7 2.7 4.2 6 4.2 2.1 0 4.2-.6 5.7-1.8"/>
      <path d="M3 12h18"/>
    </svg>
  `,
  link: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M10 13a5 5 0 0 0 7.54.54l2.92-2.92a5 5 0 0 0-7.07-7.07L11.5 5.4"/>
      <path d="M14 11a5 5 0 0 0-7.54-.54L3.54 13.38a5 5 0 1 0 7.07 7.07L12.5 18.6"/>
    </svg>
  `,
  image: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <circle cx="9" cy="10" r="1.5"/>
      <path d="m21 16-5.5-5.5L7 19"/>
    </svg>
  `,
  video: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="2"/>
      <path d="m10 9 5 3-5 3z" fill="currentColor" stroke="none"/>
    </svg>
  `,
  table: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <rect x="3" y="5" width="18" height="14" rx="1"/>
      <path d="M3 10h18"/>
      <path d="M9 5v14"/>
      <path d="M15 5v14"/>
    </svg>
  `,
  code: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m8 9-4 3 4 3"/>
      <path d="m16 9 4 3-4 3"/>
      <path d="m13 6-2 12"/>
    </svg>
  `,
  horizontalRule: `
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="M4 12h16"/>
      <path d="M9 8h6"/>
      <path d="M9 16h6"/>
    </svg>
  `,
  chevronDown: `
    <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">
      <path d="m6 9 6 6 6-6"/>
    </svg>
  `,
});

const BLOCK_MENU_ACTIONS = Object.freeze([
  {
    action: 'paragraph',
    label: 'Paragraph',
    shortLabel: 'P',
    title: 'Paragraph',
  },
  {
    action: 'heading-1',
    label: 'Heading 1',
    shortLabel: 'H1',
    title: 'Heading 1',
  },
  {
    action: 'heading-2',
    label: 'Heading 2',
    shortLabel: 'H2',
    title: 'Heading 2',
  },
  {
    action: 'heading-3',
    label: 'Heading 3',
    shortLabel: 'H3',
    title: 'Heading 3',
  },
  {
    action: 'heading-4',
    label: 'Heading 4',
    shortLabel: 'H4',
    title: 'Heading 4',
  },
  {
    action: 'heading-5',
    label: 'Heading 5',
    shortLabel: 'H5',
    title: 'Heading 5',
  },
  {
    action: 'heading-6',
    label: 'Heading 6',
    shortLabel: 'H6',
    title: 'Heading 6',
  },
  {
    action: 'quote',
    label: 'Quote',
    shortLabel: 'Quote',
    title: 'Block quote',
  },
  {
    action: 'bullet-list',
    label: 'Bullet list',
    shortLabel: 'List',
    title: 'Bullet list',
  },
  {
    action: 'numbered-list',
    label: 'Numbered list',
    shortLabel: '1.',
    title: 'Numbered list',
  },
  {
    action: 'task-list',
    label: 'Task list',
    shortLabel: 'Task',
    title: 'Task list',
  },
  {
    action: 'code-block',
    label: 'Code block',
    shortLabel: 'Code',
    title: 'Code block',
  },
]);

const INLINE_ACTIONS = Object.freeze([
  { action: 'bold', label: 'Bold', title: 'Bold', icon: ICONS.bold },
  { action: 'italic', label: 'Italic', title: 'Italic', icon: ICONS.italic },
  { action: 'strikethrough', label: 'Strikethrough', title: 'Strikethrough', icon: ICONS.strikethrough },
  { action: 'code', label: 'Inline code', title: 'Inline code', icon: ICONS.code },
]);

const MEDIA_ACTIONS = Object.freeze([
  { action: 'link', label: 'Insert link', title: 'Insert link', icon: ICONS.link },
  { action: 'image', label: 'Insert image', title: 'Insert image', icon: ICONS.image },
  { action: 'video', label: 'Insert video', title: 'Insert video', icon: ICONS.video },
]);

const INSERT_ACTIONS = Object.freeze([
  { action: 'table', label: 'Insert table', title: 'Insert table', icon: ICONS.table },
  { action: 'horizontal-rule', label: 'Insert horizontal rule', title: 'Insert horizontal rule', icon: ICONS.horizontalRule },
]);

export const markdownToolbarLayout = Object.freeze([
  { kind: 'block-menu', actions: BLOCK_MENU_ACTIONS },
  { kind: 'buttons', groupLabel: 'Inline formatting', actions: INLINE_ACTIONS },
  { kind: 'buttons', groupLabel: 'Media and links', actions: MEDIA_ACTIONS },
  { kind: 'buttons', groupLabel: 'Insert', actions: INSERT_ACTIONS },
]);

const ACTIONS = [...BLOCK_MENU_ACTIONS, ...INLINE_ACTIONS, ...MEDIA_ACTIONS, ...INSERT_ACTIONS];

const ACTIONS_BY_ID = new Map(ACTIONS.map((action) => [action.action, action]));

export function getMarkdownToolbarAction(action) {
  return ACTIONS_BY_ID.get(action) ?? null;
}

export function getMarkdownBlockMenuActions() {
  return BLOCK_MENU_ACTIONS;
}

export function isMarkdownBlockAction(action) {
  return BLOCK_MENU_ACTIONS.some((item) => item.action === action);
}

export function getMarkdownBlockActionLabel(action) {
  return getMarkdownToolbarAction(action)?.shortLabel ?? 'P';
}

export function getMarkdownToolbarIcons() {
  return ICONS;
}
