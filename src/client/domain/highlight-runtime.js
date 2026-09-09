import hljs from 'highlight.js/lib/core';
import bash from 'highlight.js/lib/languages/bash';
import css from 'highlight.js/lib/languages/css';
import javascript from 'highlight.js/lib/languages/javascript';
import json from 'highlight.js/lib/languages/json';
import markdown from 'highlight.js/lib/languages/markdown';
import python from 'highlight.js/lib/languages/python';
import sql from 'highlight.js/lib/languages/sql';
import typescript from 'highlight.js/lib/languages/typescript';
import xml from 'highlight.js/lib/languages/xml';
import yaml from 'highlight.js/lib/languages/yaml';

export const AUTO_HIGHLIGHT_LANGUAGES = [
  'bash',
  'css',
  'javascript',
  'json',
  'markdown',
  'python',
  'sql',
  'typescript',
  'xml',
  'yaml',
];

hljs.registerLanguage('bash', bash);
hljs.registerLanguage('css', css);
hljs.registerLanguage('javascript', javascript);
hljs.registerLanguage('json', json);
hljs.registerLanguage('markdown', markdown);
hljs.registerLanguage('python', python);
hljs.registerLanguage('sql', sql);
hljs.registerLanguage('typescript', typescript);
hljs.registerLanguage('xml', xml);
hljs.registerLanguage('yaml', yaml);
hljs.registerAliases(['cql', 'mariadb', 'mssql', 'mysql', 'plsql', 'sqlite'], { languageName: 'sql' });
hljs.registerAliases(['ecmascript', 'node'], { languageName: 'javascript' });

export { hljs };

// Unchanged fences re-highlight on every preview compile while typing, so
// memoize results. Huge one-off sources bypass the cache to bound memory.
const HIGHLIGHT_CACHE_LIMIT = 200;
const HIGHLIGHT_CACHE_MAX_SOURCE_CHARS = 20000;
const highlightCache = new Map();

export function getHighlightCacheSize() {
  return highlightCache.size;
}

export function highlightFence(source, language, { ignoreIllegals = false } = {}) {
  const text = String(source);
  const cacheable = text.length <= HIGHLIGHT_CACHE_MAX_SOURCE_CHARS;
  const cacheKey = cacheable ? `${language ?? ''}\n${ignoreIllegals ? 1 : 0}\n${text}` : null;
  if (cacheKey) {
    const cached = highlightCache.get(cacheKey);
    if (cached !== undefined) {
      return cached;
    }
  }

  const result = language && hljs.getLanguage(language)
    ? hljs.highlight(text, { ignoreIllegals, language }).value
    : hljs.highlightAuto(text, AUTO_HIGHLIGHT_LANGUAGES).value;

  if (cacheKey) {
    if (highlightCache.size >= HIGHLIGHT_CACHE_LIMIT) {
      highlightCache.delete(highlightCache.keys().next().value);
    }
    highlightCache.set(cacheKey, result);
  }

  return result;
}
