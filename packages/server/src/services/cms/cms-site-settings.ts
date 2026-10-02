import { CMS_SECRET_MASK, CMS_SITE_OPS_DEFAULTS } from '@arcbase/shared/cms';
import type { CmsSiteOpsSettings } from '@arcbase/shared/cms';

export { CMS_SECRET_MASK };

const SENSITIVE_SETTING_KEY = /(?:secret|token|password|private[_-]?key|api[_-]?key|access[_-]?key|indexnow[_-]?key|credential)/i;

export function isSensitiveCmsSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEY.test(key);
}

/**
 * 整体替换而非深合并的 settings 键。
 *
 * `defaultTemplates` 在后台是「完整状态对象」——表单每次提交都携带全量值，清空某一项就是把它
 * 从对象里去掉。走默认的深合并会让被清空的项保留旧值（表现为模板下拉清了也不生效），
 * 因此该键整体替换。
 */
const REPLACE_SETTING_KEYS = new Set(['defaultTemplates']);

function cloneRecord(value: Record<string, unknown>): Record<string, unknown> {
  return structuredClone(value);
}

function redactValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(redactValue);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    out[key] = isSensitiveCmsSettingKey(key)
      ? CMS_SECRET_MASK
      : redactValue(nested);
  }
  return out;
}

/** API/export boundary: secrets are represented only by a non-reversible sentinel. */
export function redactCmsSiteSettings(
  settings: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return redactValue(settings ?? {}) as Record<string, unknown>;
}

function mergeValue(existing: unknown, incoming: unknown, key: string): unknown {
  if (isSensitiveCmsSettingKey(key)) {
    if (incoming === undefined || incoming === '' || incoming === CMS_SECRET_MASK) return existing;
    if (incoming === null) return undefined;
    return incoming;
  }
  if (incoming && typeof incoming === 'object' && !Array.isArray(incoming)) {
    if (REPLACE_SETTING_KEYS.has(key)) return incoming;
    const existingRecord = existing && typeof existing === 'object' && !Array.isArray(existing)
      ? existing as Record<string, unknown>
      : {};
    return mergeCmsSiteSettings(
      existingRecord,
      incoming as Record<string, unknown>,
    );
  }
  return incoming;
}

/**
 * Write-only settings merge.
 * Sensitive empty/sentinel values retain the stored value; explicit null clears it.
 */
export function mergeCmsSiteSettings(
  existing: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  const out = cloneRecord(existing ?? {});
  if (!incoming) return out;
  for (const [key, value] of Object.entries(incoming)) {
    const next = mergeValue(out[key], value, key);
    if (next === undefined) delete out[key];
    else out[key] = next;
  }
  return out;
}

/** Creation/import boundary: sentinel and blank secret placeholders never become stored secrets. */
export function normalizeNewCmsSiteSettings(
  incoming: Record<string, unknown> | null | undefined,
): Record<string, unknown> {
  return mergeCmsSiteSettings({}, incoming);
}

// ─── 站点内容策略（settings 的受控子集，缺省回落 CMS_SITE_OPS_DEFAULTS）──────────

function boolSetting(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function intSetting(value: unknown, fallback: number, max: number): number {
  const num = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(num)) return fallback;
  return Math.min(Math.max(Math.trunc(num), 0), max);
}

/**
 * 解析站点内容策略开关。settings 缺项时回落到 CMS_SITE_OPS_DEFAULTS，
 * 因此新站点与历史站点无需数据迁移即可获得一致行为。
 */
export function resolveCmsSiteOpsSettings(
  settings: Record<string, unknown> | null | undefined,
): CmsSiteOpsSettings {
  const s = settings ?? {};
  return {
    publishedContentEditable: boolSetting(s.publishedContentEditable, CMS_SITE_OPS_DEFAULTS.publishedContentEditable),
    recycleKeepDays: intSetting(s.recycleKeepDays, CMS_SITE_OPS_DEFAULTS.recycleKeepDays, 3650),
    maxPageOnContentPublish: intSetting(s.maxPageOnContentPublish, CMS_SITE_OPS_DEFAULTS.maxPageOnContentPublish, 1000),
    autoReplaceSensitiveWords: boolSetting(s.autoReplaceSensitiveWords, CMS_SITE_OPS_DEFAULTS.autoReplaceSensitiveWords),
    autoReplaceErrorProneWords: boolSetting(s.autoReplaceErrorProneWords, CMS_SITE_OPS_DEFAULTS.autoReplaceErrorProneWords),
    autoCoverFromBody: boolSetting(s.autoCoverFromBody, CMS_SITE_OPS_DEFAULTS.autoCoverFromBody),
    openApiPublishEnabled: boolSetting(s.openApiPublishEnabled, CMS_SITE_OPS_DEFAULTS.openApiPublishEnabled),
  };
}
