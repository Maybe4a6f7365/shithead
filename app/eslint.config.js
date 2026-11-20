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
      // `value!` tells the compiler to stop checking. Say it with a type or a
      // check that fails loudly instead.
      '@typescript-eslint/no-non-null-assertion': 'error',
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    languageOptions: { globals: { ...globals.browser, ...globals.serviceworker } },
    plugins: { 'react-hooks': reactHooks },
    rules: {
      // The two classic hook rules. The plugin's compiler-era rules are left
      // off: this code writes refs during render on purpose (see TableScreen).
      // An effect that must run on one trigger and read everything else as it
      // stands then says so with useEffectEvent, not with a disabled rule.
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'error',
    },
  },
  {
    // Tests feed the code deliberately malformed values, and assert on what
    // they have just put there.
    files: ['src/**/*.test.{ts,tsx}', 'src/**/__tests__/**'],
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
    },
  },
  {
    files: ['scripts/**/*.mjs', '*.config.{js,ts}'],
    languageOptions: { globals: { ...globals.node, ...globals.browser } },
  },
)
