import type { Menu } from '@zenith/shared/identity';
import type { ZenithAdminModule } from './types';
import { useMemo } from 'react';
import { integrationContract } from '@zenith/shared/integrations';
import { useAdminOptions } from './runtime';
import { useApiQuery } from '@/lib/contract-query';

export function useMountedAdminModules() {
  const { modules } = useAdminOptions();
  const enabled = !!modules?.length;
  const query = useApiQuery(integrationContract.modules, { enabled, staleTime: 60000, requestOptions: { silent: true } });
  const mounted = useMemo(() => (modules ?? []).flatMap(module => {
    const declaration = query.data?.find(item => item.id === module.id);
    if (!declaration) return [];
    const pages = module.pages.filter(page => declaration.pages.some(item => item.id === page.id && item.path === page.path && item.permission === page.permission));
    return pages.length ? [{ ...module, pages }] : [];
  }), [modules, query.data]);
  return { modules: mounted, enabled, query };
}

/** Local host navigation uses negative IDs, keeping persisted Zenith IDs intact. */
export function hostMenus(modules: readonly ZenithAdminModule[], permissions: readonly string[]): Menu[] {
  let id = -1;
  const allowed = (permission: string) => permissions.includes('*') || permissions.includes(permission);
  return modules.flatMap(module => {
    const parentId = id--;
    const base = { sort: 10000, status: 'enabled' as const, visible: true, createdAt: '', updatedAt: '' };
    const children = module.pages.map(page => ({
      ...base, id: id--, parentId, type: 'menu' as const, name: `host:${module.id}:${page.id}`,
      title: page.title, path: page.path, component: `host:${module.id}:${page.id}`,
      permission: page.permission, icon: page.icon, keepAlive: page.keepAlive ?? true,
    })).filter(page => allowed(page.permission));
    return children.length ? [{ ...base, id: parentId, parentId: 0, type: 'directory' as const, title: module.title, icon: module.icon, children }] : [];
  });
}
