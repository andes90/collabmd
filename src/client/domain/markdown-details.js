const OPEN_DETAILS = /^<details(\s+open)?>$/i;
const CLOSE_DETAILS = /^<\/details>$/i;
const SCAN_DETAILS = Symbol('scanDetails');
const DETAILS_PAIRS = Symbol('detailsPairs');
const BLOCK_TERMINATORS = { alt: ['paragraph', 'reference', 'blockquote', 'list'] };

function lineText(state, line) {
  return state.src.slice(state.bMarks[line] + state.tShift[line], state.eMarks[line]).trim();
}

function collectDetailsPairs(state) {
  const pairs = new Map();
  if (!/<details(?:\s+open)?>[^\S\n]*$/im.test(state.src)) return pairs;

  // Let Markdown tokenize the delimiters in context so code, lists, and quotes
  // can consume their own lines before we decide which disclosures are balanced.
  const tokens = [];
  state.md.block.parse(state.src, state.md, { [SCAN_DETAILS]: true }, tokens);
  const openings = [];
  for (const token of tokens) {
    if (token.type === 'collabmd_details_open') {
      openings.push(token);
    } else if (token.type === 'collabmd_details_close' && openings.at(-1)?.level === token.level) {
      pairs.set(openings.pop().map[0], token.map[0]);
    } else if (token.nesting === -1) {
      while (openings.at(-1)?.level > token.level) openings.pop();
    }
  }
  return pairs;
}

export function enableMarkdownDetails(markdown) {
  markdown.core.ruler.before('block', 'collabmd-details-pairs', (state) => {
    if (!state.inlineMode) state.env[DETAILS_PAIRS] = collectDetailsPairs(state);
  });

  markdown.block.ruler.before('code', 'collabmd-details', (state, start, end, silent) => {
    if (state.sCount[start] - state.blkIndent >= 4) return false;
    const text = lineText(state, start);
    const opening = OPEN_DETAILS.exec(text);
    if (state.env[SCAN_DETAILS]) {
      if (!opening && !CLOSE_DETAILS.test(text)) return false;
      if (!silent) {
        const token = state.push(opening ? 'collabmd_details_open' : 'collabmd_details_close', '', 0);
        token.map = [start, start + 1];
        state.line = start + 1;
      }
      return true;
    }

    if (!opening) return false;
    const close = state.env[DETAILS_PAIRS]?.get(start);
    if (close === undefined || close >= end) return false;
    if (silent) return true;

    const token = state.push('details_open', 'details', 1);
    if (opening[1]) token.attrSet('open', '');
    token.map = [start, close + 1];
    const previousLineMax = state.lineMax;
    const previousDetailsLevel = state.detailsLevel;
    state.lineMax = close;
    state.detailsLevel = state.level;
    state.md.block.tokenize(state, start + 1, close);
    state.lineMax = previousLineMax;
    state.detailsLevel = previousDetailsLevel;
    state.push('details_close', 'details', -1);
    state.line = close + 1;
    return true;
  }, BLOCK_TERMINATORS);

  // Meeting templates can indent the leading summary by four spaces or more.
  // Past that first block, let Markdown recognize its normal indented code.
  markdown.block.ruler.before('code', 'collabmd-summary', (state, start, end, silent) => {
    if (state.level !== state.detailsLevel) return false;
    const leadingSummary = state.tokens.at(-1)?.type === 'details_open';
    if (!leadingSummary && state.sCount[start] - state.blkIndent >= 4) return false;
    const text = lineText(state, start);
    if (!/^<summary>/i.test(text)) return false;
    let label = text.slice('<summary>'.length);
    let next = start + 1;
    while (!/<\/summary>\s*$/i.test(label) && next < end) {
      const continuation = lineText(state, next);
      if ((continuation && state.sCount[next] < state.blkIndent) || CLOSE_DETAILS.test(continuation)) return false;
      label += `\n${continuation}`;
      next += 1;
    }
    if (!/<\/summary>\s*$/i.test(label)) return false;
    if (silent) return true;
    state.line = next;

    const token = state.push('summary_open', 'summary', 1);
    token.map = [start, next];
    const inline = state.push('inline', '', 0);
    inline.content = label.replace(/<\/summary>\s*$/i, '').trim();
    inline.map = [start, next];
    inline.children = [];
    state.push('summary_close', 'summary', -1);
    return true;
  }, BLOCK_TERMINATORS);
}
