import { createContext, useCallback, useContext, useMemo } from 'react';
import type { Permission } from '@arcbase/shared/core';

/** 当前用户的权限码集合（服务端 `/auth/me` 下发；超管为 `['*']`） */
export const PermissionContext = createContext<string[]>([]);

export function usePermission() {
  const permissions = useContext(PermissionContext);

  // useCallback 保持引用稳定，便于页面将 hasPermission 作为 useMemo/useCallback 依赖
  // 参数只接受注册表里的权限码：拼错的码在编译期报错，而不是按钮静默消失
  const hasPermission = useCallback((code: Permission) => {
    if (permissions.includes('*')) return true;
    return permissions.includes(code);
  }, [permissions]);

  const hasAnyPermission = useCallback((...codes: Permission[]) => {
    if (permissions.includes('*')) return true;
    return codes.some((code) => permissions.includes(code));
  }, [permissions]);

  return useMemo(
    () => ({ permissions, hasPermission, hasAnyPermission }),
    [permissions, hasPermission, hasAnyPermission],
  );
}
