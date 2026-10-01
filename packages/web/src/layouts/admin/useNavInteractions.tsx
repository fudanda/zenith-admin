import { useCallback, useMemo } from 'react';
import { NavLink, type NavigateFunction } from 'react-router-dom';
import type { NavItem } from './utils';
import { useAdminExternalNavigation, useAdminOptions } from '@/admin/runtime';

// ─── Render wrappers 与导航交互 ────────────────────────────────────────────
export function useNavInteractions({
  navItems,
  navigate,
  setMobileNavVisible,
  setManualTopKey,
}: {
  navItems: NavItem[];
  navigate: NavigateFunction;
  setMobileNavVisible: (visible: boolean) => void;
  setManualTopKey: (key: string | null) => void;
}) {
  const openExternal = useAdminExternalNavigation();
  const customNavigation = useAdminOptions().navigateExternal;
  // 预构建 itemKey → isExternal 映射，避免每次 renderWrapper 调用时重复遍历
  const externalNavKeys = useMemo(() => {
    const map = new Set<string>();
    function walk(items: NavItem[]) {
      for (const item of items) {
        if (item.isExternal) map.add(item.itemKey);
        if (item.items) walk(item.items);
      }
    }
    walk(navItems);
    return map;
  }, [navItems]);

  // itemKey → 菜单默认路由参数（menus.query 字段），跳转时拼接 querystring
  const navQueryByKey = useMemo(() => {
    const map = new Map<string, string>();
    function walk(items: NavItem[]) {
      for (const item of items) {
        if (item.query) map.set(item.itemKey, item.query.replace(/^\?/, ''));
        if (item.items) walk(item.items);
      }
    }
    walk(navItems);
    return map;
  }, [navItems]);

  const withMenuQuery = useCallback((key: string) => {
    const query = navQueryByKey.get(key);
    return query ? `${key}?${query}` : key;
  }, [navQueryByKey]);

  const renderWrapper = useCallback(
    (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => {
      const { itemElement, props: itemProps } = args;
      const itemKey = String(itemProps.itemKey ?? '');
      if (externalNavKeys.has(itemKey)) {
        return (
          <a href={itemKey} target="_blank" rel="noopener noreferrer" className="admin-nav-link-wrapper" onClick={event => {
            if (customNavigation && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openExternal(itemKey); }
          }}>
            {itemElement}
          </a>
        );
      }
      if (!itemKey.startsWith('/')) return itemElement;
      return (
        <NavLink to={withMenuQuery(itemKey)} className="admin-nav-link-wrapper">
          {itemElement}
        </NavLink>
      );
    },
    [externalNavKeys, withMenuQuery, customNavigation, openExternal],
  );

  const renderMobileWrapper = useCallback(
    (args: { itemElement: React.ReactNode; props: { itemKey?: string | number } }) => {
      const { itemElement, props: itemProps } = args;
      const itemKey = String(itemProps.itemKey ?? '');
      if (externalNavKeys.has(itemKey)) {
        return (
          <a
            href={itemKey}
            target="_blank"
            rel="noopener noreferrer"
            className="admin-nav-link-wrapper"
            onClick={event => {
              setMobileNavVisible(false);
              if (customNavigation && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey) { event.preventDefault(); openExternal(itemKey); }
            }}
          >
            {itemElement}
          </a>
        );
      }
      if (!itemKey.startsWith('/')) return itemElement;
      return (
        <NavLink to={withMenuQuery(itemKey)} className="admin-nav-link-wrapper" onClick={() => setMobileNavVisible(false)}>
          {itemElement}
        </NavLink>
      );
    },
    [externalNavKeys, withMenuQuery, setMobileNavVisible, customNavigation, openExternal],
  );

  const handleDoubleRailClick = useCallback((item: NavItem) => {
    setManualTopKey(item.itemKey);
    if (item.items?.length) {
      function findFirstLeaf(items: NavItem[]): string | null {
        for (const i of items) {
          if (i.items?.length) {
            const leaf = findFirstLeaf(i.items);
            if (leaf) return leaf;
          } else if (i.itemKey.startsWith('/')) {
            return i.itemKey;
          }
        }
        return null;
      }
      const leaf = findFirstLeaf(item.items);
      if (leaf) navigate(withMenuQuery(leaf));
    } else if (item.itemKey.startsWith('/')) {
      navigate(withMenuQuery(item.itemKey));
    }
  }, [navigate, withMenuQuery, setManualTopKey]);

  const handleMixedTopSelect = useCallback(
    ({ itemKey: key }: { itemKey: string | number }) => {
      const k = String(key);
      setManualTopKey(k);
      const topItem = navItems.find((i) => i.itemKey === k);
      if (topItem?.items?.length) {
        function findFirstLeaf(items: NavItem[]): string | null {
          for (const item of items) {
            if (item.items?.length) {
              const leaf = findFirstLeaf(item.items);
              if (leaf) return leaf;
            } else if (item.itemKey.startsWith('/')) {
              return item.itemKey;
            }
          }
          return null;
        }
        const leaf = findFirstLeaf(topItem.items);
        if (leaf) navigate(withMenuQuery(leaf));
      }
    },
    [navItems, navigate, withMenuQuery, setManualTopKey],
  );

  return { renderWrapper, renderMobileWrapper, handleDoubleRailClick, handleMixedTopSelect };
}
