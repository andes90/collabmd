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

export function highlightFence(source, language, { ignoreIllegals = false } = {}) {
  if (language && hljs.getLanguage(language)) {
    return hljs.highlight(source, { ignoreIllegals, language }).value;
  }

  return hljs.highlightAuto(source, AUTO_HIGHLIGHT_LANGUAGES).value;
}
