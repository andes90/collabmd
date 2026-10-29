const OPEN_DETAILS = /^<details(\s+open)?>$/i;
const CLOSE_DETAILS = /^<\/details>$/i;

function lineText(state, line) {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
}

function findClosingDetails(state, start, end) {
  let depth = 1;
  let fence = null;
  for (let line = start + 1; line < end; line += 1) {
    if (state.sCount[line] - state.blkIndent >= 4) continue;
    const text = lineText(state, line);
    const marker = /^(`{3,}|~{3,})(.*)$/u.exec(text);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) fence = null;
      continue;
    }
    if (marker) {
      fence = marker[1];
      continue;
    }
    if (OPEN_DETAILS.test(text)) depth += 1;
    if (CLOSE_DETAILS.test(text)) depth -= 1;
    if (depth === 0) return line;
  }
  return -1;
}

export function enableMarkdownDetails(markdown) {
  markdown.block.ruler.before('code', 'collabmd-details', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const opening = OPEN_DETAILS.exec(lineText(state, start));
    if (!opening) return false;
    const close = findClosingDetails(state, start, end);
    if (close < 0) return false;
    if (silent) return true;

    const token = state.push('details_open', 'details', 1);
    if (opening[1]) token.attrSet('open', '');
    token.map = [start, close + 1];
    const previousLineMax = state.lineMax;
    const previousDepth = state.detailsDepth ?? 0;
    state.lineMax = close;
    state.detailsDepth = previousDepth + 1;
    try {
      state.md.block.tokenize(state, start + 1, close);
    } finally {
      state.lineMax = previousLineMax;
      state.detailsDepth = previousDepth;
    }
    state.push('details_close', 'details', -1);
    state.line = close + 1;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });

  // Existing meeting templates indent multiline summaries, even by four spaces.
  // Accept those only inside a disclosure, while preserving ordinary code blocks.
  markdown.block.ruler.before('code', 'collabmd-summary', (state, start, end, silent) => {
    if (!state.detailsDepth) return false;
    const text = lineText(state, start);
    if (!/^<summary>/i.test(text)) return false;
    let label = text.slice('<summary>'.length);
    let next = start + 1;
    while (!/<\/summary>\s*$/i.test(label) && next < end) {
      label += `\n${lineText(state, next)}`;
      next += 1;
    }
    if (!/<\/summary>\s*$/i.test(label)) return false;
    if (silent) return true;

    const token = state.push('summary_open', 'summary', 1);
    token.map = [start, next];
    const inline = state.push('inline', '', 0);
    inline.content = label.replace(/<\/summary>\s*$/i, '').trim();
    inline.map = [start, next];
    inline.children = [];
    state.push('summary_close', 'summary', -1);
    state.line = next;
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
}
