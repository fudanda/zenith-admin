import { SUPER_ADMIN_CODE } from '@arcbase/shared/identity';
import { config } from '@/config';
import { useAuth } from '@/hooks/useAuth';

/**
 * 当前登录用户是否为平台管理员：多租户模式下持有 `super_admin` 且归属平台（tenantId 为空）。
 * 与服务端 `isPlatformAdmin` 判定口径一致；单租户模式恒为 false（此时没有「平台 / 租户」两级归属可选）。
 * 仅用于控制 UI 展示（如身份源的租户选择），权限判定始终以服务端为准。
 */
export function useIsPlatformAdmin(): boolean {
  const { user } = useAuth();
  if (!config.multiTenantMode || !user) return false;
  return !user.tenantId && (user.roles?.some((r) => r.code === SUPER_ADMIN_CODE) ?? false);
}
