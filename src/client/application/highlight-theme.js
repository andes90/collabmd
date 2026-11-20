import darkHighlightThemeUrl from '../assets/vendor/highlight/github-dark.min.css?url';
import lightHighlightThemeUrl from '../assets/vendor/highlight/github.min.css?url';

export function ensureHighlightThemeStylesheet({ theme = 'dark' } = {}) {
  let themeStylesheet = document.getElementById('hljs-theme');
  if (!(themeStylesheet instanceof HTMLLinkElement)) {
    themeStylesheet = document.createElement('link');
    themeStylesheet.id = 'hljs-theme';
    themeStylesheet.rel = 'stylesheet';
    document.head.append(themeStylesheet);
  }

  themeStylesheet.href = theme === 'light' ? lightHighlightThemeUrl : darkHighlightThemeUrl;
  themeStylesheet.dataset.darkHref = darkHighlightThemeUrl;
  themeStylesheet.dataset.lightHref = lightHighlightThemeUrl;
}
