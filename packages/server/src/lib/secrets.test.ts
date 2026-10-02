/**
 * 运行时密钥规则单测：
 * - 生成值满足 HS256 / AES-256 的长度与格式要求且每次不同；
 * - 校验拒绝历史默认值、模板占位值、内置开发密钥与低熵值；
 * - 只有 NODE_ENV=development 才回落内置开发密钥；其他环境（含未设置）缺失即报错。
 */
import { describe, it, expect } from 'vitest';
import {
  DEV_FIELD_ENCRYPTION_KEY,
  DEV_JWT_SECRET,
  JWT_SECRET_MIN_LENGTH,
  collectRuntimeSecretErrors,
  generateFieldEncryptionKey,
  generateJwtSecret,
  isInsecureSecretValue,
  resolveRuntimeSecrets,
  validateFieldEncryptionKey,
  validateJwtSecret,
} from './secrets';

describe('generate*', () => {
  it('generateJwtSecret：64 个 base64url 字符（48 字节），两次不同', () => {
    const a = generateJwtSecret();
    const b = generateJwtSecret();
    expect(a).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(a).not.toBe(b);
    expect(validateJwtSecret(a)).toBeNull();
  });

  it('generateFieldEncryptionKey：64 位小写 hex（32 字节），两次不同', () => {
    const a = generateFieldEncryptionKey();
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(a).not.toBe(generateFieldEncryptionKey());
    expect(validateFieldEncryptionKey(a)).toBeNull();
  });

  it('内置开发字段密钥本身是合法的 64 位 hex（否则开发模式无法加解密）', () => {
    expect(DEV_FIELD_ENCRYPTION_KEY).toMatch(/^[0-9a-f]{64}$/);
    expect(DEV_JWT_SECRET.length).toBeGreaterThanOrEqual(JWT_SECRET_MIN_LENGTH);
  });
});

describe('isInsecureSecretValue', () => {
  it.each([
    '',
    '   ',
    'arcbase-secret',
    'change-me-to-a-strong-random-secret',
    'CHANGE_ME_please_0123456789abcdef',
    'your-strong-secret-key',
    DEV_JWT_SECRET,
    DEV_FIELD_ENCRYPTION_KEY,
    'aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa',
    '12345678901234567890123456789012',
  ])('拒绝 %j', (value) => {
    expect(isInsecureSecretValue(value)).toBe(true);
  });

  it('接受随机生成的值', () => {
    expect(isInsecureSecretValue(generateJwtSecret())).toBe(false);
    expect(isInsecureSecretValue(generateFieldEncryptionKey())).toBe(false);
  });
});

describe('validateJwtSecret / validateFieldEncryptionKey', () => {
  it('JWT_SECRET 长度不足 → 提示最小长度', () => {
    expect(validateJwtSecret('short-but-varied-0123456789')).toMatch(/32/);
  });

  it('FIELD_ENCRYPTION_KEY 非 64 位 hex → 提示格式', () => {
    expect(validateFieldEncryptionKey(generateJwtSecret())).toMatch(/64 位十六进制/);
    expect(validateFieldEncryptionKey('0123456789abcdef'.repeat(3))).toMatch(/64 位十六进制/);
  });

  it('缺失 → 提示未配置', () => {
    expect(validateJwtSecret('')).toMatch(/未配置/);
    expect(validateFieldEncryptionKey('')).toMatch(/未配置/);
  });
});

describe('resolveRuntimeSecrets / collectRuntimeSecretErrors', () => {
  const jwt = generateJwtSecret();
  const field = generateFieldEncryptionKey();

  it('development：缺省项回落内置开发密钥并记录，显式配置的照用', () => {
    const r = resolveRuntimeSecrets({ nodeEnv: 'development', jwtSecret: undefined, fieldEncryptionKey: '' });
    expect(r).toEqual({ jwtSecret: DEV_JWT_SECRET, fieldEncryptionKey: DEV_FIELD_ENCRYPTION_KEY, devDefaults: ['JWT_SECRET', 'FIELD_ENCRYPTION_KEY'] });

    const partial = resolveRuntimeSecrets({ nodeEnv: 'development', jwtSecret: ` ${jwt} `, fieldEncryptionKey: undefined });
    expect(partial).toEqual({ jwtSecret: jwt, fieldEncryptionKey: DEV_FIELD_ENCRYPTION_KEY, devDefaults: ['FIELD_ENCRYPTION_KEY'] });
    expect(collectRuntimeSecretErrors({ nodeEnv: 'development', jwtSecret: undefined, fieldEncryptionKey: undefined })).toEqual([]);
  });

  it.each(['production', 'test', 'staging', undefined, ''])('非 development（NODE_ENV=%j）：不回落，缺失即报错', (nodeEnv) => {
    const r = resolveRuntimeSecrets({ nodeEnv, jwtSecret: undefined, fieldEncryptionKey: undefined });
    expect(r).toEqual({ jwtSecret: '', fieldEncryptionKey: '', devDefaults: [] });
    const errors = collectRuntimeSecretErrors({ nodeEnv, jwtSecret: undefined, fieldEncryptionKey: undefined });
    expect(errors).toHaveLength(2);
    expect(errors[0]).toMatch(/JWT_SECRET/);
    expect(errors[1]).toMatch(/FIELD_ENCRYPTION_KEY/);
  });

  it('production：把内置开发密钥 / 历史默认值当真实密钥 → 报错', () => {
    expect(collectRuntimeSecretErrors({ nodeEnv: 'production', jwtSecret: DEV_JWT_SECRET, fieldEncryptionKey: DEV_FIELD_ENCRYPTION_KEY })).toHaveLength(2);
    expect(collectRuntimeSecretErrors({ nodeEnv: 'production', jwtSecret: 'arcbase-secret', fieldEncryptionKey: field })).toEqual([
      expect.stringMatching(/JWT_SECRET/),
    ]);
  });

  it('production：合规值通过', () => {
    expect(collectRuntimeSecretErrors({ nodeEnv: 'production', jwtSecret: jwt, fieldEncryptionKey: field })).toEqual([]);
    expect(resolveRuntimeSecrets({ nodeEnv: 'production', jwtSecret: jwt, fieldEncryptionKey: field })).toEqual({ jwtSecret: jwt, fieldEncryptionKey: field, devDefaults: [] });
  });
});
