import type { AnalyticsPublicConfig } from '@arcbase/shared/analytics';
import { getSettings as getRuntimeSettings } from '../../lib/settings';
import { currentUserOrNull } from '../../lib/context';
import { currentMemberOrNull } from '../../lib/member-context';
import { broadcast } from '../../lib/ws-manager';
import { getCreateTenantId } from '../../lib/tenant';
import { resolveSiteByKey } from './analytics-sites.service';

const DEFAULT_PUBLIC_CONFIG: AnalyticsPublicConfig = {
  enabled: true,
  sampleRate: 1,
  trackPageviews: true,
  trackClicks: true,
  trackPerformance: true,
  trackErrors: true,
  trackApi: true,
  maskInputs: true,
  respectDnt: false,
  blacklistPaths: [],
  sessionTimeoutMinutes: 30,
  trackReplay: false,
  replaySessionSampleRate: 0,
  replayOnError: true,
  replayMaskAllText: false,
  replayBlockSelector: '',
};

async function analyticsSettingsForTenant(tenantId: number | null) {
  return getRuntimeSettings('analytics', { tenantId });
}

/** 服务端采集行为配置（匿名化等，不下发 SDK）。 */
export async function getIngestPolicy(tenantId: number | null): Promise<{ anonymizeIp: boolean }> {
  const settings = await analyticsSettingsForTenant(tenantId);
  return { anonymizeIp: settings.anonymizeIp };
}

// ─── 错误忽略规则（正则缓存，60s TTL；system_settings 变更由缓存失效总线处理）───
const IGNORE_CACHE_TTL_MS = 60_000;
const ignorePatternCache = new Map<number, { at: number; regexps: RegExp[] }>();

function compileIgnorePatterns(patterns: string[]): RegExp[] {
  const out: RegExp[] = [];
  for (const pattern of patterns) {
    try { out.push(new RegExp(pattern, 'i')); } catch { /* 非法正则跳过，不拖垮整组规则 */ }
  }
  return out;
}

/** 判断错误 message 是否命中租户配置的忽略规则（命中即丢弃上报）。 */
export async function isErrorIgnored(tenantId: number | null, message: string): Promise<boolean> {
  const cacheKey = tenantId ?? 0;
  const cached = ignorePatternCache.get(cacheKey);
  let regexps: RegExp[];
  if (cached && Date.now() - cached.at < IGNORE_CACHE_TTL_MS) {
    regexps = cached.regexps;
  } else {
    const settings = await analyticsSettingsForTenant(tenantId);
    regexps = compileIgnorePatterns(settings.errorIgnorePatterns);
    ignorePatternCache.set(cacheKey, { at: Date.now(), regexps });
  }
  return regexps.some((regex) => regex.test(message));
}

/** SDK 公开配置（无需鉴权，匿名亦可获取）。 */
export async function getPublicConfig(siteKey?: string | null): Promise<AnalyticsPublicConfig> {
  const user = currentUserOrNull();
  const member = user ? undefined : currentMemberOrNull();
  const site = (!user && !member) ? await resolveSiteByKey(siteKey).catch(() => null) : null;
  const tenantId = user ? getCreateTenantId(user) : member ? (member.tenantId ?? null) : (site?.tenantId ?? null);
  const settings = await analyticsSettingsForTenant(tenantId);
  return {
    enabled: settings.enabled,
    sampleRate: settings.sampleRate,
    trackPageviews: settings.trackPageviews,
    trackClicks: settings.trackClicks,
    trackPerformance: settings.trackPerformance,
    trackErrors: settings.trackErrors,
    trackApi: settings.trackApi,
    maskInputs: settings.maskInputs,
    respectDnt: settings.respectDnt,
    blacklistPaths: settings.blacklistPaths,
    sessionTimeoutMinutes: settings.sessionTimeoutMinutes,
    trackReplay: settings.trackReplay,
    replaySessionSampleRate: settings.replaySessionSampleRate,
    replayOnError: settings.replayOnError,
    replayMaskAllText: settings.replayMaskAllText,
    replayBlockSelector: settings.replayBlockSelector,
    ...(site ? { siteId: site.id, appId: site.appId } : {}),
  };
}

/** 设置更新由系统设置路由负责；保留广播兼容运行时订阅方。 */
export function broadcastAnalyticsSettingsUpdated(tenantId: number | null) {
  try { broadcast({ type: 'analytics:config-updated', payload: { tenantId } }); } catch { /* ignore */ }
}

export { DEFAULT_PUBLIC_CONFIG };
