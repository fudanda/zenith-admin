import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { licenses, licenseEvents } from '../../db/schema';
import { config } from '../../config';
import logger from '../logger';
import type { LicenseFeatureKey, LicensePayload, LicenseStatus } from '@arcbase/shared/licensing';
import { verifyLicenseEnvelope } from './signature';
import { ensureInstallation, readLicenseEpoch } from './installation';

/** 进程内授权快照：所有请求路径只读它，绝不逐请求查库/验签 */
export interface LicenseSnapshot {
  /** 无任何已激活 License 时为 null */
  licenseRowId: number | null;
  /** 运行时评估出的状态（active/grace/expired/invalid/...；无 License 为 'unlicensed'） */
  status: LicenseStatus | 'unlicensed';
  features: ReadonlySet<LicenseFeatureKey>;
  payload: LicensePayload | null;
  invalidReason: string | null;
  /** required 模式下 License 不可用 → 受限模式 */
  restricted: boolean;
  licenseEpoch: number;
  loadedAt: number;
}

const SNAPSHOT_TTL_MS = 10_000;

let snapshot: LicenseSnapshot | null = null;
let loading: Promise<LicenseSnapshot> | null = null;

/** 评估签名有效的 payload 在当前时刻的状态 */
export function evaluatePayloadStatus(payload: LicensePayload, now: Date): { status: LicenseStatus; reason: string | null } {
  const nowMs = now.getTime();
  if (nowMs < Date.parse(payload.notBefore)) {
    return { status: 'invalid', reason: `License 尚未生效（notBefore=${payload.notBefore}）` };
  }
  if (nowMs <= Date.parse(payload.expiresAt)) {
    return { status: 'active', reason: null };
  }
  if (nowMs <= Date.parse(payload.graceUntil)) {
    return { status: 'grace', reason: null };
  }
  return { status: 'expired', reason: 'License 已过期且超出宽限期' };
}

async function loadSnapshot(): Promise<LicenseSnapshot> {
  const epoch = await readLicenseEpoch();
  const base: Omit<LicenseSnapshot, 'status' | 'features' | 'restricted'> = {
    licenseRowId: null,
    payload: null,
    invalidReason: null,
    licenseEpoch: epoch,
    loadedAt: Date.now(),
  };

  // 只认一条「当前」License：非 replaced/deactivated 的最新激活记录
  const [row] = await db
    .select()
    .from(licenses)
    .where(eq(licenses.status, 'active'))
    .orderBy(licenses.id)
    .limit(1);

  if (!row) {
    return {
      ...base,
      status: 'unlicensed',
      features: new Set<LicenseFeatureKey>(),
      restricted: config.licenseMode === 'required',
    };
  }

  // 每次快照重载都对原始 envelope 重新验签：数据库只是缓存介质，不是信任来源
  const verified = verifyLicenseEnvelope(row.envelope);
  if (!verified.ok) {
    return {
      ...base,
      licenseRowId: row.id,
      status: 'invalid',
      features: new Set<LicenseFeatureKey>(),
      invalidReason: verified.reason,
      restricted: config.licenseMode === 'required',
    };
  }

  const installation = await ensureInstallation();
  if (verified.payload.installationId !== installation.installationId) {
    return {
      ...base,
      licenseRowId: row.id,
      status: 'invalid',
      features: new Set<LicenseFeatureKey>(),
      invalidReason: 'License 绑定的安装 ID 与当前部署不匹配',
      restricted: config.licenseMode === 'required',
    };
  }

  const { status, reason } = evaluatePayloadStatus(verified.payload, new Date());
  const usable = status === 'active' || status === 'grace';
  return {
    ...base,
    licenseRowId: row.id,
    status,
    payload: verified.payload,
    features: new Set(verified.payload.features),
    invalidReason: reason,
    restricted: config.licenseMode === 'required' && !usable,
  };
}

/**
 * 获取授权快照（SWR + singleflight）。
 *
 * - TTL 内直接返回内存快照，零 I/O；
 * - TTL 过期后重载；并发重载合并为一次（singleflight）；
 * - 重载失败时降级沿用旧快照（数据库抖动不应放大为全站 403）。
 */
export async function getLicenseSnapshot(): Promise<LicenseSnapshot> {
  if (snapshot && Date.now() - snapshot.loadedAt < SNAPSHOT_TTL_MS) return snapshot;
  if (loading) return loading;
  loading = loadSnapshot()
    .then((next) => {
      snapshot = next;
      return next;
    })
    .catch((err) => {
      logger.error(`License 快照重载失败，沿用旧快照: ${err}`);
      if (snapshot) {
        // 刷新时间戳避免每个请求都重试打库
        snapshot = { ...snapshot, loadedAt: Date.now() };
        return snapshot;
      }
      throw err;
    })
    .finally(() => {
      loading = null;
    });
  return loading;
}

/** 立刻作废进程内快照（本节点操作后即时生效；其他节点靠 licenseEpoch 收敛） */
export function invalidateLicenseSnapshot(): void {
  snapshot = null;
}

// ─── warn 模式的功能拒绝事件（限流去重，避免事件表被打爆）────────────────────────
const deniedLoggedAt = new Map<string, number>();
const DENIED_LOG_INTERVAL_MS = 60 * 60 * 1000;

export function logFeatureDeniedThrottled(feature: LicenseFeatureKey, licenseRowId: number | null): void {
  const now = Date.now();
  const last = deniedLoggedAt.get(feature) ?? 0;
  if (now - last < DENIED_LOG_INTERVAL_MS) return;
  deniedLoggedAt.set(feature, now);
  void db
    .insert(licenseEvents)
    .values({ licenseId: licenseRowId, type: 'feature_denied', detail: `功能「${feature}」未授权（warn 模式放行并记录）` })
    .catch((err) => logger.warn(`记录 feature_denied 事件失败: ${err}`));
}
