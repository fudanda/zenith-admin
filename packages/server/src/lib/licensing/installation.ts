import { sql } from 'drizzle-orm';
import { randomUUID } from 'node:crypto';
import { db } from '../../db';
import { systemInstallations } from '../../db/schema';
import type { DbExecutor } from '../../db/types';

let cachedInstallation: { installationId: string; createdAt: Date } | null = null;

/**
 * 获取（首次调用时创建）部署安装身份。
 *
 * installationId 是 License 的绑定目标，全生命周期不变；seed 绝不清理本表。
 * 通过 pg 事务级 advisory lock 保证多节点并发首启时只产生一行。
 */
export async function ensureInstallation(): Promise<{ installationId: string; createdAt: Date }> {
  if (cachedInstallation) return cachedInstallation;

  const existing = await db.select().from(systemInstallations).orderBy(systemInstallations.id).limit(1);
  if (existing.length > 0) {
    cachedInstallation = { installationId: existing[0].installationId, createdAt: existing[0].createdAt };
    return cachedInstallation;
  }

  const created = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext('arcbase:system_installation'))`);
    const rows = await tx.select().from(systemInstallations).orderBy(systemInstallations.id).limit(1);
    if (rows.length > 0) return rows[0];
    const [inserted] = await tx
      .insert(systemInstallations)
      .values({ installationId: randomUUID() })
      .returning();
    return inserted;
  });
  cachedInstallation = { installationId: created.installationId, createdAt: created.createdAt };
  return cachedInstallation;
}

/** 读取当前 licenseEpoch（跨节点失效版本号）；无安装行时视为 0 */
export async function readLicenseEpoch(): Promise<number> {
  const rows = await db
    .select({ licenseEpoch: systemInstallations.licenseEpoch })
    .from(systemInstallations)
    .orderBy(systemInstallations.id)
    .limit(1);
  return rows[0]?.licenseEpoch ?? 0;
}

/**
 * 递增 licenseEpoch：激活/停用/替换 License 后调用，
 * 各节点快照在下一次 TTL 检查时发现 epoch 变化即强制重载。
 */
export async function bumpLicenseEpoch(executor: DbExecutor = db): Promise<void> {
  await executor
    .update(systemInstallations)
    .set({ licenseEpoch: sql`${systemInstallations.licenseEpoch} + 1` });
}
