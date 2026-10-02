import type { Menu } from '@zenith/shared/identity';

const IS_GO_FOUNDATION = import.meta.env.VITE_GO_FOUNDATION === 'true';
/** 固定路由路径，不通过菜单动态加载（导出供路由策略回归测试使用） */
export const FIXED_ROUTES = new Set(['/profile', '/announcements', '/inbox', '/search', '/system/firewall', '/system/nginx-sites']);

/** 扁平化菜单以便注册路由 */
export function flattenMenus(menus: Menu[]): Menu[] {
  const routes: Menu[] = [];
  for (const m of menus) {
    if (m.path && m.component && !FIXED_ROUTES.has(m.path) && (!IS_GO_FOUNDATION || m.path !== '/')) {
      routes.push(m);
    }
    if (m.children && m.children.length > 0) {
      routes.push(...flattenMenus(m.children));
    }
  }
  return routes;
}

/** 收集「外链 + 内嵌」菜单，注册为 /embed/{id} 内部路由 */
export function flattenEmbedMenus(menus: Menu[]): Menu[] {
  const result: Menu[] = [];
  for (const m of menus) {
    if (m.isExternal && m.embed && m.path) {
      result.push(m);
    }
    if (m.children?.length) {
      result.push(...flattenEmbedMenus(m.children));
    }
  }
  return result;
}

/**
 * 从所有菜单中提取「path → component」映射，用于判断某个路径是否对应一个已存在的页面组件。
 * 这样可以在 catch-all 路由中区分 403（页面存在但无权限）和 404（页面不存在）。
 */
export function buildAllMenuPaths(menus: Menu[]): Map<string, string> {
  const map = new Map<string, string>();
  for (const m of menus) {
    if (m.path && m.component && !FIXED_ROUTES.has(m.path) && (!IS_GO_FOUNDATION || m.path !== '/')) {
      map.set(m.path, m.component);
    }
    if (m.children?.length) {
      const childPaths = buildAllMenuPaths(m.children);
      childPaths.forEach((v, k) => map.set(k, v));
    }
  }
  return map;
}
