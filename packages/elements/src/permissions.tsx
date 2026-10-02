import { useCallback, useMemo, type ReactNode } from 'react';
import type { Permission } from '@arcbase/shared/core';
import { useSession } from './provider';

export function usePermission() {
  const session = useSession();
  const permissions = session.status === 'authenticated' ? session.session?.permissions ?? [] : [];
  const hasPermission = useCallback((code: Permission) => permissions.includes('*') || permissions.includes(code), [permissions]);
  const hasAnyPermission = useCallback((...codes: Permission[]) => codes.some(hasPermission), [hasPermission]);
  return useMemo(() => ({ permissions, hasPermission, hasAnyPermission }), [permissions, hasPermission, hasAnyPermission]);
}
/** UI visibility only; the Go service authorizes every request. */
export function PermissionGuard({ permission, mode = 'any', children, fallback = null }: {
  permission: Permission | readonly Permission[]; mode?: 'any' | 'all'; children: ReactNode; fallback?: ReactNode;
}) {
  const { hasPermission } = usePermission();
  const codes = typeof permission === 'string' ? [permission] : [...permission];
  const allowed = codes.length > 0 && (mode === 'all' ? codes.every(hasPermission) : codes.some(hasPermission));
  return <>{allowed ? children : fallback}</>;
}
export function SessionBoundary({ children, loading = null, unauthenticated = null, unavailable }: {
  children: ReactNode; loading?: ReactNode; unauthenticated?: ReactNode; unavailable?: (error: Error | null, retry: () => Promise<void>) => ReactNode;
}) {
  const session = useSession();
  if (session.status === 'checking') return <>{loading}</>;
  if (session.status === 'unavailable') return <>{unavailable?.(session.error, session.refresh) ?? <div role="alert">{session.error?.message}</div>}</>;
  return <>{session.status === 'authenticated' ? children : unauthenticated}</>;
}
