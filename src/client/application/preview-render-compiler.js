import markdownIt from 'markdown-it';
import hljs from 'highlight.js';

import { isImageAttachmentFilePath } from '../../domain/file-kind.js';
import { resolveVaultRelativePath } from '../../domain/vault-paths.js';
import { resolveWikiTargetPath } from '../../domain/wiki-link-resolver.js';
import { classifyPublicVideoEmbed } from '../../domain/video-embed.js';
import { escapeHtml } from '../domain/vault-utils.js';
import { extractYamlFrontmatter } from '../../domain/yaml-frontmatter.js';
import { renderFrontmatterBlock } from './markdown-frontmatter.js';
import { analyzeMarkdownComplexity } from './preview-render-profile.js';

hljs.registerAliases(['cql', 'mariadb', 'mssql', 'mysql', 'plsql', 'sqlite'], { languageName: 'sql' });
hljs.registerAliases(['ecmascript', 'node'], { languageName: 'javascript' });


function renderToken(renderer, tokens, index, options, env, self) {
  return renderer?.(tokens, index, options, env, self) ?? self.renderToken(tokens, index, options);
}

function hashString(source = '') {
  let hash = 2166136261;
  for (let index = 0; index < source.length; index += 1) {
    hash ^= source.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(36);
}

function normalizePreviewTypography(content = '') {
  return String(content)
    .replace(/<->/g, '↔')
    .replace(/<=>/g, '⇔')
    .replace(/->/g, '→')
    .replace(/<-/g, '←')
    .replace(/=>/g, '⇒');
}

function escapePreviewText(content = '') {
  return escapeHtml(normalizePreviewTypography(content));
}

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

function createContextualHeadingBaseId(headingInfo, groupedHeadingInfos = []) {
  if (!headingInfo?.slug) {
    return 'section';
  }

  if (groupedHeadingInfos.length <= 1) {
    return headingInfo.slug;
  }

  for (let depth = 1; depth <= headingInfo.parentSlugs.length; depth += 1) {
    const candidate = [
      ...headingInfo.parentSlugs.slice(-depth),
      headingInfo.slug,
    ].join('-');

    const isUniqueWithinGroup = groupedHeadingInfos.every((otherInfo) => {
      if (otherInfo === headingInfo) {
        return true;
      }

      const otherCandidate = [
        ...otherInfo.parentSlugs.slice(-depth),
        otherInfo.slug,
      ].join('-');
      return otherCandidate !== candidate;
    });

    if (isUniqueWithinGroup) {
      return candidate;
    }
  }

  return headingInfo.slug;
}

function assignHeadingIds(state) {
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

  const headingIdCounts = new Map();
  headingInfos.forEach((headingInfo) => {
    const baseId = createContextualHeadingBaseId(headingInfo, headingsBySlug.get(headingInfo.slug) ?? []);
    headingInfo.token.attrSet('id', createHeadingId(baseId, headingIdCounts));
  });
}

function renderSafeInlineBreaks(content = '') {
  const parts = String(content).split(/<br\s*\/?>/i);
  if (parts.length === 1) {
    return escapePreviewText(content);
  }

  return parts
    .map((part) => escapePreviewText(part))
    .join('<br>');
}

function createMermaidPlaceholder({ key, sourceAttributes, sourceHash, sourceText }) {
  return `<div class="mermaid-shell diagram-preview-shell"${sourceAttributes} data-mermaid-key="${escapeHtml(key)}" data-mermaid-source-hash="${escapeHtml(sourceHash)}"><div class="mermaid-placeholder-card diagram-preview-placeholder-card"><div class="mermaid-placeholder-copy diagram-preview-placeholder-copy"><strong>Mermaid diagram</strong><span>Loads when visible</span></div><button type="button" class="mermaid-placeholder-btn diagram-preview-placeholder-btn" data-mermaid-key="${escapeHtml(key)}">Render</button></div><pre class="mermaid-source" hidden>${escapeHtml(sourceText)}</pre></div>`;
}

function createMermaidEmbedShell({ embedKey, label, target }) {
  return `<span class="mermaid-shell diagram-preview-shell" data-mermaid-key="${escapeHtml(embedKey)}" data-mermaid-target="${escapeHtml(target)}" data-mermaid-label="${escapeHtml(label)}"><span class="mermaid-placeholder-card diagram-preview-placeholder-card"><span class="mermaid-placeholder-copy diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Loads when visible</span></span><button type="button" class="mermaid-placeholder-btn diagram-preview-placeholder-btn" data-mermaid-key="${escapeHtml(embedKey)}">Render</button></span><span class="mermaid-source" hidden></span></span>`;
}

function createPlantUmlPlaceholder({ key, sourceAttributes, sourceHash, sourceText }) {
  return `<div class="plantuml-shell diagram-preview-shell"${sourceAttributes} data-plantuml-key="${escapeHtml(key)}" data-plantuml-source-hash="${escapeHtml(sourceHash)}"><div class="plantuml-placeholder-card diagram-preview-placeholder-card"><div class="plantuml-placeholder-copy diagram-preview-placeholder-copy"><strong>PlantUML diagram</strong><span>Renders server-side when visible</span></div><button type="button" class="plantuml-placeholder-btn diagram-preview-placeholder-btn" data-plantuml-key="${escapeHtml(key)}">Render</button></div><pre class="plantuml-source" hidden>${escapeHtml(sourceText)}</pre></div>`;
}

function createPlantUmlEmbedShell({ embedKey, label, target }) {
  return `<span class="plantuml-shell diagram-preview-shell" data-plantuml-key="${escapeHtml(embedKey)}" data-plantuml-target="${escapeHtml(target)}" data-plantuml-label="${escapeHtml(label)}"><span class="plantuml-placeholder-card diagram-preview-placeholder-card"><span class="plantuml-placeholder-copy diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Renders server-side when visible</span></span><button type="button" class="plantuml-placeholder-btn diagram-preview-placeholder-btn" data-plantuml-key="${escapeHtml(embedKey)}">Render</button></span><span class="plantuml-source" hidden></span></span>`;
}

function createExcalidrawPlaceholder({ embedKey, label, target }) {
  return `<span class="excalidraw-embed-placeholder diagram-preview-shell" data-embed-key="${escapeHtml(embedKey)}" data-embed-target="${escapeHtml(target)}" data-embed-label="${escapeHtml(label)}"><span class="excalidraw-embed-placeholder-card diagram-preview-placeholder-card"><span class="excalidraw-embed-placeholder-copy diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Loads when visible</span></span><button type="button" class="excalidraw-embed-placeholder-btn diagram-preview-placeholder-btn" data-embed-key="${escapeHtml(embedKey)}">Load diagram</button></span></span>`;
}

function createDrawioPlaceholder({ embedKey, label, target }) {
  return `<span class="drawio-embed-placeholder diagram-preview-shell" data-drawio-key="${escapeHtml(embedKey)}" data-drawio-target="${escapeHtml(target)}" data-drawio-label="${escapeHtml(label)}" data-drawio-mode="view"><span class="drawio-embed-placeholder-card diagram-preview-placeholder-card"><span class="drawio-embed-placeholder-copy diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Loads when visible</span></span><button type="button" class="drawio-embed-placeholder-btn diagram-preview-placeholder-btn" data-drawio-key="${escapeHtml(embedKey)}">Load diagram</button></span></span>`;
}

function createBasePlaceholder({ key, sourceAttributes, sourceFilePath, sourceText, viewName = '' }) {
  const sourceFileAttribute = sourceFilePath ? ` data-base-source-path="${escapeHtml(sourceFilePath)}"` : '';
  const viewAttribute = viewName ? ` data-base-view="${escapeHtml(viewName)}"` : '';
  return `<div class="bases-embed-placeholder diagram-preview-shell"${sourceAttributes} data-base-key="${escapeHtml(key)}" data-base-source="${escapeHtml(sourceText)}"${sourceFileAttribute}${viewAttribute}><div class="diagram-preview-placeholder-card"><div class="diagram-preview-placeholder-copy"><strong>Base view</strong><span>Loads query results when preview renders</span></div></div></div>`;
}

function createBaseFileEmbedPlaceholder({ embedKey, label, target, viewName = '', sourceFilePath = '' }) {
  const sourceFileAttribute = sourceFilePath ? ` data-base-source-path="${escapeHtml(sourceFilePath)}"` : '';
  const viewAttribute = viewName ? ` data-base-view="${escapeHtml(viewName)}"` : '';
  return `<span class="bases-embed-placeholder diagram-preview-shell" data-base-key="${escapeHtml(embedKey)}" data-base-path="${escapeHtml(target)}" data-base-label="${escapeHtml(label)}"${viewAttribute}${sourceFileAttribute}><span class="diagram-preview-placeholder-card"><span class="diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Loads query results when preview renders</span></span></span></span>`;
}


function createVideoEmbedPlaceholder({
  embedKey,
  kind,
  label,
  mimeType = '',
  originalUrl = '',
  source,
  url,
}) {
  const subtitle = kind === 'youtube' ? 'YouTube video' : 'Video file';
  const mimeTypeAttribute = mimeType ? ` data-video-embed-mime-type="${escapeHtml(mimeType)}"` : '';
  const originalUrlAttribute = originalUrl ? ` data-video-embed-original-url="${escapeHtml(originalUrl)}"` : '';
  return `<span class="video-embed-placeholder video-embed-shell diagram-preview-shell" data-video-embed-key="${escapeHtml(embedKey)}" data-video-embed-kind="${escapeHtml(kind)}" data-video-embed-label="${escapeHtml(label)}" data-video-embed-source="${escapeHtml(source)}" data-video-embed-url="${escapeHtml(url)}"${mimeTypeAttribute}${originalUrlAttribute}><span class="video-embed-placeholder-card diagram-preview-placeholder-card"><span class="video-embed-placeholder-copy diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(subtitle)}</span></span></span></span>`;
}

function renderVideoEmbed(token, videoEmbedCounts) {
  const source = token.attrGet('src') || '';
  const classification = classifyPublicVideoEmbed(source);
  if (!classification) {
    return null;
  }

  const title = normalizePreviewTypography(token.content || token.attrGet('title') || '');
  const preserveSource = classification.type === 'youtube'
    ? classification.embedUrl
    : classification.sourceUrl;
  const occurrenceIndex = videoEmbedCounts.get(preserveSource) ?? 0;
  videoEmbedCounts.set(preserveSource, occurrenceIndex + 1);
  const embedKey = `video-${hashString(preserveSource)}-${occurrenceIndex}`;

  return createVideoEmbedPlaceholder({
    embedKey,
    kind: classification.type,
    label: title || 'Embedded video',
    mimeType: classification.mimeType,
    originalUrl: source,
    source: preserveSource,
    url: classification.type === 'youtube' ? classification.embedUrl : classification.sourceUrl,
  });
}

function isAbsoluteOrExternalUrl(source = '') {
  const normalized = String(source ?? '').trim();
  return (
    !normalized
    || normalized.startsWith('data:')
    || normalized.startsWith('blob:')
    || normalized.startsWith('#')
    || normalized.startsWith('//')
    || /^[a-zA-Z][a-zA-Z\d+.-]*:/u.test(normalized)
    || normalized.startsWith('/')
  );
}

function resolveLocalAttachmentUrl(source = '', {
  attachmentApiPath,
  sourceFilePath,
} = {}) {
  if (!sourceFilePath || isAbsoluteOrExternalUrl(source)) {
    return null;
  }

  const resolvedPath = resolveVaultRelativePath(sourceFilePath, source);
  if (!resolvedPath || !isImageAttachmentFilePath(resolvedPath)) {
    return null;
  }

  return `${attachmentApiPath}?path=${encodeURIComponent(resolvedPath)}`;
}

function removeTokenAttr(token, name) {
  const attributeIndex = token.attrIndex(name);
  if (attributeIndex >= 0) {
    token.attrs.splice(attributeIndex, 1);
  }
}

function renderInlineWikiText(content, {
  baseEmbedCounts,
  drawioEmbedCounts,
  excalidrawEmbedCounts,
  fileList,
  mermaidEmbedCounts,
  plantUmlEmbedCounts,
  sourceFilePath = '',
  wikiLinkAutoCreate = true,
}) {
  const regex = /!\[\[([^\]|#]+\.(?:base|excalidraw|drawio|mmd|mermaid|puml|plantuml))(?:#([^\]|]+))?(?:\|([^\]]+))?\]\]|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;
  let lastIndex = 0;
  let html = '';
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      html += renderSafeInlineBreaks(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const target = match[1].trim();
      const viewName = (match[2] || '').trim();
      const label = (match[3] || target).trim();

      if (/\.base$/i.test(target)) {
        const occurrenceIndex = baseEmbedCounts.get(`${target}#${viewName}`) ?? 0;
        baseEmbedCounts.set(`${target}#${viewName}`, occurrenceIndex + 1);
        html += createBaseFileEmbedPlaceholder({
          embedKey: `${target}#${viewName || 'default'}#${occurrenceIndex}`,
          label: normalizePreviewTypography(label.replace(/\.base$/i, '')),
          sourceFilePath,
          target,
          viewName,
        });
      } else if (/\.excalidraw$/i.test(target)) {
        const occurrenceIndex = excalidrawEmbedCounts.get(target) ?? 0;
        excalidrawEmbedCounts.set(target, occurrenceIndex + 1);
        html += createExcalidrawPlaceholder({
          embedKey: `${target}#${occurrenceIndex}`,
          label: normalizePreviewTypography(label.replace(/\.excalidraw$/i, '')),
          target,
        });
      } else if (/\.drawio$/i.test(target)) {
        const occurrenceIndex = drawioEmbedCounts.get(target) ?? 0;
        drawioEmbedCounts.set(target, occurrenceIndex + 1);
        html += createDrawioPlaceholder({
          embedKey: `${target}#${occurrenceIndex}`,
          label: normalizePreviewTypography(label.replace(/\.drawio$/i, '')),
          target,
        });
      } else if (/\.(?:mmd|mermaid)$/i.test(target)) {
        const occurrenceIndex = mermaidEmbedCounts.get(target) ?? 0;
        mermaidEmbedCounts.set(target, occurrenceIndex + 1);
        html += createMermaidEmbedShell({
          embedKey: `${target}#${occurrenceIndex}`,
          label: normalizePreviewTypography(label.replace(/\.(?:mmd|mermaid)$/i, '')),
          target,
        });
      } else {
        const occurrenceIndex = plantUmlEmbedCounts.get(target) ?? 0;
        plantUmlEmbedCounts.set(target, occurrenceIndex + 1);
        html += createPlantUmlEmbedShell({
          embedKey: `${target}#${occurrenceIndex}`,
          label: normalizePreviewTypography(label.replace(/\.(?:puml|plantuml)$/i, '')),
          target,
        });
      }
    } else {
      const target = match[4].trim();
      const display = (match[5] || match[4]).trim();
      const resolved = resolveWikiTargetPath(target, fileList);
      const classes = resolved ? 'wiki-link' : 'wiki-link wiki-link-new';
      const title = resolved
        ? normalizePreviewTypography(display)
        : wikiLinkAutoCreate
          ? `Create "${target}"`
          : `Missing "${target}"`;
      html += `<a class="${classes}" href="#" data-wiki-target="${escapeHtml(target)}" title="${escapeHtml(title)}">${escapePreviewText(display)}</a>`;
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    html += renderSafeInlineBreaks(content.slice(lastIndex));
  }

  return html;
}

function createMarkdownRenderer(fileList = [], {
  attachmentApiPath = '/api/attachment',
  sourceFilePath = '',
  wikiLinkAutoCreate = true,
} = {}) {
  const markdown = markdownIt({
    highlight(source, language) {
      if (language === 'mermaid' || language === 'plantuml' || language === 'puml') {
        return '';
      }

      try {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(source, { language }).value;
        }

        return hljs.highlightAuto(source).value;
      } catch {
        return '';
      }
    },
    html: false,
    linkify: true,
    typographer: true,
  });

  markdown.core.ruler.push('collabmd-source-lines', (state) => {
    state.tokens.forEach((token) => {
      if (!token.map) {
        return;
      }

      const [start, end] = token.map;
      const sourceStart = start + 1;
      const sourceEnd = Math.max(end, start + 1);

      if (token.nesting === 1 || token.type === 'fence' || token.type === 'code_block' || token.type === 'html_block') {
        token.attrSet('data-source-line', String(sourceStart));
        token.attrSet('data-source-line-end', String(sourceEnd));
      }
    });
  });

  markdown.core.ruler.push('collabmd-heading-anchors', (state) => {
    assignHeadingIds(state);
  });

  const drawioEmbedCounts = new Map();
  const excalidrawEmbedCounts = new Map();
  const baseCounts = new Map();
  const mermaidCounts = new Map();
  const mermaidEmbedCounts = new Map();
  const plantUmlCounts = new Map();
  const plantUmlEmbedCounts = new Map();
  const videoEmbedCounts = new Map();

  const fallbackFence = markdown.renderer.rules.fence;
  const fallbackImage = markdown.renderer.rules.image;
  const fallbackLinkOpen = markdown.renderer.rules.link_open;
  const fallbackTableOpen = markdown.renderer.rules.table_open;
  const fallbackTableClose = markdown.renderer.rules.table_close;

  markdown.renderer.rules.fence = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const info = token.info ? token.info.trim().toLowerCase() : '';
    const sourceLine = token.attrGet('data-source-line');
    const sourceLineEnd = token.attrGet('data-source-line-end');
    const sourceAttributes = sourceLine
      ? ` data-source-line="${sourceLine}" data-source-line-end="${sourceLineEnd}"`
      : '';

    if (info === 'mermaid') {
      const sourceHash = hashString(token.content);
      const occurrenceIndex = mermaidCounts.get(sourceHash) ?? 0;
      mermaidCounts.set(sourceHash, occurrenceIndex + 1);
      return createMermaidPlaceholder({
        key: `mermaid-${sourceHash}-${occurrenceIndex}`,
        sourceAttributes,
        sourceHash,
        sourceText: token.content,
      });
    }

    if (info === 'plantuml' || info === 'puml') {
      const sourceHash = hashString(token.content);
      const occurrenceIndex = plantUmlCounts.get(sourceHash) ?? 0;
      plantUmlCounts.set(sourceHash, occurrenceIndex + 1);
      return createPlantUmlPlaceholder({
        key: `plantuml-${sourceHash}-${occurrenceIndex}`,
        sourceAttributes,
        sourceHash,
        sourceText: token.content,
      });
    }

    if (info === 'base') {
      const sourceHash = hashString(token.content);
      const occurrenceIndex = baseCounts.get(sourceHash) ?? 0;
      baseCounts.set(sourceHash, occurrenceIndex + 1);
      return createBasePlaceholder({
        key: `base-${sourceHash}-${occurrenceIndex}`,
        sourceAttributes,
        sourceFilePath,
        sourceText: token.content,
      });
    }

    const rendered = renderToken(fallbackFence, tokens, index, options, env, self);
    if (!sourceLine) {
      return rendered;
    }

    return rendered.replace(
      /^<pre/,
      `<pre data-source-line="${sourceLine}" data-source-line-end="${sourceLineEnd}"`,
    );
  };

  markdown.renderer.rules.list_item_open = (tokens, index, options, env, self) => {
    const inlineToken = tokens[index + 2];
    const content = inlineToken?.content ?? '';

    if (content.startsWith('[ ] ') || content.startsWith('[x] ') || content.startsWith('[X] ')) {
      tokens[index].attrJoin('class', 'task-list-item');
    }

    return self.renderToken(tokens, index, options);
  };

  markdown.renderer.rules.text = (tokens, index) => {
    const content = tokens[index].content;

    if (content.startsWith('[x] ') || content.startsWith('[X] ')) {
      return `<input type="checkbox" checked data-task-checkbox="true"> ${renderInlineWikiText(content.slice(4), {
        baseEmbedCounts: baseCounts,
        drawioEmbedCounts,
        excalidrawEmbedCounts,
        fileList,
        mermaidEmbedCounts,
        plantUmlEmbedCounts,
        sourceFilePath,
        wikiLinkAutoCreate,
      })}`;
    }

    if (content.startsWith('[ ] ')) {
      return `<input type="checkbox" data-task-checkbox="true"> ${renderInlineWikiText(content.slice(4), {
        baseEmbedCounts: baseCounts,
        drawioEmbedCounts,
        excalidrawEmbedCounts,
        fileList,
        mermaidEmbedCounts,
        plantUmlEmbedCounts,
        sourceFilePath,
        wikiLinkAutoCreate,
      })}`;
    }

    return renderInlineWikiText(content, {
      baseEmbedCounts: baseCounts,
      drawioEmbedCounts,
      excalidrawEmbedCounts,
      fileList,
      mermaidEmbedCounts,
      plantUmlEmbedCounts,
      sourceFilePath,
      wikiLinkAutoCreate,
    });
  };

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    const href = tokens[index].attrGet('href') || '';
    if (href.startsWith('#')) {
      removeTokenAttr(tokens[index], 'target');
      removeTokenAttr(tokens[index], 'rel');
      return renderToken(fallbackLinkOpen, tokens, index, options, env, self);
    }

    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderToken(fallbackLinkOpen, tokens, index, options, env, self);
  };

  markdown.renderer.rules.image = (tokens, index, options, env, self) => {
    const token = tokens[index];
    const localAttachmentUrl = resolveLocalAttachmentUrl(token.attrGet('src') || '', {
      attachmentApiPath,
      sourceFilePath,
    });
    if (localAttachmentUrl) {
      token.attrSet('src', localAttachmentUrl);
    }

    const renderedVideo = renderVideoEmbed(token, videoEmbedCounts);
    if (renderedVideo) {
      return renderedVideo;
    }

    return renderToken(fallbackImage, tokens, index, options, env, self);
  };

  markdown.renderer.rules.table_open = (tokens, index, options, env, self) => (
    `<div class="table-wrapper">${renderToken(fallbackTableOpen, tokens, index, options, env, self)}`
  );

  markdown.renderer.rules.table_close = (tokens, index, options, env, self) => (
    `${renderToken(fallbackTableClose, tokens, index, options, env, self)}</div>`
  );

  return markdown;
}

export function compilePreviewDocument({
  attachmentApiPath = '/api/attachment',
  fileList = [],
  frontmatterCollapsed = false,
  frontmatterInteractive = false,
  markdownText = '',
  sourceFilePath = '',
  wikiLinkAutoCreate = true,
} = {}) {
  const normalizedMarkdown = String(markdownText);
  const frontmatter = extractYamlFrontmatter(normalizedMarkdown);
  const renderer = createMarkdownRenderer(fileList, {
    attachmentApiPath,
    sourceFilePath,
    wikiLinkAutoCreate,
  });
  const renderedMarkdown = frontmatter ? frontmatter.bodyMarkdown : normalizedMarkdown;
  const frontmatterHtml = renderFrontmatterBlock(frontmatter, {
    collapsed: frontmatterCollapsed,
    interactive: frontmatterInteractive,
  });

  return {
    html: `${frontmatterHtml}${renderer.render(renderedMarkdown)}`,
    stats: analyzeMarkdownComplexity(normalizedMarkdown),
  };
}
