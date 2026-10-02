import { signatureInputSchema, type SignatureInput, type SignaturePolicy, type SignatureSnapshot } from '@arcbase/shared/core';
import type { MySignature } from '@arcbase/shared/identity';
import { currentMockSession } from './auth';
import { MockHttpError } from './contract';
import { badRequest, conflict, forbidden, unauthorized } from './handlers';
import { mockDateTime } from './date';

const signatures = new Map<string, MySignature>();
let nextSignatureId = 1;

function owner(request: Request) {
  const session = currentMockSession(request);
  if (!session) throw new MockHttpError(unauthorized('请先登录', { status: 401 }));
  if (session.impersonation) throw new MockHttpError(forbidden('模拟登录期间不能使用或管理个人签名', { status: 403 }));
  const tenantId = session.viewingTenantId !== undefined ? session.viewingTenantId : session.user.tenantId ?? null;
  return { key: `${session.user.id}:${tenantId ?? 'platform'}`, user: session.user };
}

export function getMockMySignature(request: Request): MySignature | null {
  const signature = signatures.get(owner(request).key);
  return signature ? { ...signature } : null;
}

export function saveMockMySignature(request: Request, dataUrl: string): MySignature {
  const { key } = owner(request);
  const previous = signatures.get(key);
  const saved = { id: previous?.id ?? nextSignatureId++, version: (previous?.version ?? 0) + 1, dataUrl, updatedAt: mockDateTime() };
  signatures.set(key, saved);
  return { ...saved };
}

export function deleteMockMySignature(request: Request): void {
  signatures.delete(owner(request).key);
}

/** Demo 与真实服务使用同一输入协议及本人/租户/版本策略，元信息由 handler 生成。 */
export function resolveMockUserSignature(request: Request, input: SignatureInput, policy: SignaturePolicy): SignatureSnapshot {
  const { user } = owner(request);
  const parsed = signatureInputSchema.safeParse(input);
  if (!parsed.success) throw new MockHttpError(badRequest('签名输入无效', { status: 400 }));
  let dataUrl: string;
  let signatureId: number | null = null;
  let signatureVersion: number | null = null;
  if (parsed.data.source === 'saved') {
    if (policy === 'handwritten') throw new MockHttpError(badRequest('此处要求本次重新手写签名', { status: 400 }));
    const saved = getMockMySignature(request);
    if (!saved || saved.id !== parsed.data.signatureId || saved.version !== parsed.data.version) {
      throw new MockHttpError(conflict('个人签名已变更或不可用，请重新选择', { status: 409 }));
    }
    dataUrl = saved.dataUrl;
    signatureId = saved.id;
    signatureVersion = saved.version;
  } else dataUrl = parsed.data.dataUrl;
  return { dataUrl, source: parsed.data.source, signerId: user.id, signerName: user.nickname || user.username, signedAt: mockDateTime(), signatureId, signatureVersion };
}
