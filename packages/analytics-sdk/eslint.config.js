import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default [
  { ignores: ['dist/**', 'node_modules/**'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // SDK 嵌入第三方页面，没有 web 端那样的入口 polyfill：非安全上下文（HTTP）下 crypto.randomUUID 不存在
      'no-restricted-syntax': [
        'error',
        {
          selector: 'MemberExpression[property.name="randomUUID"]',
          message: '请使用 @arcbase/shared/core 的 randomUUID()；非安全上下文下 crypto.randomUUID 不存在。',
        },
      ],
    },
  },
];
