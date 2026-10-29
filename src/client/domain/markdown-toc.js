function renderTableOfContents(markdown, tokens, index) {
  const roots = [];
  const parents = [];
  tokens.forEach((token, position) => {
    if (token.type !== 'heading_open' || !token.attrGet('id')) return;
    const inline = tokens[position + 1];
    const label = inline.children?.map((child) => child.content).join('') ?? inline.content;
    const heading = { id: token.attrGet('id'), label, level: Number(token.tag.slice(1)), children: [] };
    while (parents.length && parents.at(-1).level >= heading.level) parents.pop();
    (parents.at(-1)?.children ?? roots).push(heading);
    parents.push(heading);
  });
  if (!roots.length) return '';
  const escape = markdown.utils.escapeHtml;
  const list = (headings) => `<ol>${headings.map((heading) => (
    `<li><a href="#${escape(encodeURIComponent(heading.id))}">${escape(heading.label)}</a>`
    + (heading.children.length ? list(heading.children) : '') + '</li>'
  )).join('')}</ol>`;
  const [start, end] = tokens[index].map;
  return `<nav aria-label="Table of contents" data-source-line="${start + 1}" data-source-line-end="${end}">${list(roots)}</nav>\n`;
}

export function enableMarkdownToc(markdown) {
  markdown.block.ruler.before('paragraph', 'collabmd-toc', (state, start, _end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const text = state.src.slice(state.bMarks[start] + state.tShift[start], state.eMarks[start]).trim();
    if (!/^\[toc\]$/i.test(text)) return false;
    if (silent) return true;
    const token = state.push('collabmd_toc', '', 0);
    token.map = [start, start + 1];
    state.line = start + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  // Render after CollabMD assigns IDs, including contextual duplicate IDs.
  markdown.renderer.rules.collabmd_toc = (tokens, index) => renderTableOfContents(markdown, tokens, index);
}
