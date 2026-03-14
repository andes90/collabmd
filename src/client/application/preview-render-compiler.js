import markdownIt from 'markdown-it';
import hljs from 'highlight.js';

import { escapeHtml, resolveWikiTarget } from '../domain/vault-utils.js';
import { analyzeMarkdownComplexity } from './preview-render-profile.js';

const DIRECT_VIDEO_MIME_TYPES = Object.freeze({
  '.mp4': 'video/mp4',
  '.ogg': 'video/ogg',
  '.webm': 'video/webm',
});

const YOUTUBE_HOSTS = new Set([
  'youtube.com',
  'www.youtube.com',
  'm.youtube.com',
  'youtu.be',
  'www.youtu.be',
  'youtube-nocookie.com',
  'www.youtube-nocookie.com',
]);

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

function getDirectVideoMimeType(pathname = '') {
  const match = pathname.toLowerCase().match(/\.(mp4|ogg|webm)$/i);
  if (!match) {
    return null;
  }

  return DIRECT_VIDEO_MIME_TYPES[`.${match[1].toLowerCase()}`] || null;
}

function normalizeYouTubeVideoId(candidate = '') {
  const normalized = String(candidate || '').trim();
  return /^[A-Za-z0-9_-]{11}$/.test(normalized) ? normalized : null;
}

function getCanonicalYouTubeEmbedUrl(url) {
  const host = url.hostname.toLowerCase();
  let videoId = null;

  if (host === 'youtu.be' || host === 'www.youtu.be') {
    videoId = normalizeYouTubeVideoId(url.pathname.split('/').filter(Boolean)[0] || '');
  } else if (host.includes('youtube') || host.includes('youtube-nocookie')) {
    if (url.pathname === '/watch') {
      videoId = normalizeYouTubeVideoId(url.searchParams.get('v') || '');
    } else if (url.pathname.startsWith('/embed/')) {
      videoId = normalizeYouTubeVideoId(url.pathname.split('/').filter(Boolean)[1] || '');
    }
  }

  if (!videoId) {
    return null;
  }

  return `https://www.youtube-nocookie.com/embed/${videoId}`;
}

function classifyPublicVideoEmbed(source = '') {
  let url;

  try {
    url = new URL(String(source || '').trim());
  } catch {
    return null;
  }

  if (url.protocol !== 'https:') {
    return null;
  }

  const host = url.hostname.toLowerCase();
  if (YOUTUBE_HOSTS.has(host)) {
    const embedUrl = getCanonicalYouTubeEmbedUrl(url);
    if (!embedUrl) {
      return null;
    }

    return {
      embedUrl,
      type: 'youtube',
    };
  }

  const mimeType = getDirectVideoMimeType(url.pathname);
  if (!mimeType) {
    return null;
  }

  return {
    mimeType,
    sourceUrl: url.toString(),
    type: 'direct-video',
  };
}

function createVideoEmbedPlaceholder({
  embedKey,
  kind,
  label,
  mimeType = '',
  source,
  url,
}) {
  const subtitle = kind === 'youtube' ? 'YouTube video' : 'Video file';
  const mimeTypeAttribute = mimeType ? ` data-video-embed-mime-type="${escapeHtml(mimeType)}"` : '';
  return `<span class="video-embed-placeholder video-embed-shell diagram-preview-shell" data-video-embed-key="${escapeHtml(embedKey)}" data-video-embed-kind="${escapeHtml(kind)}" data-video-embed-label="${escapeHtml(label)}" data-video-embed-source="${escapeHtml(source)}" data-video-embed-url="${escapeHtml(url)}"${mimeTypeAttribute}><span class="video-embed-placeholder-card diagram-preview-placeholder-card"><span class="video-embed-placeholder-copy diagram-preview-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>${escapeHtml(subtitle)}</span></span></span></span>`;
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
    source: preserveSource,
    url: classification.type === 'youtube' ? classification.embedUrl : classification.sourceUrl,
  });
}

function renderInlineWikiText(content, {
  excalidrawEmbedCounts,
  fileList,
  mermaidEmbedCounts,
  plantUmlEmbedCounts,
}) {
  const regex = /!\[\[([^\]|]+\.(?:excalidraw|mmd|mermaid|puml|plantuml))(?:\|([^\]]+))?\]\]|\[\[([^\]|]+)(?:\|([^\]]+))?\]\]/gi;
  let lastIndex = 0;
  let html = '';
  let match;

  while ((match = regex.exec(content)) !== null) {
    if (match.index > lastIndex) {
      html += renderSafeInlineBreaks(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const target = match[1].trim();
      const label = (match[2] || target).trim();

      if (/\.excalidraw$/i.test(target)) {
        const occurrenceIndex = excalidrawEmbedCounts.get(target) ?? 0;
        excalidrawEmbedCounts.set(target, occurrenceIndex + 1);
        html += createExcalidrawPlaceholder({
          embedKey: `${target}#${occurrenceIndex}`,
          label: normalizePreviewTypography(label.replace(/\.excalidraw$/i, '')),
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
      const target = match[3].trim();
      const display = (match[4] || match[3]).trim();
      const resolved = resolveWikiTarget(target, fileList);
      const classes = resolved ? 'wiki-link' : 'wiki-link wiki-link-new';
      const title = resolved ? normalizePreviewTypography(display) : `Create "${target}"`;
      html += `<a class="${classes}" href="#" data-wiki-target="${escapeHtml(target)}" title="${escapeHtml(title)}">${escapePreviewText(display)}</a>`;
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    html += renderSafeInlineBreaks(content.slice(lastIndex));
  }

  return html;
}

function createMarkdownRenderer(fileList = []) {
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

  const excalidrawEmbedCounts = new Map();
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
      return `<input type="checkbox" checked disabled> ${renderInlineWikiText(content.slice(4), {
        excalidrawEmbedCounts,
        fileList,
        mermaidEmbedCounts,
        plantUmlEmbedCounts,
      })}`;
    }

    if (content.startsWith('[ ] ')) {
      return `<input type="checkbox" disabled> ${renderInlineWikiText(content.slice(4), {
        excalidrawEmbedCounts,
        fileList,
        mermaidEmbedCounts,
        plantUmlEmbedCounts,
      })}`;
    }

    return renderInlineWikiText(content, {
      excalidrawEmbedCounts,
      fileList,
      mermaidEmbedCounts,
      plantUmlEmbedCounts,
    });
  };

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderToken(fallbackLinkOpen, tokens, index, options, env, self);
  };

  markdown.renderer.rules.image = (tokens, index, options, env, self) => {
    const renderedVideo = renderVideoEmbed(tokens[index], videoEmbedCounts);
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

export function compilePreviewDocument({ fileList = [], markdownText = '' } = {}) {
  const normalizedMarkdown = String(markdownText);
  const renderer = createMarkdownRenderer(fileList);

  return {
    html: renderer.render(normalizedMarkdown),
    stats: analyzeMarkdownComplexity(normalizedMarkdown),
  };
}
