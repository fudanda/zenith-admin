/**
 * License 验签单测。
 *
 * 锁定安全关键行为：
 * 1. 用测试私钥签发的 envelope 能通过内置测试公钥验证；
 * 2. payload 字节被篡改（哪怕语义等价的 JSON 重排）即验签失败；
 * 3. audience 不匹配拒绝；不支持的算法/版本拒绝。
 */
import { describe, it, expect, vi } from 'vitest';
import { createPrivateKey, sign as edSign } from 'node:crypto';

vi.mock('../../config', () => ({
  config: { licenseIssuerPublicKey: '', licenseMode: 'off' },
}));

import { verifyLicenseEnvelope } from './signature';
import { TEST_KEY_ID } from './keys';
import { LICENSE_ALGORITHM, LICENSE_AUDIENCE, LICENSE_ENVELOPE_VERSION } from '@arcbase/shared/licensing';

/** 与 keys.ts TEST_PUBLIC_KEY_BASE64 配对的公开测试私钥（scripts/license-issue.ts 同源） */
const TEST_PRIVATE_KEY_BASE64 = 'MC4CAQAwBQYDK2VwBCIEIGyZp5WDE++d2SWo6Ns/202nKFvDAhjDQiRAzHItJW0L';

const now = new Date('2026-01-01T00:00:00Z');
const basePayload = {
  licenseId: 'lic_test123',
  audience: LICENSE_AUDIENCE,
  installationId: '2b4a94c4-98b6-4b81-a611-6e4a4bbd4a2f',
  customerId: 'cus_1',
  customerName: '测试客户',
  edition: 'pro',
  features: ['workflow', 'wiki'],
  limits: { maxUsers: 100, maxTenants: null, maxNodes: null },
  issuedAt: now.toISOString(),
  notBefore: now.toISOString(),
  expiresAt: new Date(now.getTime() + 365 * 86_400_000).toISOString(),
  graceUntil: new Date(now.getTime() + 395 * 86_400_000).toISOString(),
  maintenanceUntil: null,
};

function signEnvelope(payload: object, opts?: { keyId?: string; algorithm?: string; version?: number; mutatePayloadBytes?: (b: Buffer) => Buffer }): string {
  const privateKey = createPrivateKey({ key: Buffer.from(TEST_PRIVATE_KEY_BASE64, 'base64'), format: 'der', type: 'pkcs8' });
  let payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
  const signature = edSign(null, payloadBytes, privateKey);
  if (opts?.mutatePayloadBytes) payloadBytes = opts.mutatePayloadBytes(payloadBytes);
  return JSON.stringify({
    version: opts?.version ?? LICENSE_ENVELOPE_VERSION,
    algorithm: opts?.algorithm ?? LICENSE_ALGORITHM,
    keyId: opts?.keyId ?? TEST_KEY_ID,
    payload: payloadBytes.toString('base64url'),
    signature: signature.toString('base64url'),
  });
}

describe('verifyLicenseEnvelope', () => {
  it('测试私钥签发的 envelope 通过验证并返回解析后的 payload', () => {
    const result = verifyLicenseEnvelope(signEnvelope(basePayload));
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.payload.licenseId).toBe('lic_test123');
      expect(result.payload.features).toEqual(['workflow', 'wiki']);
    }
  });

  it('payload 字节被篡改（键序重排）即验签失败', () => {
    const raw = signEnvelope(basePayload, {
      mutatePayloadBytes: (bytes) => {
        // 语义等价但字节不同：重新序列化打乱键序
        const obj = JSON.parse(bytes.toString('utf8')) as Record<string, unknown>;
        const reordered = Object.fromEntries(Object.entries(obj).reverse());
        return Buffer.from(JSON.stringify(reordered), 'utf8');
      },
    });
    const result = verifyLicenseEnvelope(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('签名校验失败');
  });

  it('提升 features 权限的篡改被拒绝', () => {
    const raw = signEnvelope(basePayload, {
      mutatePayloadBytes: (bytes) => {
        const obj = JSON.parse(bytes.toString('utf8')) as { features: string[] };
        obj.features.push('payment');
        return Buffer.from(JSON.stringify(obj), 'utf8');
      },
    });
    expect(verifyLicenseEnvelope(raw).ok).toBe(false);
  });

  it('audience 不匹配拒绝', () => {
    const result = verifyLicenseEnvelope(signEnvelope({ ...basePayload, audience: 'other-product' }));
    expect(result.ok).toBe(false);
    // audience 由 payload schema 的 literal 约束拦截（signature.ts 里的显式检查是纵深防御）
    if (!result.ok) expect(result.reason).toMatch(/载荷结构无效|不适用于本产品/);
  });

  it('不支持的签名算法拒绝', () => {
    const result = verifyLicenseEnvelope(signEnvelope(basePayload, { algorithm: 'RS256' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('不支持的签名算法');
  });

  it('未知 keyId 拒绝（未配置 LICENSE_ISSUER_PUBLIC_KEY 时只信任测试密钥）', () => {
    const result = verifyLicenseEnvelope(signEnvelope(basePayload, { keyId: 'prod-2027' }));
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toContain('无法识别的签发密钥');
  });

  it('非 JSON 输入友好失败', () => {
    expect(verifyLicenseEnvelope('not-json').ok).toBe(false);
  });
});
