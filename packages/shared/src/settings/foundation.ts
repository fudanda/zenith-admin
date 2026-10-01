import * as z from 'zod';
import type { AnyOperation } from '../core/contract';
import { SETTINGS_MODULES } from './registry';

/** Production setting shapes derive from the original schemas. */
export const foundationSettingSchemas = {
  auth: SETTINGS_MODULES.auth.schema.pick({ captchaEnabled: true, captchaComplexity: true }),
  identitySecurity: SETTINGS_MODULES.identitySecurity.schema.pick({ password: true, loginChallenge: true, session: true }).extend({ loginChallenge: SETTINGS_MODULES.identitySecurity.schema.shape.loginChallenge.unwrap().omit({ alert: true }).prefault({}) }),
  ui: SETTINGS_MODULES.ui.schema.pick({ watermark: true, preferencesEntryEnabled: true, preferences: true }),
  files: SETTINGS_MODULES.files.schema,
};

export function foundationSettingsOperation(operation: AnyOperation): AnyOperation {
  if (operation.basePath !== '/api/settings') return operation;
  const slug = operation.fullPath.split('/').at(-1);
  const key = slug === 'identity-security' ? 'identitySecurity' : slug;
  if (!key || !(key in foundationSettingSchemas)) return operation;
  const schema = foundationSettingSchemas[key as keyof typeof foundationSettingSchemas];
  const envelope = operation.response as z.ZodObject;
  const access: AnyOperation['access'] = operation.access && operation.access !== 'authenticated'
    ? operation.access.permission ? { permission: operation.access.permission } : 'authenticated'
    : operation.access;
  return { ...operation, access, response: envelope.omit({ tenantId: true }).extend({ effective: schema, inherited: schema }),
    ...(operation.body ? { body: z.object({ version: z.int().min(0), data: schema.strict() }) } : {}),
  };
}

/** Form values keep legacy types; only supported fields cross the Go boundary. */
export function foundationSettingsBody(operation: AnyOperation, body: unknown): unknown {
  if (operation.basePath !== '/api/settings' || !body || typeof body !== 'object') return body;
  const slug = operation.fullPath.split('/').at(-1);
  const key = slug === 'identity-security' ? 'identitySecurity' : slug;
  if (!key || !(key in foundationSettingSchemas)) return body;
  const value = body as { version: number; data: unknown };
  return { version: value.version, data: foundationSettingSchemas[key as keyof typeof foundationSettingSchemas].parse(value.data) };
}
