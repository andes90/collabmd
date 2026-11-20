import { ensureHighlightThemeStylesheet } from '../application/highlight-theme.js';
import '../styles/base.css';
import '../styles/foundation/tokens.css';
import '../styles/foundation/themes.css';
import '../styles/features/preview-markdown.css';
import '../styles/overrides/highlightjs.css';
import '../styles/export-document.css';
import 'katex/dist/katex.min.css';

ensureHighlightThemeStylesheet({ theme: 'light' });
await import('../export/export-page.js');
