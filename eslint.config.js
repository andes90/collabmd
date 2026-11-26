import js from '@eslint/js';
import globals from 'globals';

const pureDomainGlobals = {
  ...globals.es2025,
  URL: 'readonly',
  URLSearchParams: 'readonly',
  TextDecoder: 'readonly',
  TextEncoder: 'readonly',
  console: 'readonly',
  crypto: 'readonly',
  structuredClone: 'readonly',
};

const forbiddenTransportSyntax = [
  {
    message: 'Inject HTTP clients instead of calling fetch directly from this layer.',
    selector: "CallExpression[callee.name='fetch']",
  },
  {
    message: 'Inject HTTP clients instead of calling global fetch directly from this layer.',
    selector: "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(?:window|globalThis|self)$/][callee.property.name='fetch']",
  },
  {
    message: 'Create WebSocket connections in infrastructure adapters, not in this layer.',
    selector: "NewExpression[callee.name='WebSocket']",
  },
  {
    message: 'Create EventSource connections in infrastructure adapters, not in this layer.',
    selector: "NewExpression[callee.name='EventSource']",
  },
  {
    message: 'Use injected HTTP clients instead of XMLHttpRequest.',
    selector: "NewExpression[callee.name='XMLHttpRequest']",
  },
];

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
      sourceType: 'module',
    },
    rules: {
      'array-callback-return': 'error',
      'complexity': ['warn', { max: 30 }],
      'default-case-last': 'error',
      'eqeqeq': ['error', 'smart'],
      'max-lines': ['warn', { max: 1000, skipBlankLines: true, skipComments: true }],
      'max-lines-per-function': ['warn', { max: 300, skipBlankLines: true, skipComments: true }],
      'no-constructor-return': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-return-assign': 'error',
      'no-self-compare': 'error',
      'no-template-curly-in-string': 'error',
      'no-throw-literal': 'error',
      'no-unreachable-loop': 'error',
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'all',
        caughtErrorsIgnorePattern: '^_',
      }],
      'no-var': 'error',
      'prefer-const': ['error', { ignoreReadBeforeAssign: true }],
      'quotes': ['error', 'single', {
        avoidEscape: true,
        allowTemplateLiterals: true,
      }],
      'semi': ['error', 'always'],
    },
  },
  // Runtime-scoped globals so no-undef catches cross-environment leaks
  {
    files: ['src/domain/**/*.{js,mjs}'],
    languageOptions: { globals: pureDomainGlobals },
  },
  {
    files: ['src/client/**/*.{js,mjs}', 'landing/**/*.{js,mjs}'],
    ignores: ['src/client/application/preview-render-worker.js'],
    languageOptions: { globals: globals.browser },
  },
  {
    files: ['src/client/application/preview-render-worker.js'],
    languageOptions: { globals: globals.worker },
  },
  {
    files: ['src/server/**/*.{js,mjs}', 'bin/**/*.{js,mjs}', 'scripts/**/*.{js,mjs}', '*.config.{js,mjs}', 'eslint.config.js'],
    languageOptions: { globals: globals.node },
  },
  {
    files: ['scripts/capture-readme-assets.mjs'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
  {
    files: ['tests/**/*.{js,mjs}'],
    languageOptions: {
      globals: {
        ...globals.browser,
        ...globals.node,
        ...globals.worker,
      },
    },
    rules: {
      'no-restricted-syntax': ['error', {
        message: 'Remove .only before committing tests.',
        selector: "CallExpression[callee.type='MemberExpression'][callee.object.name=/^(?:test|describe|it)$/][callee.property.name='only']",
      }],
    },
  },
  // Architecture boundaries
  {
    files: ['src/domain/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['../client/**', '../../client/**', '../server/**', '../../server/**'],
      }],
    },
  },
  {
    files: ['src/client/domain/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../application/**', '../../application/**', '../../../application/**',
          '../infrastructure/**', '../../infrastructure/**', '../../../infrastructure/**',
          '../presentation/**', '../../presentation/**', '../../../presentation/**',
          '../../server/**', '../../../server/**',
        ],
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
          '../../server/**', '../../../server/**',
        ],
      }],
      'no-restricted-syntax': ['error', ...forbiddenTransportSyntax],
    },
  },
  {
    files: ['src/client/application/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../presentation/**', '../../presentation/**', '../../../presentation/**',
          '../infrastructure/**', '../../infrastructure/**', '../../../infrastructure/**',
          '../../server/**', '../../../server/**',
        ],
      }],
      'no-restricted-syntax': ['error', ...forbiddenTransportSyntax],
    },
  },
  {
    files: ['src/client/infrastructure/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../application/**', '../../application/**', '../../../application/**',
          '../presentation/**', '../../presentation/**', '../../../presentation/**',
          '../../server/**', '../../../server/**',
        ],
      }],
    },
  },
  {
    files: ['src/server/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        paths: [
          {
            importNames: ['exec', 'execSync'],
            message: 'Use execFile with an explicit argv array instead of shell-invoking exec/execSync.',
            name: 'node:child_process',
          },
          {
            importNames: ['exec', 'execSync'],
            message: 'Use execFile with an explicit argv array instead of shell-invoking exec/execSync.',
            name: 'child_process',
          },
        ],
      }],
    },
  },
  {
    files: ['src/server/**/*.{js,mjs}'],
    ignores: ['src/server/config/**/*.{js,mjs}'],
    rules: {
      'no-restricted-syntax': ['error', {
        message: 'Read environment variables in src/server/config/ and pass config values inward.',
        selector: "MemberExpression[object.type='MemberExpression'][object.object.name='process'][object.property.name='env']",
      }],
    },
  },
  {
    files: ['src/server/application/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: [
          '../auth/**', '../../auth/**',
          '../config/**', '../../config/**',
          '../infrastructure/**', '../../infrastructure/**',
          '../../client/**', '../../../client/**',
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
          '../application/**', '../../application/**', '../../../application/**',
          '../auth/**', '../../auth/**', '../../../auth/**',
          '../../client/**', '../../../client/**',
        ],
      }],
    },
  },
  {
    files: ['src/server/auth/**/*.{js,mjs}'],
    rules: {
      'no-restricted-imports': ['error', {
        patterns: ['../infrastructure/**', '../../infrastructure/**', '../../client/**'],
      }],
    },
  },
];
