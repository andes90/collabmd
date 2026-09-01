import js from '@eslint/js';
import globals from 'globals';

const sharedGlobals = {
  ...globals.browser,
  ...globals.node,
  ...globals.worker,
};

export default [
  {
    ignores: [
      '.tmp/**',
      'dist/**',
      'docs/assets/**',
      'node_modules/**',
      'packaging/homebrew-tap/**',
      'test-results/**',
      'test-vault/**',
    ],
  },
  js.configs.recommended,
  {
    files: ['**/*.{js,mjs}'],
    languageOptions: {
      ecmaVersion: 'latest',
      globals: sharedGlobals,
      sourceType: 'module',
    },
    rules: {
      'complexity': ['warn', { max: 30 }],
      'max-lines': ['warn', { max: 1000, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
      'quotes': ['error', 'single', {
        avoidEscape: true,
        allowTemplateLiterals: true,
      }],
    },
  },
  {
    files: ['src/domain/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['../client/**', '../server/**'],
      }],
    },
  },
  {
    files: ['src/client/presentation/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../application/**', '../../application/**', '../../../application/**',
          '../infrastructure/**', '../../infrastructure/**', '../../../infrastructure/**',
        ],
      }],
      'no-restricted-syntax': ['error', {
        message: 'Inject HTTP clients instead of calling fetch from presentation code.',
        selector: "CallExpression[callee.name='fetch']",
      }],
    },
  },
  {
    files: ['src/client/application/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../presentation/**', '../../presentation/**',
          '../infrastructure/**', '../../infrastructure/**',
        ],
      }],
      'no-restricted-syntax': ['error', {
        message: 'Inject HTTP clients instead of calling fetch from application code.',
        selector: "CallExpression[callee.name='fetch']",
      }],
    },
  },
  {
    files: ['src/client/infrastructure/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../application/**', '../../application/**',
          '../presentation/**', '../../presentation/**',
        ],
      }],
    },
  },
  {
    files: ['src/server/application/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../auth/**', '../config/**', '../infrastructure/**',
          '../../client/**',
        ],
      }],
    },
  },
  {
    files: ['src/server/domain/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../infrastructure/**', '../../infrastructure/**', '../../../infrastructure/**',
        ],
      }],
    },
  },
  {
    files: ['src/server/auth/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['../infrastructure/**'],
      }],
    },
  },
];
