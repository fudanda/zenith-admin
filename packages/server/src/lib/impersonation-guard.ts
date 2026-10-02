import { apiTokenContract, authContract, impersonationContract } from '@arcbase/shared/identity';
import type { ImpersonationClaim } from '../middleware/auth';

const WRITE_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

/**
 * 模拟会话（含可操作模式）永远禁止的写路径：
 * 改密 / 资料（邮箱手机可劫持找回密码）/ MFA / 可信设备 / API Token / 租户视角 / 嵌套模拟。
 */
const SECURITY_BLOCKED_PREFIXES: readonly string[] = [
  authContract.changePassword.fullPath,
  authContract.updateProfile.fullPath,
  `${authContract.basePath}/mfa`,
  `${authContract.basePath}/trusted-devices`,
  authContract.switchTenant.fullPath,
  apiTokenContract.basePath,
  impersonationContract.start.fullPath,
];

/** 被模拟用户的个人界面态（偏好 / 收藏菜单）：模拟会话不得覆盖，前端自动同步会静默失败 */
const PERSONAL_STATE_PREFIXES: readonly string[] = [
  authContract.preferences.fullPath,
  authContract.favoriteMenus.fullPath,
];

/** 只读模式仍放行的写路径：结束模拟、退出登录 */
const READ_ONLY_ALLOWED: ReadonlySet<string> = new Set([
  impersonationContract.end.fullPath,
  authContract.logout.fullPath,
]);

export const IMPERSONATION_READ_ONLY_MESSAGE = '当前为只读模拟会话，不可执行写操作';
export const IMPERSONATION_SENSITIVE_MESSAGE = '模拟会话不可执行账号安全相关操作';
export const IMPERSONATION_PERSONAL_STATE_MESSAGE = '模拟会话不会修改被模拟用户的个人偏好';

function matchesPrefix(path: string, prefixes: readonly string[]): boolean {
  return prefixes.some((prefix) => path === prefix || path.startsWith(`${prefix}/`));
}

/**
 * 模拟会话的写请求门禁：返回拒绝文案，放行返回 null。
 * 放在 authMiddleware 里而不是 guard：大量个人中心接口只挂 authMiddleware 不挂 guard，必须在同一处收口。
 */
export function impersonationWriteDenial(method: string, path: string, claim: ImpersonationClaim): string | null {
  if (!WRITE_METHODS.has(method.toUpperCase())) return null;
  if (READ_ONLY_ALLOWED.has(path)) return null;
  if (matchesPrefix(path, SECURITY_BLOCKED_PREFIXES)) return IMPERSONATION_SENSITIVE_MESSAGE;
  if (matchesPrefix(path, PERSONAL_STATE_PREFIXES)) return IMPERSONATION_PERSONAL_STATE_MESSAGE;
  return claim.readOnly ? IMPERSONATION_READ_ONLY_MESSAGE : null;
}
