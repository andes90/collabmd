import markdownIt from 'markdown-it';
import { extractYamlFrontmatter } from '../../domain/yaml-frontmatter.js';

function createHeadingSlug(content = '') {
  return String(content ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'section';
}

function createHeadingId(baseId = '', headingIdCounts = new Map()) {
  const normalizedBaseId = String(baseId ?? '').trim() || 'section';
  const occurrenceIndex = headingIdCounts.get(normalizedBaseId) ?? 0;
  headingIdCounts.set(normalizedBaseId, occurrenceIndex + 1);
  return occurrenceIndex === 0 ? normalizedBaseId : `${normalizedBaseId}-${occurrenceIndex}`;
}

export function assignHeadingIds(state) {
  const headingInfos = [];
  const parentSlugs = [];

  state.tokens.forEach((token, index) => {
    if (token.type !== 'heading_open' || token.attrGet('id')) {
      return;
    }

    const level = Number.parseInt(token.tag.slice(1), 10);
    if (!Number.isFinite(level) || level < 1) {
      return;
    }

    parentSlugs.length = Math.max(level - 1, 0);
    const inlineToken = state.tokens[index + 1];
    const slug = createHeadingSlug(inlineToken?.type === 'inline' ? inlineToken.content : '');
    headingInfos.push({
      parentSlugs: parentSlugs.filter(Boolean),
      slug,
      token,
    });
    parentSlugs[level - 1] = slug;
  });

  const headingsBySlug = new Map();
  headingInfos.forEach((headingInfo) => {
    const group = headingsBySlug.get(headingInfo.slug) ?? [];
    group.push(headingInfo);
    headingsBySlug.set(headingInfo.slug, group);
  });

  for (const group of headingsBySlug.values()) {
    if (group.length <= 1) {
      continue;
    }

    const maxDepth = group.reduce((depth, heading) => Math.max(depth, heading.parentSlugs.length), 0);
    for (let depth = 1; depth <= maxDepth; depth += 1) {
      const candidateCounts = new Map();
      const candidates = group.map((heading) => [...heading.parentSlugs.slice(-depth), heading.slug].join('-'));
      for (const candidate of candidates) {
        candidateCounts.set(candidate, (candidateCounts.get(candidate) ?? 0) + 1);
      }
      group.forEach((heading, index) => {
        if (!heading.baseId && depth <= heading.parentSlugs.length && candidateCounts.get(candidates[index]) === 1) {
          heading.baseId = candidates[index];
        }
      });
    }
  }

  const headingIdCounts = new Map();
  headingInfos.forEach((headingInfo) => {
    headingInfo.token.attrSet('id', createHeadingId(headingInfo.baseId ?? headingInfo.slug, headingIdCounts));
  });
}

const markdown = markdownIt({ html: false, linkify: true, typographer: true });

export function getMarkdownHeadings(content = '') {
  const source = String(content ?? '');
  const tokens = markdown.parse(extractYamlFrontmatter(source)?.bodyMarkdown ?? source, {});
  assignHeadingIds({ tokens });
  return tokens.flatMap((token, index) => token.type === 'heading_open' ? [{
    id: token.attrGet('id'),
    text: tokens[index + 1]?.content ?? '',
  }] : []);
}

export function findMarkdownSection(tokens, anchor) {
  assignHeadingIds({ tokens });
  const index = tokens.findIndex((token) => token.type === 'heading_open' && token.attrGet('id') === anchor);
  if (index < 0) return null;
  const heading = tokens[index];
  const level = Number(heading.tag.slice(1));
  const next = tokens.slice(index + 1).find((token) => token.type === 'heading_open' && Number(token.tag.slice(1)) <= level);
  return { startLine: heading.map[0], endLine: next?.map[0] };
}
