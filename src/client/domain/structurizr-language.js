import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';

const KEYWORDS = new Set([
  'animation',
  'autoLayout',
  'component',
  'configuration',
  'container',
  'custom',
  'decisions',
  'deployment',
  'description',
  'dynamic',
  'element',
  'filtered',
  'group',
  'include',
  'image',
  'model',
  'person',
  'perspectives',
  'properties',
  'relationship',
  'relationships',
  'styles',
  'systemContext',
  'systemLandscape',
  'system',
  'theme',
  'views',
  'workspace',
]);

const structurizrStreamLanguage = StreamLanguage.define({
  languageData: {
    commentTokens: { line: '//' },
  },
  token(stream) {
    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match('//')) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(/!\w+/u)) {
      return 'meta';
    }

    if (stream.match(/"(?:[^"\\]|\\.)*"?/u)) {
      return 'string';
    }

    if (stream.match(/\b\d+(?:\.\d+)?\b/u)) {
      return 'number';
    }

    if (stream.match(/[-=]?>|[{}[\]():,=]/u)) {
      return 'operator';
    }

    const word = stream.match(/[A-Za-z_][\w.-]*/u)?.[0] ?? '';
    if (word) {
      if (KEYWORDS.has(word)) {
        return 'keyword';
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

export const structurizrLanguage = new LanguageSupport(structurizrStreamLanguage);

export const structurizrLanguageDescription = LanguageDescription.of({
  alias: ['structurizr', 'structurizr-dsl'],
  extensions: ['dsl'],
  name: 'Structurizr DSL',
  support: structurizrLanguage,
});
