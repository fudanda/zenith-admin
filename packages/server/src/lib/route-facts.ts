/**
 * 路由门禁中间件的自描述标记。
 *
 * `authMiddleware` / `guard()` / `platformAdminOnly()` 返回的中间件函数上挂一份声明式事实
 * （是什么门禁、带什么权限码 / 审计 / 功能门控），装配好的 app 可以沿 `app.routes` 逐条读出
 * 每个端点实际生效的门禁——不必解析路由源码。用于：
 * - `contract-access-runtime.test.ts`：断言契约 `access` 声明与运行时门禁逐端点一致；
 * - 权限矩阵 / 接口目录的运行时核对。
 */
import type { LicenseFeatureKey } from '@arcbase/shared/licensing';

export const ROUTE_FACT: unique symbol = Symbol.for('arcbase.route-fact');

export type RouteFact =
  | { readonly kind: 'auth' }
  | { readonly kind: 'guard'; readonly permission: readonly string[] | null; readonly audit: Record<string, unknown> | null; readonly feature: LicenseFeatureKey | null }
  | { readonly kind: 'platform'; readonly onlyInMultiTenant: boolean };

/** 给中间件函数挂上事实标记（原函数返回，便于 `Object.assign` 风格链式使用） */
export function tagMiddleware<T extends object>(middleware: T, fact: RouteFact): T {
  Object.defineProperty(middleware, ROUTE_FACT, { value: fact, enumerable: false });
  return middleware;
}

export function readRouteFact(handler: unknown): RouteFact | undefined {
  if (typeof handler !== 'function') return undefined;
  return (handler as unknown as Record<symbol, RouteFact | undefined>)[ROUTE_FACT];
}
