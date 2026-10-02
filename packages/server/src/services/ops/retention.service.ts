/**
 * 数据保留策略：后台读写与手动执行。
 *
 * 策略清单由 `lib/retention/policies.ts` 以代码声明为准，本服务只负责
 * 运行期配置的读写与手动触发，不承载删除逻辑本身。
 */
import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { RetentionPolicy, RetentionPreview, UpdateRetentionPolicyInput } from '@arcbase/shared/ops';
import { db } from '../../db';
import { retentionPolicies } from '../../db/schema';
import { findPolicy, listRetentionPolicies, previewPolicy, runPolicy } from '../../lib/retention';

function ensurePolicy(key: string) {
  const policy = findPolicy(key);
  if (!policy) throw new HTTPException(404, { message: '保留策略不存在' });
  return policy;
}

export async function listPolicies(): Promise<RetentionPolicy[]> {
  return listRetentionPolicies();
}

export async function updatePolicy(key: string, input: UpdateRetentionPolicyInput): Promise<RetentionPolicy> {
  ensurePolicy(key);
  await db.update(retentionPolicies).set({
    ...(input.enabled === undefined ? {} : { enabled: input.enabled }),
    ...(input.retentionDays === undefined ? {} : { retentionDays: input.retentionDays }),
    ...(input.batchSize === undefined ? {} : { batchSize: input.batchSize }),
  }).where(eq(retentionPolicies.policyKey, key));
  const list = await listRetentionPolicies();
  return list.find((item) => item.key === key)!;
}

export async function previewPolicyPending(key: string): Promise<RetentionPreview> {
  ensurePolicy(key);
  return previewPolicy(key);
}

export async function runPolicyNow(key: string): Promise<number> {
  ensurePolicy(key);
  return runPolicy(key);
}
