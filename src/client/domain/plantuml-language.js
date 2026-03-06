import { LanguageDescription, LanguageSupport, StreamLanguage } from '@codemirror/language';

const DIRECTIVES = new Set([
  '@startuml',
  '@enduml',
  '@startmindmap',
  '@endmindmap',
  '@startwbs',
  '@endwbs',
  '@startgantt',
  '@endgantt',
  '@startjson',
  '@endjson',
  '@startyaml',
  '@endyaml',
  '@startsalt',
  '@endsalt',
]);

const KEYWORDS = new Set([
  'activate',
  'actor',
  'agent',
  'allowmixing',
  'alt',
  'annotation',
  'artifact',
  'as',
  'autonumber',
  'boundary',
  'box',
  'break',
  'caption',
  'card',
  'case',
  'circle',
  'class',
  'cloud',
  'collections',
  'component',
  'control',
  'create',
  'critical',
  'database',
  'deactivate',
  'destroy',
  'detach',
  'else',
  'elseif',
  'end',
  'endlegend',
  'endif',
  'endwhile',
  'entity',
  'enum',
  'exception',
  'file',
  'folder',
  'footer',
  'fork',
  'frame',
  'group',
  'header',
  'hide',
  'hnote',
  'if',
  'interface',
  'json',
  'kill',
  'label',
  'legend',
  'loop',
  'map',
  'namespace',
  'newpage',
  'node',
  'note',
  'object',
  'of',
  'opt',
  'order',
  'over',
  'package',
  'page',
  'par',
  'participant',
  'partition',
  'person',
  'port',
  'protocol',
  'queue',
  'rectangle',
  'ref',
  'repeat',
  'return',
  'rnote',
  'show',
  'skinparam',
  'split',
  'stack',
  'start',
  'state',
  'stop',
  'storage',
  'struct',
  'switch',
  'then',
  'title',
  'usecase',
  'while',
]);

const BOOLEAN_LITERALS = new Set([
  'false',
  'no',
  'off',
  'on',
  'true',
  'yes',
]);

function readWord(stream) {
  const match = stream.match(/[@!A-Za-z_][\w.-]*/u, false);
  if (!match) {
    return '';
  }

  stream.match(/[@!A-Za-z_][\w.-]*/u);
  return match[0];
}

const plantUmlStreamLanguage = StreamLanguage.define({
  languageData: {
    commentTokens: {
      block: { close: "'/", open: "/'" },
      line: "'",
    },
  },
  startState() {
    return {
      inBlockComment: false,
    };
  },
  token(stream, state) {
    if (state.inBlockComment) {
      if (stream.skipTo("'/")) {
        stream.match("'/");
        state.inBlockComment = false;
      } else {
        stream.skipToEnd();
      }

      return 'comment';
    }

    if (stream.eatSpace()) {
      return null;
    }

    if (stream.match("/'")) {
      state.inBlockComment = true;
      return 'comment';
    }

    const previousCharacter = stream.pos === 0 ? ' ' : stream.string.charAt(stream.pos - 1);
    if (stream.peek() === "'" && (stream.sol() || /\s/u.test(previousCharacter))) {
      stream.skipToEnd();
      return 'comment';
    }

    if (stream.match(/"(?:[^"\\]|\\.)*"?/u)) {
      return 'string';
    }

    if (stream.match(/#[0-9a-f]{3,8}\b/iu) || stream.match(/#[A-Za-z][\w-]*/u)) {
      return 'atom';
    }

    if (stream.match(/\b\d+(?:\.\d+)?\b/u)) {
      return 'number';
    }

    if (stream.match(/[<>{}\[\]():,]/u)) {
      return 'punctuation';
    }

    if (stream.match(/[ox*+<#]?[-=.\\/]+(?:left|right|up|down)?[-=.\\/]*[ox*+>#]?/iu)) {
      return 'operator';
    }

    const word = readWord(stream);
    if (word) {
      const normalized = word.toLowerCase();

      if (normalized.startsWith('!') || DIRECTIVES.has(normalized)) {
        return 'meta';
      }

      if (KEYWORDS.has(normalized)) {
        return 'keyword';
      }

      if (BOOLEAN_LITERALS.has(normalized)) {
        return 'bool';
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

export const plantUmlLanguage = new LanguageSupport(plantUmlStreamLanguage);

export const plantUmlLanguageDescription = LanguageDescription.of({
  alias: ['plantuml', 'puml'],
  extensions: ['plantuml', 'puml'],
  name: 'PlantUML',
  support: plantUmlLanguage,
});
