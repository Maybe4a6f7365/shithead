import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/', 'coverage/', '.wrangler/', 'public/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      // `catch {}` is how this code says "best effort": closing a socket that
      // may already be closed, reading storage that policy may block.
      'no-empty': ['error', { allowEmptyCatch: true }],
      // A leading underscore marks a parameter kept only for its position.
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      // `interface A extends B {}` names a concept; it is not an empty type.
      '@typescript-eslint/no-empty-object-type': ['error', { allowInterfaces: 'with-single-extends' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two classic hook rules. The plugin's compiler-era rules are left
      // off: this code writes refs during render on purpose (see TableScreen).
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
    },
  },
  {
    // Tests reach for Node built-ins the browser tsconfig does not type, and
    // feed the code deliberately malformed values.
    files: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    rules: {
      '@typescript-eslint/ban-ts-comment': ['error', { 'ts-ignore': 'allow-with-description' }],
      '@typescript-eslint/no-explicit-any': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
