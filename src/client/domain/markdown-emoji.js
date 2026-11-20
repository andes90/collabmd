import emojiDefinitions from 'markdown-it-emoji/lib/data/full.mjs';

function isTextFragment(token) {
  return token?.type === 'text' || token?.type === 'text_special';
}

function replaceShortcodes(fragments, wikiTextPattern) {
  const text = fragments.map(({ content }) => content).join('');
  if (!text.includes(':')) return;

  const skip = [...text.matchAll(wikiTextPattern)].map(({ 0: match, index }) => [
    index,
    index + match.split('|', 1)[0].length,
  ]);

  let offset = 0;
  for (const token of fragments) {
    const original = token.content;
    if (token.type === 'text') {
      token.content = original.replace(/:([\w+-]+):/gu, (shortcode, name, index) => {
        if (!Object.hasOwn(emojiDefinitions, name)) return shortcode;
        const start = offset + index;
        return skip.some(([s, e]) => s < start + shortcode.length && e > start)
          ? shortcode
          : emojiDefinitions[name];
      });
    }
    offset += original.length;
  }
}

export function enableMarkdownEmoji(markdown, wikiTextPattern) {
  // Keep text tokens intact for wiki and task rendering, and expand before
  // markdown-it joins escaped characters and entities into ordinary text.
  markdown.core.ruler.before('text_join', 'collabmd-emoji', ({ tokens }) => {
    for (const { type, children } of tokens) {
      if (type !== 'inline' || !children.some((token) => token.type === 'text' && token.content.includes(':'))) continue;

      let inAutoLink = false;
      for (let index = 0; index < children.length; index += 1) {
        const token = children[index];
        if (token.info === 'auto' && (token.type === 'link_open' || token.type === 'link_close')) {
          inAutoLink = token.nesting === 1;
        } else if (!inAutoLink && isTextFragment(token)) {
          const start = index;
          while (isTextFragment(children[index + 1])) index += 1;
          replaceShortcodes(children.slice(start, index + 1), wikiTextPattern);
        }
      }
    }
  });
}
