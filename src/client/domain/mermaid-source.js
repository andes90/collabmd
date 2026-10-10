function padBlankSequenceLabelLines(label) {
  return label
    .replace(/^([\t ]*)(?=<br\s*\/?\s*>)/i, '$1#160;')
    .replace(/(<br\s*\/?\s*>)(?=[\t ]*(?:<br\s*\/?\s*>|$))/gi, '$1#160;');
}

export function prepareMermaidRenderSource(source) {
  const text = String(source ?? '');
  const frontmatter = /^\s*---[\t ]*\r?\n[\s\S]*?\r?\n[\t ]*---[\t ]*(?:\r?\n|$)/.exec(text);
  let start = frontmatter?.[0].length ?? 0;
  let comment;
  while ((comment = /^\s*(?:%%\{[\s\S]*?\}%%|%%[^\n]*)/.exec(text.slice(start)))) {
    start += comment[0].length;
  }
  const sequenceStart = /^\s*sequenceDiagram\b/.exec(text.slice(start));
  if (!sequenceStart) {
    return text;
  }
  start += sequenceStart[0].length;

  // Mermaid measures empty sequence-label lines with a zero-width space.
  // WebKit gives that glyph a 0 × 0 SVG box, which Mermaid treats as an error.
  // Use a nonbreaking space only in the render copy to preserve blank lines.
  const body = text.slice(start).replace(
    /((?:^|;)[\t ]*(?:participant|actor)[\t ]+[^\n;]*?@\{)([^}]*)(\})/gm,
    (_match, prefix, config, suffix) => prefix + config.replace(
      /(\balias["']?[\t ]*:[\t ]*)("(?:\\.|[^"\\])*"|'(?:''|[^'])*'|[^,\r\n]*)/g,
      (_alias, key, value) => {
        const quote = /^["']/.test(value) ? value[0] : '';
        const label = quote ? value.slice(1, -1) : value;
        return `${key}${quote}${padBlankSequenceLabelLines(label)}${quote}`;
      },
    ) + suffix,
  ).split('\n').map((line) => {
    if (line.trimStart().startsWith('%%')) {
      return line;
    }
    return line
      .replace(/((?:^|;)[^:;]*:[\t ]*)(?=<br\s*\/?\s*>)/gi, '$1#160;')
      .replace(/((?:^|;)[\t ]*(?:participant|actor)[\t ]+\S+[\t ]+as[\t ]*)(?=<br\s*\/?\s*>)/gi, '$1#160;')
      .replace(/(<br\s*\/?\s*>)(?=[\t ]*(?:<br\s*\/?\s*>|;|\r?$))/gi, '$1#160;');
  }).join('\n');
  return text.slice(0, start) + body;
}
