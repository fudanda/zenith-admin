import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: { parserOptions: { warnOnUnsupportedTypeScriptVersion: false } },
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
      'no-restricted-imports': ['error', {
        patterns: [{ group: ['react', 'react/*', '@tanstack/*', '@douyinfe/*', '@zenith/web', '@zenith/server', '@/*'], message: 'Client only depends on shared contracts and transport APIs.' }],
      }],
    },
  },
);
