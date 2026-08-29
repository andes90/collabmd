import darkHighlightThemeUrl from '../assets/vendor/highlight/github-dark.min.css?url';
import lightHighlightThemeUrl from '../assets/vendor/highlight/github.min.css?url';
import { CollabMdAppShell } from '../bootstrap/collabmd-app-shell.js';
import { ensureClientAuthenticated } from '../infrastructure/auth-client.js';
import '../styles/base.css';
import '../styles/style.css';

function ensureHighlightThemeStylesheet() {
  let themeStylesheet = document.getElementById('hljs-theme');
  if (!(themeStylesheet instanceof HTMLLinkElement)) {
    themeStylesheet = document.createElement('link');
    themeStylesheet.id = 'hljs-theme';
    themeStylesheet.rel = 'stylesheet';
    document.head.append(themeStylesheet);
  }

  themeStylesheet.href = darkHighlightThemeUrl;
  themeStylesheet.dataset.darkHref = darkHighlightThemeUrl;
  themeStylesheet.dataset.lightHref = lightHighlightThemeUrl;
}

ensureHighlightThemeStylesheet();
async function start() {
  await ensureClientAuthenticated();
  const app = new CollabMdAppShell();
  app.initialize();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', () => {
    void start();
  }, { once: true });
} else {
  void start();
}
