/**
 * 运行时密钥（JWT_SECRET / FIELD_ENCRYPTION_KEY）的生成、校验与开发模式回退。
 *
 * 只含纯函数与常量，不 import config —— config.ts 在装配阶段依赖本模块。
 *
 * 两把密钥的归属不同：
 * - `JWT_SECRET` 属于**运行中的服务实例**：token 只会被签发它的那台服务校验；
 * - `FIELD_ENCRYPTION_KEY` 属于**数据库**：库里的密文用它加密，连同一个库的所有实例必须用同一把。
 *
 * 开发模式（`NODE_ENV=development`，`npm run dev` 自动设置）下未配置的密钥回落到内置开发密钥，
 * 因而连接同一开发库的同事无需交换密钥；其他任何环境（含未设置 NODE_ENV）都必须显式配置合规值，
 * 由服务启动时的 `assertRuntimeSecrets()` fail-fast。
 */
import { randomBytes } from 'node:crypto';

export const JWT_SECRET_MIN_LENGTH = 32;

/** 内置开发 JWT 密钥：仅 NODE_ENV=development 且未显式配置时使用 */
export const DEV_JWT_SECRET = 'arcbase-dev-only-jwt-secret-do-not-use-in-production';

/** 内置开发字段加密密钥（64 位 hex = 32 字节）：仅 NODE_ENV=development 且未显式配置时使用 */
export const DEV_FIELD_ENCRYPTION_KEY = Buffer.from('arcbase-dev-only-field-key-00000!', 'utf8').toString('hex');

/** 历史默认值、模板占位值与内置开发密钥：任何非开发环境都不接受为真实密钥 */
const INSECURE_SECRET_VALUES: ReadonlySet<string> = new Set([
  'arcbase-secret',
  'change-me-to-a-strong-random-secret',
  'your-strong-secret-key',
  'your-secret-key',
  DEV_JWT_SECRET,
  DEV_FIELD_ENCRYPTION_KEY,
]);

const PLACEHOLDER_PREFIX = /^(change[-_]?me|replace[-_]?me|your[-_]|example|placeholder)/i;

/**
 * 最少不同字符数：拦住 `aaaa…`、纯数字串这类肉眼可见的低熵值。
 * 随机 hex 通常 16 种、base64url 40+ 种字符，远高于此；纯数字最多 10 种，按不合规处理。
 */
const MIN_DISTINCT_CHARS = 12;

export function isInsecureSecretValue(value: string): boolean {
  const v = value.trim();
  if (!v) return true;
  if (INSECURE_SECRET_VALUES.has(v)) return true;
  if (PLACEHOLDER_PREFIX.test(v)) return true;
  return new Set(v).size < MIN_DISTINCT_CHARS;
}

export function validateJwtSecret(value: string): string | null {
  const v = value.trim();
  if (!v) return 'JWT_SECRET 未配置';
  if (v.length < JWT_SECRET_MIN_LENGTH) return `JWT_SECRET 至少需要 ${JWT_SECRET_MIN_LENGTH} 个字符（HS256 要求 ≥ 256 bit 密钥）`;
  if (isInsecureSecretValue(v)) return 'JWT_SECRET 使用了默认值 / 占位值或随机性不足';
  return null;
}

export function validateFieldEncryptionKey(value: string): string | null {
  const v = value.trim();
  if (!v) return 'FIELD_ENCRYPTION_KEY 未配置';
  if (!/^[0-9a-fA-F]{64}$/.test(v)) return 'FIELD_ENCRYPTION_KEY 必须是 64 位十六进制（32 字节）';
  if (isInsecureSecretValue(v)) return 'FIELD_ENCRYPTION_KEY 使用了内置开发密钥或随机性不足';
  return null;
}

/** 48 字节 CSPRNG → 64 个 base64url 字符 */
export function generateJwtSecret(): string {
  return randomBytes(48).toString('base64url');
}

/** 32 字节 CSPRNG → 64 位十六进制 */
export function generateFieldEncryptionKey(): string {
  return randomBytes(32).toString('hex');
}

/**
 * 基础设施口令（PostgreSQL / Redis）：24 字节 CSPRNG → 32 个 base64url 字符。
 * 只含 URL 安全字符，可直接拼进 DATABASE_URL / REDIS_URL 而无需转义。
 */
export function generateInfraPassword(): string {
  return randomBytes(24).toString('base64url');
}

export type RuntimeSecretName = 'JWT_SECRET' | 'FIELD_ENCRYPTION_KEY';

export interface RuntimeSecretsInput {
  nodeEnv: string | undefined;
  jwtSecret: string | undefined;
  fieldEncryptionKey: string | undefined;
}

export interface ResolvedRuntimeSecrets {
  jwtSecret: string;
  fieldEncryptionKey: string;
  /** 回落到内置开发密钥的项（仅开发模式可能非空） */
  devDefaults: RuntimeSecretName[];
}

export function isDevelopmentEnv(nodeEnv: string | undefined): boolean {
  return nodeEnv === 'development';
}

/** 解析运行时实际使用的密钥：开发模式下缺省项回落内置开发密钥，其他环境原样透传（由校验阶段拦截） */
export function resolveRuntimeSecrets(input: RuntimeSecretsInput): ResolvedRuntimeSecrets {
  const dev = isDevelopmentEnv(input.nodeEnv);
  const devDefaults: RuntimeSecretName[] = [];
  let jwtSecret = input.jwtSecret?.trim() ?? '';
  let fieldEncryptionKey = input.fieldEncryptionKey?.trim() ?? '';
  if (dev && !jwtSecret) {
    jwtSecret = DEV_JWT_SECRET;
    devDefaults.push('JWT_SECRET');
  }
  if (dev && !fieldEncryptionKey) {
    fieldEncryptionKey = DEV_FIELD_ENCRYPTION_KEY;
    devDefaults.push('FIELD_ENCRYPTION_KEY');
  }
  return { jwtSecret, fieldEncryptionKey, devDefaults };
}

/**
 * 非开发环境的启动校验，返回错误列表（空数组 = 通过）。
 * 开发模式不校验：显式配置的值照用（便于本机复现问题），未配置的已回落内置密钥。
 */
export function collectRuntimeSecretErrors(input: RuntimeSecretsInput): string[] {
  if (isDevelopmentEnv(input.nodeEnv)) return [];
  const errors: string[] = [];
  const jwtError = validateJwtSecret(input.jwtSecret ?? '');
  if (jwtError) errors.push(jwtError);
  const fieldError = validateFieldEncryptionKey(input.fieldEncryptionKey ?? '');
  if (fieldError) errors.push(fieldError);
  return errors;
}

/** 启动失败时给运维的一段可直接照做的提示 */
export const RUNTIME_SECRETS_HINT = [
  '生成方式：在仓库根目录运行 `npm run secret:generate`，把输出的两行写入 packages/server/.env（或部署环境变量）。',
  'FIELD_ENCRYPTION_KEY 按数据库共享（连同一个库的实例必须一致）；JWT_SECRET 按实例独立即可。',
  '本地开发请使用 `npm run dev`（自动 NODE_ENV=development，未配置时使用内置开发密钥）。',
].join('\n');
