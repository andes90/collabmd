import lightHighlightThemeUrl from '../assets/vendor/highlight/github.min.css?url';
import '../styles/base.css';
import '../styles/foundation/tokens.css';
import '../styles/foundation/themes.css';
import '../styles/features/preview-markdown.css';
import '../styles/overrides/highlightjs.css';
import '../styles/export-document.css';
import 'katex/dist/katex.min.css';

function ensureHighlightThemeStylesheet() {
  let themeStylesheet = document.getElementById('hljs-theme');
  if (!(themeStylesheet instanceof HTMLLinkElement)) {
    themeStylesheet = document.createElement('link');
    themeStylesheet.id = 'hljs-theme';
    themeStylesheet.rel = 'stylesheet';
    document.head.appendChild(themeStylesheet);
  }

  themeStylesheet.href = lightHighlightThemeUrl;
}

ensureHighlightThemeStylesheet();
await import('../export/export-page.js');
