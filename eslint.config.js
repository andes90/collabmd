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
      '.codex/**',
      'dist/**',
      'public/assets/**',
      'docs/assets/**',
      'node_modules/**',
      'packaging/homebrew-tap/**',
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
      'no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        caughtErrors: 'none',
      }],
    },
  },
];
