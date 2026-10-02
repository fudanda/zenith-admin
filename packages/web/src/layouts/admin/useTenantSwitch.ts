import { useEffect, useState } from 'react';
import { REFRESH_TOKEN_KEY, TOKEN_KEY } from '@arcbase/shared/core';
import { useAllTenants, useSwitchTenant } from '@/hooks/queries/tenants';

// ─── 租户切换（仅平台管理员） ─────────────────────────────────────────────
export function useTenantSwitch(isPlatformAdmin: boolean | undefined, initialViewingTenantId?: number | null) {
  const [viewingTenantId, setViewingTenantId] = useState<number | null>(initialViewingTenantId ?? null);
  const { data: tenants } = useAllTenants(!!isPlatformAdmin);
  const switchMutation = useSwitchTenant();

  // The access token is the source of truth. Keep the selector aligned after a
  // full reload or a silent token refresh instead of briefly showing platform
  // view while requests are already scoped to a tenant.
  useEffect(() => {
    setViewingTenantId(initialViewingTenantId ?? null);
  }, [initialViewingTenantId]);

  const tenantList = (tenants ?? []).filter((t) => t.status === 'enabled');

  const handleSwitchTenant = async (tenantId: number | null) => {
    const data = await switchMutation.mutateAsync({ body: { tenantId } });
    localStorage.setItem(TOKEN_KEY, data.accessToken);
    localStorage.setItem(REFRESH_TOKEN_KEY, data.refreshToken);
    setViewingTenantId(tenantId);
    globalThis.location.reload();
  };

  return { tenantList, viewingTenantId, handleSwitchTenant };
}
