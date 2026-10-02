/**
 * 最近访问菜单 hook
 * 路由变化时自动追加，最多保留 20 条，存 localStorage，无需后端。
 */
import { useState, useCallback, useEffect } from 'react';
import type { FlatMenuItem } from '@/components/MenuSearchInput';

const STORAGE_KEY = 'arcbase:recent_menus';
const MAX_RECENT = 20;

function loadRecent(): number[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as number[]) : [];
  } catch {
    return [];
  }
}

function saveRecent(ids: number[]) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
  } catch {
    /* ignore */
  }
}

export function useRecentMenus(flatMenus: FlatMenuItem[], currentPath: string) {
  const [recents, setRecents] = useState<number[]>(loadRecent);

  // 路由变化时记录
  useEffect(() => {
    const menu = flatMenus.find((m) => m.path === currentPath);
    if (!menu) return;
    setRecents((prev) => {
      const next = [menu.id, ...prev.filter((id) => id !== menu.id)].slice(0, MAX_RECENT);
      saveRecent(next);
      return next;
    });
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentPath, flatMenus.length]);

  const clear = useCallback(() => {
    setRecents([]);
    saveRecent([]);
  }, []);

  const remove = useCallback((menuId: number) => {
    setRecents((prev) => {
      const next = prev.filter((id) => id !== menuId);
      saveRecent(next);
      return next;
    });
  }, []);

  return { recents, clear, remove };
}
