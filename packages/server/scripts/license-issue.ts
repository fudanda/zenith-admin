/**
 * License 签发 CLI（离线运行，不依赖数据库）。
 *
 * 用法：
 *   # 生成生产密钥对（私钥自行保管，公钥配到部署环境 LICENSE_ISSUER_PUBLIC_KEY）
 *   npx tsx scripts/license-issue.ts --gen-keys
 *
 *   # 用内置测试私钥签发（仅供开发/评估；生产必须用 --private-key）
 *   npx tsx scripts/license-issue.ts \
 *     --installation-id <系统设置→License 授权页显示的安装 ID> \
 *     --customer "ACME 公司" --edition pro \
 *     --features workflow,report,cms --days 365 \
 *     --max-users 100 --out acme.zenlic
 *
 *   # 用自有私钥签发
 *   npx tsx scripts/license-issue.ts --private-key <base64 PKCS8> --key-id prod-2026 ...
 *
 * ⚠️ 内置测试密钥对是公开的：任何人都能签发通过默认公钥验证的 License。
 *    它的用途是让模板开箱可测，不是保护手段。商用部署必须 --gen-keys 自建密钥。
 */
import { createPrivateKey, randomUUID, sign as edSign, generateKeyPairSync } from 'node:crypto';
import { writeFileSync } from 'node:fs';
import {
  LICENSE_ALGORITHM,
  LICENSE_AUDIENCE,
  LICENSE_ENVELOPE_VERSION,
  LICENSE_FEATURES,
  LICENSE_EDITIONS,
  LICENSE_EDITION_PRESETS,
  type LicenseEdition,
  type LicenseFeatureKey,
  type LicensePayload,
} from '@arcbase/shared/licensing';

/** 与 src/lib/licensing/keys.ts 中 TEST_PUBLIC_KEY_BASE64 配对的测试私钥（公开，勿用于生产） */
const TEST_KEY_ID = 'test-2026';
const TEST_PRIVATE_KEY_BASE64 = 'MC4CAQAwBQYDK2VwBCIEIGyZp5WDE++d2SWo6Ns/202nKFvDAhjDQiRAzHItJW0L';

function parseArgs(argv: string[]): Map<string, string | boolean> {
  const args = new Map<string, string | boolean>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg.startsWith('--')) continue;
    const key = arg.slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args.set(key, true);
    } else {
      args.set(key, next);
      i++;
    }
  }
  return args;
}

function fail(message: string): never {
  console.error(`✗ ${message}`);
  process.exit(1);
}

const args = parseArgs(process.argv.slice(2));

if (args.get('gen-keys')) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  console.log('已生成 Ed25519 密钥对（base64 DER）：\n');
  console.log('公钥（SPKI，配到部署环境 LICENSE_ISSUER_PUBLIC_KEY）：');
  console.log(publicKey.export({ format: 'der', type: 'spki' }).toString('base64'));
  console.log('\n私钥（PKCS8，签发方离线保管，绝不进入部署环境/仓库）：');
  console.log(privateKey.export({ format: 'der', type: 'pkcs8' }).toString('base64'));
  process.exit(0);
}

const installationId = args.get('installation-id');
if (typeof installationId !== 'string') {
  fail('缺少 --installation-id（在管理后台「系统设置 → License 授权」页复制）；或使用 --gen-keys 生成密钥对');
}

const edition = (args.get('edition') as string) || 'pro';
if (!(LICENSE_EDITIONS as readonly string[]).includes(edition)) {
  fail(`--edition 必须是 ${LICENSE_EDITIONS.join(' / ')}`);
}

let features: LicenseFeatureKey[];
const featuresArg = args.get('features');
if (typeof featuresArg === 'string' && featuresArg !== 'preset') {
  const requested = featuresArg.split(',').map((f) => f.trim()).filter(Boolean);
  const invalid = requested.filter((f) => !(LICENSE_FEATURES as readonly string[]).includes(f));
  if (invalid.length > 0) fail(`无效的功能标识：${invalid.join(', ')}（可用：${LICENSE_FEATURES.join(', ')}）`);
  features = requested as LicenseFeatureKey[];
} else {
  features = [...LICENSE_EDITION_PRESETS[edition as LicenseEdition]];
}

const days = Number(args.get('days') ?? 365);
if (!Number.isInteger(days) || days < 1) fail('--days 必须是正整数');
const graceDays = Number(args.get('grace-days') ?? 30);

const now = new Date();
const expiresAt = new Date(now.getTime() + days * 86_400_000);
const graceUntil = new Date(expiresAt.getTime() + graceDays * 86_400_000);

const maxUsersArg = args.get('max-users');
const maxTenantsArg = args.get('max-tenants');

const payload: LicensePayload = {
  licenseId: (args.get('license-id') as string) || `lic_${randomUUID().replaceAll('-', '').slice(0, 20)}`,
  audience: LICENSE_AUDIENCE,
  installationId,
  customerId: (args.get('customer-id') as string) || `cus_${randomUUID().slice(0, 8)}`,
  customerName: (args.get('customer') as string) || '评估客户',
  edition: edition as LicenseEdition,
  features,
  limits: {
    maxUsers: typeof maxUsersArg === 'string' ? Number(maxUsersArg) : null,
    maxTenants: typeof maxTenantsArg === 'string' ? Number(maxTenantsArg) : null,
    maxNodes: null,
  },
  issuedAt: now.toISOString(),
  notBefore: now.toISOString(),
  expiresAt: expiresAt.toISOString(),
  graceUntil: graceUntil.toISOString(),
  maintenanceUntil: null,
};

const privateKeyBase64 = (args.get('private-key') as string) || TEST_PRIVATE_KEY_BASE64;
const keyId = (args.get('key-id') as string) || TEST_KEY_ID;
if (privateKeyBase64 === TEST_PRIVATE_KEY_BASE64) {
  console.warn('⚠ 正在使用内置测试私钥签发（keyId=test-2026），仅供开发/评估。\n');
}

const privateKey = createPrivateKey({ key: Buffer.from(privateKeyBase64, 'base64'), format: 'der', type: 'pkcs8' });
const payloadBytes = Buffer.from(JSON.stringify(payload), 'utf8');
const signature = edSign(null, payloadBytes, privateKey);

const envelope = {
  version: LICENSE_ENVELOPE_VERSION,
  algorithm: LICENSE_ALGORITHM,
  keyId,
  payload: payloadBytes.toString('base64url'),
  signature: signature.toString('base64url'),
};

const output = JSON.stringify(envelope, null, 2);
const outFile = args.get('out');
if (typeof outFile === 'string') {
  writeFileSync(outFile, output, 'utf8');
  console.log(`✓ License 已写入 ${outFile}`);
} else {
  console.log(output);
}
console.log(`\n  licenseId : ${payload.licenseId}`);
console.log(`  客户      : ${payload.customerName}（${payload.edition}）`);
console.log(`  功能      : ${features.join(', ') || '（无增值功能）'}`);
console.log(`  到期      : ${payload.expiresAt}（宽限至 ${payload.graceUntil}）`);
console.log(`  绑定安装  : ${installationId}`);
