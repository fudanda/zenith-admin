/**
 * 用户收藏菜单 hook
 * 在内存中维护有序的收藏菜单 ID 列表，与后端同步。
 */
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { authContract } from '@arcbase/shared/identity';
import { api, useApiMutation } from '@/lib/contract-query';

const favoriteMenuKeys = {
  all: ['auth', 'favorite-menus'] as const,
};

export function useFavoriteMenus() {
  const queryClient = useQueryClient();
  const favoritesQuery = useQuery({
    queryKey: favoriteMenuKeys.all,
    queryFn: () => api(authContract.favoriteMenus),
  });
  const favorites = useMemo(() => favoritesQuery.data ?? [], [favoritesQuery.data]);

  const saveMutation = useApiMutation(authContract.saveFavoriteMenus, {
    invalidate: (qc) => void qc.invalidateQueries({ queryKey: favoriteMenuKeys.all }),
  });
  const { mutate: saveFavoriteMenusRaw } = saveMutation;
  const saveFavoriteMenus = useCallback((ids: number[]) => saveFavoriteMenusRaw({ body: { menuIds: ids } }), [saveFavoriteMenusRaw]);

  const isFavorite = useCallback((menuId: number) => favorites.includes(menuId), [favorites]);

  const save = useCallback((ids: number[]) => {
    queryClient.setQueryData(favoriteMenuKeys.all, ids);
    saveFavoriteMenus(ids);
  }, [queryClient, saveFavoriteMenus]);

  const toggle = useCallback(
    (menuId: number) => {
      const next = favorites.includes(menuId) ? favorites.filter((id) => id !== menuId) : [...favorites, menuId];
      save(next);
    },
    [favorites, save],
  );

  const reorder = useCallback(
    (ids: number[]) => {
      save(ids);
    },
    [save],
  );

  return { favorites, loaded: !favoritesQuery.isLoading, isFavorite, toggle, reorder };
}
