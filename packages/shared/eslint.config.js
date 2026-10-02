import js from '@eslint/js';
import tseslint from 'typescript-eslint';

/**
 * `@arcbase/shared` 此前没有任何 lint 配置——111 个文件、前后端共用的全部类型与
 * Zod schema 完全不受约束，而 CI 的 `npm run lint` 也只覆盖 server / analytics-sdk / web。
 * 一处 schema 改错可以同时打穿两端却无人拦截。
 */
export default tseslint.config(
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
  },
  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // 种子数据只服务于 db/seed.ts 与 MSW mock，不应进入生产依赖图。
    // 域代码一旦引用 seed，消费方 import 任意域都会把整棵种子树拉进 bundle。
    files: ['src/*/**/*.ts'],
    ignores: ['src/seed/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['**/seed', '**/seed/*', '@arcbase/shared/seed', '@arcbase/shared/seed/*'],
              message: '业务域不得引用 seed：种子数据只服务于 db/seed.ts 与 MSW mock，不应进入生产依赖图。',
            },
          ],
        },
      ],
    },
  },
  // 部分更新 schema 一律由 partialForUpdate() 派生：Zod 的 .partial() 保留 .default()，
  // 字段省略时会填入默认值并经服务层 .set({ ...data }) 写库，覆盖从未提交的字段。
  {
    files: ['src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='partial']",
          message: '禁止直接调用 .partial()：请改用 partialForUpdate()（core/validation），否则字段省略时会注入 .default() 并覆盖未提交的字段。',
        },
      ],
    },
  },
  // 契约积木纪律（constraints.md → Shared 层「契约积木」）：查询串里的标准时间范围与关联 ID 只用 core/api-schemas 的积木，
  // 逐个手写六段链式调用是本轮收敛前 141 / 72 处重复的来源。同名规则整体覆盖，故把 .partial() 那条一并带上。
  {
    files: ['src/*/contracts/**/*.ts'],
    ignores: ['src/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: "CallExpression[callee.property.name='partial']",
          message: '禁止直接调用 .partial()：请改用 partialForUpdate()（core/validation），否则字段省略时会注入 .default() 并覆盖未提交的字段。',
        },
        {
          selector: "Property[key.name=/^(startTime|endTime)$/] > CallExpression[callee.name='dateRangeBound']",
          message: "标准 startTime / endTime 范围端点请展开 ...dateRangeQuery('作用的时间字段')（core/api-schemas）；只有 startAt / dateStart 等非标准键名才逐个写 dateRangeBound。",
        },
        {
          selector: "Property[key.name=/Id$/] > CallExpression[callee.property.name='optional'][callee.object.callee.property.name='positive'][callee.object.callee.object.callee.property.name='int']",
          message: '查询串里的关联 ID 筛选请用 idQuery(description?)（core/api-schemas），不要逐个写 z.coerce.number().int().positive().optional()。',
        },
        {
          selector: "Property[key.name=/Id$/] > CallExpression[callee.property.name='optional'][callee.object.callee.property.name='int'][callee.object.callee.object.callee.property.name='number'][callee.object.callee.object.callee.object.property.name='coerce']",
          message: '查询串里的关联 ID 筛选请用 idQuery(description?)（core/api-schemas），不要写 z.coerce.number().int().optional()——前端筛选控件与 Mock 过滤都靠它的 x-filter 语义。',
        },
        {
          selector: "Property[key.name=/Id$/] > CallExpression[callee.property.name='positive'][callee.object.callee.property.name='int'][callee.object.callee.object.callee.property.name='number'][callee.object.callee.object.callee.object.property.name='coerce']",
          message: '查询串里必填的切分维度（siteId / applicationId）请用 requiredIdQuery(description?)（core/api-schemas），不要写 z.coerce.number().int().positive()。',
        },
        {
          selector: "Property[key.name='keyword'] > CallExpression[callee.property.name='optional'][callee.object.callee.property.name='string'][callee.object.callee.object.name='z']",
          message: "列表查询的关键字参数请用 keywordQuery('X / Y', { max? })（core/api-schemas），不要直写 z.string().optional()。",
        },
        {
          selector: "Property[key.name='keyword'] > CallExpression[callee.property.name='optional'][callee.object.callee.property.name='max'][callee.object.callee.object.callee.property.name='string']",
          message: "带长度上限的关键字参数请用 keywordQuery('X / Y', { max: N })（core/api-schemas），不要直写 z.string().max(N).optional()。",
        },
        {
          selector: "Property[key.name='keyword'] > CallExpression[callee.property.name='meta'][callee.object.callee.property.name='optional'][callee.object.callee.object.callee.property.name='string'][callee.object.callee.object.callee.object.name='z']",
          message: "列表查询的关键字参数请用 keywordQuery('X / Y')（core/api-schemas），不要直写 z.string().optional().meta({ description })。",
        },
        {
          selector: "CallExpression[callee.property.name='meta'] > CallExpression.callee > MemberExpression > CallExpression[callee.name=/^(queryEnum|queryBool|keywordQuery|idQuery)$/]",
          message: '不要在 queryEnum / queryBool / keywordQuery / idQuery 之后再链 .meta()（会覆盖积木写入的 x-filter 语义）：描述请通过积木的 options.description 传入。',
        },
      ],
    },
  },
);
