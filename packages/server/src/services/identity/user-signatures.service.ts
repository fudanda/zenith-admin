import { eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { SignatureInput, SignaturePolicy, SignatureSnapshot } from '@arcbase/shared/core';
import { SIGNATURE_MAX_IMAGE_BYTES, signatureInputSchema } from '@arcbase/shared/core';
import type { MySignature } from '@arcbase/shared/identity';
import { db } from '../../db';
import { userSignatures, users, tenants, type UserSignatureRow } from '../../db/schema';
import { currentUser, currentUserOrNull } from '../../lib/context';
import type { JwtPayload } from '../../middleware/auth';
import { exactTenantCondition, getCreateTenantId } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { readGeneratedManagedFile, saveGeneratedManagedFile } from '../files/files.service';
import { releaseManagedFiles, retainManagedFiles } from '../files/file-gc.service';
import { normalizeSignatureImage } from './signature-image';

export type UserSignatureActor = Pick<JwtPayload, 'userId' | 'tenantId' | 'impersonation'>;

/** 个人模板使用当前有效租户；平台账号切换视角时不可串用其他租户的模板。 */
export function getSignatureActor(): UserSignatureActor {
  const user = currentUser();
  return { userId: user.userId, tenantId: getCreateTenantId(user), impersonation: user.impersonation };
}

function assertSignatureIdentity(actor: UserSignatureActor) {
  if (actor.impersonation || currentUserOrNull()?.impersonation) {
    throw new HTTPException(403, { message: '模拟登录期间不能签署或管理签名' });
  }
}

function ownerWhere(actor: UserSignatureActor) {
  return buildWhere(eq(userSignatures.userId, actor.userId), exactTenantCondition(userSignatures.tenantId, actor.tenantId));
}

async function readSignatureData(row: UserSignatureRow): Promise<string> {
  const { stream } = await readGeneratedManagedFile(row.fileId, row.tenantId);
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > SIGNATURE_MAX_IMAGE_BYTES) {
        await reader.cancel();
        throw new HTTPException(400, { message: '已保存的签名图片体积异常，请重新保存签名' });
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  return 'data:image/png;base64,' + Buffer.concat(chunks, size).toString('base64');
}

function signatureView(row: UserSignatureRow, dataUrl: string): MySignature {
  return { id: row.id, version: row.version, dataUrl, updatedAt: formatDateTime(row.updatedAt) };
}

/** 审计仅加载模板元信息，不读取或输出签名图像。 */
export async function getMySignatureAuditMetadata(): Promise<Omit<MySignature, 'dataUrl'> | null> {
  const actor = getSignatureActor();
  assertSignatureIdentity(actor);
  const [row] = await db.select({ id: userSignatures.id, version: userSignatures.version, updatedAt: userSignatures.updatedAt })
    .from(userSignatures).where(ownerWhere(actor)).limit(1);
  return row ? { id: row.id, version: row.version, updatedAt: formatDateTime(row.updatedAt) } : null;
}

export async function getMySignature(): Promise<MySignature | null> {
  const actor = getSignatureActor();
  assertSignatureIdentity(actor);
  const [row] = await db.select().from(userSignatures).where(ownerWhere(actor)).limit(1);
  return row ? signatureView(row, await readSignatureData(row)) : null;
}

/** 上传在事务外完成，新文件先作为 orphan；事务原子切换引用，失败交给统一 GC。 */
export async function saveMySignature(data: { dataUrl: string }): Promise<MySignature> {
  const actor = getSignatureActor();
  assertSignatureIdentity(actor);
  const normalized = await normalizeSignatureImage(data.dataUrl);
  const file = await saveGeneratedManagedFile({
    buffer: normalized.buffer, filename: 'signature.png', mimeType: 'image/png',
    tenantId: actor.tenantId, createdBy: actor.userId, visibility: 'restricted',
  });
  const saved = await db.transaction(async (tx) => {
    // 与租户删除保持tenant→user锁顺序，防首次插入签名的FK检查和级联删除互等。
    if (actor.tenantId !== null) {
      const [tenant] = await tx.select({ id: tenants.id }).from(tenants).where(eq(tenants.id, actor.tenantId)).for('key share').limit(1);
      requireRow(tenant, '当前租户不存在');
    }
    // 按账号串行化保存/删除，连首次保存尚无签名行的情况也覆盖。
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.userId)).for('update').limit(1);
    requireRow(owner, '账号不存在');
    const [previous] = await tx.select().from(userSignatures).where(ownerWhere(actor)).limit(1);
    await retainManagedFiles(tx, [file.id]);
    const [row] = previous
      ? await tx.update(userSignatures).set({ fileId: file.id, version: previous.version + 1 }).where(ownerWhere(actor)).returning()
      : await tx.insert(userSignatures).values({ userId: actor.userId, tenantId: actor.tenantId, fileId: file.id }).returning();
    if (previous) await releaseManagedFiles(tx, [previous.fileId]);
    return requireRow(row, '保存签名失败');
  });
  return signatureView(saved, normalized.dataUrl);
}

export async function deleteMySignature(): Promise<void> {
  const actor = getSignatureActor();
  assertSignatureIdentity(actor);
  await db.transaction(async (tx) => {
    const [owner] = await tx.select({ id: users.id }).from(users).where(eq(users.id, actor.userId)).for('update').limit(1);
    requireRow(owner, '账号不存在');
    const deleted = await tx.delete(userSignatures).where(ownerWhere(actor)).returning({ fileId: userSignatures.fileId });
    await releaseManagedFiles(tx, deleted.map((row) => row.fileId));
  });
}

/** 在业务事务之前调用；模板属于本人且版本匹配才可使用，证据时间和签署人由服务器生成。 */
export async function resolveUserSignature(
  input: SignatureInput, policy: SignaturePolicy, actor: UserSignatureActor = getSignatureActor(),
): Promise<SignatureSnapshot> {
  assertSignatureIdentity(actor);
  const parsed = signatureInputSchema.safeParse(input);
  if (!parsed.success) throw new HTTPException(400, { message: '签名输入无效，请重新选择或手写签名' });
  const value = parsed.data;
  if (policy === 'handwritten' && value.source !== 'drawn') throw new HTTPException(400, { message: '此处要求本次重新手写签名' });
  let dataUrl: string;
  let signatureId: number | null = null;
  let signatureVersion: number | null = null;
  if (value.source === 'saved') {
    const [saved] = await db.select().from(userSignatures).where(buildWhere(ownerWhere(actor), eq(userSignatures.id, value.signatureId))).limit(1);
    if (!saved || saved.version !== value.version) throw new HTTPException(409, { message: '已保存的签名已更换或删除，请刷新后重新选择' });
    dataUrl = await readSignatureData(saved);
    signatureId = saved.id; signatureVersion = saved.version;
  } else {
    dataUrl = (await normalizeSignatureImage(value.dataUrl)).dataUrl;
  }
  const [signer] = await db.select({ nickname: users.nickname }).from(users).where(eq(users.id, actor.userId)).limit(1);
  requireRow(signer, '签署人不存在');
  return {
    dataUrl, source: value.source, signerId: actor.userId, signerName: signer.nickname,
    signedAt: formatDateTime(new Date()), signatureId, signatureVersion,
  };
}
