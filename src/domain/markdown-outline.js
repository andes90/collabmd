import { extractYamlFrontmatter } from './yaml-frontmatter.js';

// ponytail: top-level ATX and single-line Setext headings only; use a shared full parser if nested outlines are needed.
export function collectMarkdownOutline(content) {
  const lines = (extractYamlFrontmatter(content)?.bodyMarkdown ?? content).split(/\r?\n/u);
  const headings = [];
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const marker = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (fence) {
      if (marker && marker[1][0] === fence[0] && marker[1].length >= fence.length && !marker[2].trim()) {
        fence = null;
      }
      continue;
    }
    if (marker && (marker[1][0] !== '`' || !marker[2].includes('`'))) {
      fence = marker[1];
      continue;
    }
    const atx = line.match(/^ {0,3}(#{1,6})(?:[\t ]+(.*)|$)/u);
    const setext = !atx && /^ {0,3}\S/u.test(line) && !/^ {0,3}(?:>|[-+*]\s|\d+[.)]\s)/u.test(line)
      && lines[index + 1]?.match(/^ {0,3}(=+|-+)[\t ]*$/u);
    if (!atx && !setext) continue;
    const text = atx ? (atx[2] ?? '').replace(/(?:^|[\t ]+)#+[\t ]*$/u, '').trim() : line.trim();
    headings.push({
      level: atx ? atx[1].length : setext[1][0] === '=' ? 1 : 2,
      line: index + 1,
      text: text.slice(0, 200),
      truncated: text.length > 200,
    });
    if (setext) index += 1;
  }
  return headings;
}
