import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';

const DIAGRAM_DECLARATIONS = new Set([
  'block-beta',
  'classdiagram',
  'erdiagram',
  'flowchart',
  'gantt',
  'gitgraph',
  'graph',
  'journey',
  'mindmap',
  'pie',
  'quadrantchart',
  'sankey-beta',
  'sequencediagram',
  'statediagram',
  'statediagram-v2',
  'timeline',
  'xychart-beta',
]);

const KEYWORDS = new Set([
  'accdescr',
  'acctitle',
  'actor',
  'alt',
  'and',
  'autonumber',
  'break',
  'callback',
  'class',
  'classdef',
  'click',
  'critical',
  'dateformat',
  'direction',
  'else',
  'end',
  'exclude',
  'include',
  'interpolate',
  'link',
  'linkstyle',
  'loop',
  'note',
  'opt',
  'par',
  'participant',
  'rect',
  'section',
  'state',
  'style',
  'subgraph',
  'theme',
  'title',
]);

const BOOLEAN_LITERALS = new Set([
  'false',
  'no',
  'off',
  'on',
  'true',
  'yes',
]);

const FLOW_DIRECTIONS = new Set([
  'bt',
  'lr',
  'rl',
  'tb',
  'td',
]);

function readDirective(stream) {
  if (!stream.match('%%{')) {
    return false;
  }

  if (stream.skipTo('}%%')) {
    stream.match('}%%');
  } else {
    stream.skipToEnd();
  }

  return true;
}

const mermaidStreamLanguage = StreamLanguage.define({
  languageData: {
    commentTokens: {
      line: '%%',
    },
  },
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (readDirective(stream)) {
      return 'meta';
    }

    if (stream.match('%%')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(/"(?:[^"\\]|\\.)*"?/u) || stream.match(/'(?:[^'\\]|\\.)*'?/u)) {
      return 'string';
    }

    if (stream.match(/#[0-9a-f]{3,8}\b/iu) || stream.match(/#[A-Za-z][\w-]*/u)) {
      return 'atom';
    }

    if (stream.match(/\b\d+(?:\.\d+)?%?\b/u)) {
      return 'number';
    }

    if (stream.match(/[ox*+<#]?[-=.\\/]+(?:left|right|up|down)?[-=.\\/]*[ox*+>#]?/iu)) {
      return 'operator';
    }

    if (stream.match(/[{}[\]():,;|]/u)) {
      return 'punctuation';
    }

    const word = stream.match(/[A-Za-z_][\w.]*(?:-[A-Za-z0-9_][\w.]*)*/u)?.[0] ?? '';
    if (word) {
      const normalized = word.toLowerCase();

      if (DIAGRAM_DECLARATIONS.has(normalized)) {
        return 'meta';
      }

      if (KEYWORDS.has(normalized)) {
        return 'keyword';
      }

      if (BOOLEAN_LITERALS.has(normalized)) {
        return 'bool';
      }

      if (FLOW_DIRECTIONS.has(normalized)) {
        return 'atom';
      }

      if (/^[A-Z][A-Z0-9_]*$/u.test(word)) {
        return 'typeName';
      }

      return 'variableName';
    }

    stream.next();
    return null;
  },
});

export const mermaidLanguage = new LanguageSupport(mermaidStreamLanguage);

export const mermaidLanguageDescription = LanguageDescription.of({
  alias: ['mermaid', 'mmd'],
  extensions: ['mermaid', 'mmd'],
  name: 'Mermaid',
  support: mermaidLanguage,
});
