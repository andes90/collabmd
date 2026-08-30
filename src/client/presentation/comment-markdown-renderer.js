import markdownIt from 'markdown-it';
import hljs from 'highlight.js/lib/common';

import { escapeHtml } from '../domain/vault-utils.js';

const AUTO_HIGHLIGHT_LANGUAGES = ['bash', 'css', 'javascript', 'json', 'markdown', 'python', 'sql', 'typescript', 'xml', 'yaml'];

function renderToken(renderer, tokens, index, options, env, self) {
  return renderer?.(tokens, index, options, env, self) ?? self.renderToken(tokens, index, options);
}

function renderPlainTextCommentHtml(text = '') {
  const escaped = escapeHtml(String(text ?? ''));
  return `<p>${escaped.replace(/\n/g, '<br>')}</p>`;
}

function createCommentMarkdownRenderer() {
  const markdown = markdownIt({
    breaks: true,
    highlight(source, language) {
      try {
        if (language && hljs.getLanguage(language)) {
          return hljs.highlight(source, {
            ignoreIllegals: true,
            language,
          }).value;
        }

        return hljs.highlightAuto(source, AUTO_HIGHLIGHT_LANGUAGES).value;
      } catch {
        return escapeHtml(source);
      }
    },
    html: false,
    linkify: true,
    typographer: true,
  });

  const fallbackLinkOpen = markdown.renderer.rules.link_open;
  const fallbackTableOpen = markdown.renderer.rules.table_open;
  const fallbackTableClose = markdown.renderer.rules.table_close;

  markdown.renderer.rules.link_open = (tokens, index, options, env, self) => {
    tokens[index].attrSet('target', '_blank');
    tokens[index].attrSet('rel', 'noopener noreferrer');
    return renderToken(fallbackLinkOpen, tokens, index, options, env, self);
  };

  markdown.renderer.rules.table_open = (tokens, index, options, env, self) => (
    `<div class="comment-markdown-table">${renderToken(fallbackTableOpen, tokens, index, options, env, self)}`
  );

  markdown.renderer.rules.table_close = (tokens, index, options, env, self) => (
    `${renderToken(fallbackTableClose, tokens, index, options, env, self)}</div>`
  );

  return markdown;
}

const commentMarkdownRenderer = createCommentMarkdownRenderer();

export function renderCommentMarkdownToHtml(markdownText = '') {
  const normalizedMarkdown = String(markdownText ?? '');

  try {
    return commentMarkdownRenderer.render(normalizedMarkdown);
  } catch {
    return renderPlainTextCommentHtml(normalizedMarkdown);
  }
}
