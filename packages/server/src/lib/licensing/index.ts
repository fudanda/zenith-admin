import { HTTPException } from 'hono/http-exception';
import type { MiddlewareHandler } from 'hono';
import { isLicenseFeatureKey, LICENSE_FEATURE_LABELS, type LicenseFeatureKey, type LicenseMode } from '@arcbase/shared/licensing';
import { config } from '../../config';
import { getLicenseSnapshot, logFeatureDeniedThrottled } from './snapshot';

export { verifyLicenseEnvelope } from './signature';
export { ensureInstallation, readLicenseEpoch, bumpLicenseEpoch } from './installation';
export {
  getLicenseSnapshot,
  invalidateLicenseSnapshot,
  evaluatePayloadStatus,
  type LicenseSnapshot,
} from './snapshot';
export { usingTestIssuerKey, TEST_KEY_ID } from './keys';

/**
 * License 功能门控。
 *
 * - `off` 模式（默认）：不做任何检查，全部功能可用——开发 / 演示 / CI 零感知。
 * - `warn` 模式：全放行；未授权功能限流记录 license_events 供状态页展示。
 * - `required` 模式：只放行已授权功能；License 失效进入受限模式（全部可授权功能关闭）。
 *
 * 该模块必须保持惰性：不在 import 时读库，不产生进程级副作用（createApp() 无副作用约束）。
 */
export function licenseMode(): LicenseMode {
  return config.licenseMode;
}

/** 判断某个可授权功能当前是否可用（部署级 License 维度，与租户套餐无关）。 */
export async function isFeatureEnabled(feature: LicenseFeatureKey): Promise<boolean> {
  if (config.licenseMode === 'off') return true;
  if (!isLicenseFeatureKey(feature)) return false;

  const snapshot = await getLicenseSnapshot();
  const licensed = snapshot.features.has(feature);

  if (config.licenseMode === 'warn') {
    if (!licensed) logFeatureDeniedThrottled(feature, snapshot.licenseRowId);
    return true;
  }
  // required
  return licensed && !snapshot.restricted;
}

/** 功能不可用时抛 403（消息带功能中文名，前端 toast 可直接展示）。 */
export async function assertFeatureEnabled(feature: LicenseFeatureKey): Promise<void> {
  if (await isFeatureEnabled(feature)) return;
  const label = LICENSE_FEATURE_LABELS[feature] ?? feature;
  throw new HTTPException(403, {
    message: `当前部署授权不包含「${label}」功能，请联系管理员升级 License`,
  });
}

/** 域挂载级功能门控中间件：off 模式零开销直通。 */
export function licenseFeatureGate(feature: LicenseFeatureKey): MiddlewareHandler {
  return async (_c, next) => {
    if (config.licenseMode !== 'off') {
      await assertFeatureEnabled(feature);
    }
    await next();
  };
}
