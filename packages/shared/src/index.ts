/**
 * @arcbase/shared 根入口。
 *
 * **请勿在业务代码中使用**：根入口会把全部 18 个业务域拉进依赖图，
 * 使「改 CMS 类型」这类局部改动波及所有消费方。ESLint 已对 server/web 禁用该入口。
 *
 * 请改用域子路径：
 *   import type { User } from '@arcbase/shared/identity';
 *   import { createPaymentOrderSchema } from '@arcbase/shared/payment';
 *   import { SEED_MENUS } from '@arcbase/shared/seed';        // 种子数据独立入口
 *
 * 保留本文件的唯一目的：支持需要「全量枚举导出」的元编程场景。
 * 注意：并非所有域都从此处导出——新增域只登记 `package.json` 的 `exports` 子路径即可，
 * 因此依赖根入口做全量扫描的校验并不可靠；跨域的契约校验应基于装配后的 OpenAPI 文档
 * （见 server/src/app.contract.test.ts）。
 *
 * 注意：**刻意不导出 './seed'**。种子数据仅供 db/seed.ts 与 MSW mock 使用，
 * 不应进入生产依赖图，请从 '@arcbase/shared/seed' 引入。
 */
export * from './ai';
export * from './analytics';
export * from './biz';
export * from './chat';
export * from './cms';
export * from './core';
export * from './identity';
export * from './member';
export * from './messaging';
export * from './mp';
export * from './open-platform';
export * from './ops';
export * from './payment';
export * from './platform';
export * from './report';
export * from './rules';
export * from './tasks';
export * from './workflow';
