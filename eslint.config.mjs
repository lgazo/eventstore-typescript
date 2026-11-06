import js from '@eslint/js';
import tsParser from '@typescript-eslint/parser';
import tsPlugin from '@typescript-eslint/eslint-plugin';
import prettierPlugin from 'eslint-plugin-prettier';
import prettierConfig from 'eslint-config-prettier';

export default [
  js.configs.recommended,
  {
    files: ['**/*.ts', '**/*.tsx'],
    languageOptions: {
      parser: tsParser,
      parserOptions: {
        ecmaVersion: 2020,
        sourceType: 'module',
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      '@typescript-eslint': tsPlugin,
      prettier: prettierPlugin,
    },
    rules: {
      ...tsPlugin.configs.recommended.rules,
      ...tsPlugin.configs['recommended-requiring-type-checking'].rules,
      ...prettierConfig.rules,
      'prettier/prettier': ['error', {}, { usePrettierrc: true }],
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      '@typescript-eslint/explicit-function-return-type': 'warn',
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unsafe-assignment': 'warn',
      '@typescript-eslint/no-unsafe-member-access': 'warn',
      '@typescript-eslint/no-unsafe-call': 'warn',
      '@typescript-eslint/no-unsafe-return': 'warn',
      // TS-appropriate overrides for base rules spread in above
      'no-undef': 'off',
      'no-redeclare': 'off',
    },
  },
  {
    files: ['**/*.js'],
    languageOptions: {
      ecmaVersion: 2020,
      sourceType: 'module',
    },
  },
  {
    // Test files are excluded from the package tsconfig projects (they must
    // never end up in build output), so the type-aware rules from the block
    // above cannot run there. Keep the base (type-unaware) rules active and
    // disable exactly the rules that need type information.
    files: ['**/*.test.ts', '**/*.spec.ts', '**/__tests__/**/*.ts', 'tests/**/*.ts'],
    rules: Object.fromEntries(
      Object.keys(tsPlugin.configs['recommended-requiring-type-checking'].rules).map((name) => [
        name,
        'off',
      ])
    ),
  },
  {
    ignores: ['node_modules/**', 'dist/**', '**/examples/**'],
  },
];
