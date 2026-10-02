import { verify as edVerify } from 'node:crypto';
import {
  LICENSE_ALGORITHM,
  LICENSE_AUDIENCE,
  LICENSE_ENVELOPE_VERSION,
  licenseEnvelopeSchema,
  licensePayloadSchema,
  type LicenseEnvelope,
  type LicensePayload,
} from '@arcbase/shared/licensing';
import { resolveIssuerPublicKey } from './keys';

export type VerifyResult =
  | { ok: true; payload: LicensePayload; envelope: LicenseEnvelope }
  | { ok: false; reason: string };

function decodeBase64Url(value: string): Buffer | null {
  try {
    return Buffer.from(value, 'base64url');
  } catch {
    return null;
  }
}

/**
 * 验证 .zenlic 文件。
 *
 * 顺序是安全关键：**先对 payload 原始字节验签**，通过后才解析 JSON 并做
 * 结构校验——绝不重新序列化后验签（JSON 键序不稳定会导致签名失配），
 * 也绝不在验签前信任 payload 内容。
 */
export function verifyLicenseEnvelope(raw: string): VerifyResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, reason: 'License 文件不是有效的 JSON' };
  }

  const envelopeResult = licenseEnvelopeSchema.safeParse(parsed);
  if (!envelopeResult.success) {
    return { ok: false, reason: 'License 文件结构无效' };
  }
  const envelope = envelopeResult.data;

  if (envelope.version !== LICENSE_ENVELOPE_VERSION) {
    return { ok: false, reason: `不支持的 License 版本（v${envelope.version}）` };
  }
  if (envelope.algorithm !== LICENSE_ALGORITHM) {
    return { ok: false, reason: `不支持的签名算法（${envelope.algorithm}）` };
  }

  const publicKey = resolveIssuerPublicKey(envelope.keyId);
  if (!publicKey) {
    return { ok: false, reason: `无法识别的签发密钥（keyId=${envelope.keyId}），请检查 LICENSE_ISSUER_PUBLIC_KEY 配置` };
  }

  const payloadBytes = decodeBase64Url(envelope.payload);
  const signatureBytes = decodeBase64Url(envelope.signature);
  if (!payloadBytes || !signatureBytes) {
    return { ok: false, reason: 'License 编码无效' };
  }

  let signatureValid: boolean;
  try {
    signatureValid = edVerify(null, payloadBytes, publicKey, signatureBytes);
  } catch {
    signatureValid = false;
  }
  if (!signatureValid) {
    return { ok: false, reason: '签名校验失败：文件被篡改或签发密钥不匹配' };
  }

  let payloadJson: unknown;
  try {
    payloadJson = JSON.parse(payloadBytes.toString('utf8'));
  } catch {
    return { ok: false, reason: 'License 载荷不是有效的 JSON' };
  }
  const payloadResult = licensePayloadSchema.safeParse(payloadJson);
  if (!payloadResult.success) {
    return { ok: false, reason: `License 载荷结构无效：${payloadResult.error.issues[0]?.message ?? ''}` };
  }
  const payload = payloadResult.data;

  if (payload.audience !== LICENSE_AUDIENCE) {
    return { ok: false, reason: `License 不适用于本产品（audience=${payload.audience}）` };
  }

  return { ok: true, payload, envelope };
}
