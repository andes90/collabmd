import { full as emoji } from 'markdown-it-emoji';

export function enableMarkdownEmoji(markdown) {
  // markdown-it-emoji 3 still uses utilities removed in markdown-it 15.
  // Adapt the plugin's view without changing the parser's shared utilities.
  emoji({
    ...markdown,
    utils: { ...markdown.utils, assign: Object.assign, has: Object.hasOwn },
  }, { shortcuts: {} });
}
