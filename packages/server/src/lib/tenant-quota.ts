import { eq, sql } from 'drizzle-orm';
import { db } from '../db';
import { tenants, tenantPackages, users, licenseEvents } from '../db/schema';
import type { DbExecutor } from '../db/types';
import { config } from '../config';
import { HTTPException } from 'hono/http-exception';
import { getLicenseSnapshot } from './licensing';
import logger from './logger';

/**
 * 返回租户的「最大用户数」有效上限（租户 maxUsers 与套餐 quotas.maxUsers 取最小值）。
 * 返回 `null` 表示**不限制**：
 *  - 多租户模式关闭
 *  - `tenantId` 为空（平台级用户）
 *  - 租户与其套餐都未设置上限
 */
export async function getTenantUserLimit(tenantId: number | null | undefined): Promise<number | null> {
  if (!config.multiTenantMode || tenantId == null) return null;
  const [tenant] = await db
    .select({ maxUsers: tenants.maxUsers, packageId: tenants.packageId })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant) return null;

  let packageLimit: number | null = null;
  if (tenant.packageId != null) {
    const [pkg] = await db
      .select({ quotas: tenantPackages.quotas })
      .from(tenantPackages)
      .where(eq(tenantPackages.id, tenant.packageId))
      .limit(1);
    packageLimit = pkg?.quotas?.maxUsers ?? null;
  }

  const limits = [tenant.maxUsers, packageLimit].filter((v): v is number => v != null);
  return limits.length > 0 ? Math.min(...limits) : null;
}

// warn 模式席位超限事件限流（每小时最多记一条）
let seatWarnLoggedAt = 0;
const SEAT_WARN_INTERVAL_MS = 60 * 60 * 1000;

/**
 * 在**创建用户的同一事务内**原子预留席位。
 *
 * 必须传入事务执行器：内部先取事务级 advisory lock 串行化全部建号路径
 * （管理端创建 / 批量导入 / 自助注册 / SSO JIT / SCIM / 目录同步 / 租户初始管理员），
 * 再 count 校验，锁到事务提交才释放——彻底消灭 check-then-insert 竞态。
 *
 * 校验两层（都是「祖父条款」语义：已有存量永不回收，只挡新增）：
 *  1. 部署级 License 席位（payload.limits.maxUsers）：
 *     required 模式超限即拒绝；warn 模式放行但限流记录 limit_warning 事件；off 跳过
 *  2. 租户级席位：租户 maxUsers 与套餐 quotas.maxUsers 取最小值（仅多租户模式）
 */
export async function reserveTenantSeats(tx: DbExecutor, tenantId: number | null | undefined, adding = 1): Promise<void> {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('arcbase:user_seats'))`);

  // ── 1. 部署级 License 席位 ──
  if (config.licenseMode !== 'off') {
    const snapshot = await getLicenseSnapshot();
    const licenseLimit = snapshot.payload?.limits.maxUsers ?? null;
    if (licenseLimit != null) {
      const totalRows = await tx.select({ count: sql<number>`count(*)::int` }).from(users);
      const total = totalRows[0]?.count ?? 0;
      if (total + adding > licenseLimit) {
        if (config.licenseMode === 'required') {
          throw new HTTPException(400, {
            message: `已达 License 席位上限（${licenseLimit}），无法新增用户，请联系供应商扩容`,
          });
        }
        // warn：放行但记录
        const now = Date.now();
        if (now - seatWarnLoggedAt >= SEAT_WARN_INTERVAL_MS) {
          seatWarnLoggedAt = now;
          void db
            .insert(licenseEvents)
            .values({
              licenseId: snapshot.licenseRowId,
              type: 'limit_warning',
              detail: `用户数（${total + adding}）超出 License 席位上限（${licenseLimit}），warn 模式放行`,
            })
            .catch((err) => logger.warn(`记录席位超限事件失败: ${err}`));
        }
      }
    }
  }

  // ── 2. 租户级席位 ──
  if (!config.multiTenantMode || tenantId == null) return;
  const limit = await getTenantUserLimit(tenantId);
  if (limit == null) return;
  const rows = await tx.select({ count: sql<number>`count(*)::int` }).from(users).where(eq(users.tenantId, tenantId));
  const count = rows[0]?.count ?? 0;
  if (count + adding > limit) {
    throw new HTTPException(400, { message: `该租户用户数已达上限（${limit}），无法新增` });
  }
}
