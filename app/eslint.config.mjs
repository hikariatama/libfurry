import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import globals from 'globals';
import reactHooks from 'eslint-plugin-react-hooks';

export default tseslint.config(
  { ignores: ['dist/**', 'release/**', 'build/**', '.build/**', 'coverage/**', 'node_modules/**'] },
  {
    files: ['electron/**/*.cjs', 'scripts/**/*.cjs', 'tests/**/*.cjs'],
    ...js.configs.recommended,
    languageOptions: { globals: { ...globals.node, fetch: 'readonly', Headers: 'readonly' } },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    extends: [js.configs.recommended, ...tseslint.configs.recommended, reactHooks.configs.flat.recommended],
    languageOptions: { globals: globals.browser },
    rules: {
      'react-hooks/refs': 'off',
      'react-hooks/set-state-in-effect': 'off',
    },
  },
);
