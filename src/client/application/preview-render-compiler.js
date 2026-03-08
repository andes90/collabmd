import markdownIt from 'markdown-it';
import hljs from 'highlight.js';

import { escapeHtml, resolveWikiTarget } from '../domain/vault-utils.js';
import { analyzeMarkdownComplexity } from './preview-render-profile.js';

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

function createMermaidPlaceholder({ key, sourceAttributes, sourceHash, sourceText }) {
  return `<div class="mermaid-shell"${sourceAttributes} data-mermaid-key="${escapeHtml(key)}" data-mermaid-source-hash="${escapeHtml(sourceHash)}"><div class="mermaid-placeholder-card"><div class="mermaid-placeholder-copy"><strong>Mermaid diagram</strong><span>Loads when visible</span></div><button type="button" class="mermaid-placeholder-btn" data-mermaid-key="${escapeHtml(key)}">Render</button></div><pre class="mermaid-source" hidden>${escapeHtml(sourceText)}</pre></div>`;
}

function createMermaidEmbedShell({ embedKey, label, target }) {
  return `<span class="mermaid-shell" data-mermaid-key="${escapeHtml(embedKey)}" data-mermaid-target="${escapeHtml(target)}" data-mermaid-label="${escapeHtml(label)}"><span class="mermaid-placeholder-card"><span class="mermaid-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Loads when visible</span></span><button type="button" class="mermaid-placeholder-btn" data-mermaid-key="${escapeHtml(embedKey)}">Render</button></span><span class="mermaid-source" hidden></span></span>`;
}

function createPlantUmlPlaceholder({ key, sourceAttributes, sourceHash, sourceText }) {
  return `<div class="plantuml-shell"${sourceAttributes} data-plantuml-key="${escapeHtml(key)}" data-plantuml-source-hash="${escapeHtml(sourceHash)}"><div class="plantuml-placeholder-card"><div class="plantuml-placeholder-copy"><strong>PlantUML diagram</strong><span>Renders server-side when visible</span></div><button type="button" class="plantuml-placeholder-btn" data-plantuml-key="${escapeHtml(key)}">Render</button></div><pre class="plantuml-source" hidden>${escapeHtml(sourceText)}</pre></div>`;
}

function createPlantUmlEmbedShell({ embedKey, label, target }) {
  return `<span class="plantuml-shell" data-plantuml-key="${escapeHtml(embedKey)}" data-plantuml-target="${escapeHtml(target)}" data-plantuml-label="${escapeHtml(label)}"><span class="plantuml-placeholder-card"><span class="plantuml-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Renders server-side when visible</span></span><button type="button" class="plantuml-placeholder-btn" data-plantuml-key="${escapeHtml(embedKey)}">Render</button></span><span class="plantuml-source" hidden></span></span>`;
}

function createExcalidrawPlaceholder({ embedKey, label, target }) {
  return `<span class="excalidraw-embed-placeholder" data-embed-key="${escapeHtml(embedKey)}" data-embed-target="${escapeHtml(target)}" data-embed-label="${escapeHtml(label)}"><span class="excalidraw-embed-placeholder-card"><span class="excalidraw-embed-placeholder-copy"><strong>${escapeHtml(label)}</strong><span>Loads when visible</span></span><button type="button" class="excalidraw-embed-placeholder-btn" data-embed-key="${escapeHtml(embedKey)}">Load diagram</button></span></span>`;
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
      html += escapeHtml(content.slice(lastIndex, match.index));
    }

    if (match[1]) {
      const target = match[1].trim();
      const label = (match[2] || target).trim();

      if (/\.excalidraw$/i.test(target)) {
        const occurrenceIndex = excalidrawEmbedCounts.get(target) ?? 0;
        excalidrawEmbedCounts.set(target, occurrenceIndex + 1);
        html += createExcalidrawPlaceholder({
          embedKey: `${target}#${occurrenceIndex}`,
          label: label.replace(/\.excalidraw$/i, ''),
          target,
        });
      } else if (/\.(?:mmd|mermaid)$/i.test(target)) {
        const occurrenceIndex = mermaidEmbedCounts.get(target) ?? 0;
        mermaidEmbedCounts.set(target, occurrenceIndex + 1);
        html += createMermaidEmbedShell({
          embedKey: `${target}#${occurrenceIndex}`,
          label: label.replace(/\.(?:mmd|mermaid)$/i, ''),
          target,
        });
      } else {
        const occurrenceIndex = plantUmlEmbedCounts.get(target) ?? 0;
        plantUmlEmbedCounts.set(target, occurrenceIndex + 1);
        html += createPlantUmlEmbedShell({
          embedKey: `${target}#${occurrenceIndex}`,
          label: label.replace(/\.(?:puml|plantuml)$/i, ''),
          target,
        });
      }
    } else {
      const target = match[3].trim();
      const display = (match[4] || match[3]).trim();
      const resolved = resolveWikiTarget(target, fileList);
      const classes = resolved ? 'wiki-link' : 'wiki-link wiki-link-new';
      const title = resolved ? display : `Create "${target}"`;
      html += `<a class="${classes}" href="#" data-wiki-target="${escapeHtml(target)}" title="${escapeHtml(title)}">${escapeHtml(display)}</a>`;
    }

    lastIndex = regex.lastIndex;
  }

  if (lastIndex < content.length) {
    html += escapeHtml(content.slice(lastIndex));
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

  const fallbackFence = markdown.renderer.rules.fence;
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
