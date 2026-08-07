import js from '@eslint/js';
import eslintConfigPrettier from 'eslint-config-prettier';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import globals from 'globals';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/node_modules/**',
      '**/coverage/**',
      '**/*.tsbuildinfo',
      'pnpm-lock.yaml',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended, // non-type-checked variant on purpose — kept simple, no parserOptions.project

  // Underscore-prefixed args/vars/catch-bindings are the standard way to satisfy
  // required signatures (e.g. Express's 4-arg error-handler arity) without using
  // an unused identifier — recognize that convention instead of flagging it.
  {
    rules: {
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },

  // packages/shared and apps/api — Node-ish tooling globals, no DOM/JSX.
  {
    files: ['packages/shared/**/*.ts', 'apps/api/**/*.ts'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.node },
    },
  },

  // apps/web — Vite + React app: browser globals, JSX, react-hooks, react-refresh.
  {
    files: ['apps/web/**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2023,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
    },
  },

  // Root/tooling config files (this file, vite.config.ts) execute under Node.
  {
    files: ['*.config.{js,mjs,cjs,ts}', 'apps/web/vite.config.ts'],
    languageOptions: {
      globals: { ...globals.node },
    },
  },

  // Must be last: disables stylistic ESLint/typescript-eslint rules that would
  // conflict with Prettier. Prettier itself is run separately (not via
  // eslint-plugin-prettier) so linting stays fast and formatting stays Prettier's job alone.
  eslintConfigPrettier,
);
