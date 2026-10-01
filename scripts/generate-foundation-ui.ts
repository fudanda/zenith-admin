import { readFileSync, writeFileSync } from 'node:fs';
import * as z from 'zod';
import { defaultPreferencePolicy, preferenceOverridesSchema } from '../packages/shared/src/preferences/validation';
import { THEME_COLOR_KEYS } from '../packages/shared/src/preferences/constants';
import { connectedFoundationPages, foundationDictCodes, foundationPages } from '../packages/shared/src/foundation';
import { foundationSettingSchemas as settingSchemas } from '../packages/shared/src/settings/foundation';
import { SETTINGS_MODULES } from '../packages/shared/src/settings/registry';
import { PRESIGNED_EXPIRY_DEFAULT_SECONDS } from '../packages/shared/src/platform/constants';
import { SEED_MENUS } from '../packages/shared/src/seed/menus';
import { SEED_DICTS, SEED_DICT_ITEMS } from '../packages/shared/src/seed/platform';

const unavailable = ['showQuickChat', 'notificationSound', 'notificationSoundStyle', 'desktopNotification', 'desktopNotificationContent', 'enableLockScreen', 'autoLockMinutes'] as const;
const policy = structuredClone(defaultPreferencePolicy);
for (const key of unavailable) policy.allowUserOverride[key] = false;
for (const key of Object.keys(policy.allowUserOverride.terminal)) {
  policy.allowUserOverride.terminal[key as keyof typeof policy.allowUserOverride.terminal] = false;
}
policy.defaults.showQuickChat = false;
policy.defaults.enableLockScreen = false;
policy.defaults.notificationSound = false;
policy.defaults.desktopNotification = false;
const schema = z.toJSONSchema(preferenceOverridesSchema.omit({ terminal: true }), { unrepresentable: 'any' });
// Zod refinements are not representable; encode the same color domain and
// remove unsupported features explicitly in the runtime validator artifact.
schema.properties!.themeColor = { anyOf: [{ enum: [...THEME_COLOR_KEYS] }, { type: 'string', pattern: '^#[0-9a-fA-F]{6}$' }] };
schema.properties!.homePath = { type: 'string', maxLength: 512, enum: connectedFoundationPages.map((page) => page.path) };
for (const key of unavailable) delete schema.properties![key];
const outputs = {
  'backend/internal/contracts/dictionaries.json': SEED_DICTS.filter((dict) => foundationDictCodes.includes(dict.code as typeof foundationDictCodes[number])).map((dict) => ({
    name: dict.name, code: dict.code, description: dict.description,
    items: SEED_DICT_ITEMS.filter((item) => item.dictId === dict.id).map(({ label, value, color, sort, status }) => ({label, value, color, sort, status})),
  })),
  'backend/internal/contracts/storage-defaults.json': { presignedExpirySeconds: PRESIGNED_EXPIRY_DEFAULT_SECONDS },
  'backend/internal/contracts/preference-overrides.json': schema,
  'backend/internal/contracts/preference-policy.json': policy,
};
// Keep original titles, paths, components and hierarchy, including permission
// buttons for the registered release operations. Seed never invents a new UI.
const releasePaths = new Set<string>(foundationPages.map((page) => page.path));
const operationCatalog = JSON.parse(readFileSync('backend/internal/contracts/catalog.json', 'utf8')) as { operations: Array<{ permission: string }> };
const permissions = new Set(operationCatalog.operations.map((operation) => operation.permission));
const selected = new Set(SEED_MENUS.filter((menu) => menu.path && releasePaths.has(menu.path)).map((menu) => menu.id));
for (const menu of SEED_MENUS) if (menu.type === 'button' && selected.has(menu.parentId ?? 0) && menu.permission && permissions.has(menu.permission)) selected.add(menu.id);
for (let changed = true; changed;) {
  changed = false;
  for (const menu of SEED_MENUS) if (selected.has(menu.id) && menu.parentId && !selected.has(menu.parentId)) { selected.add(menu.parentId); changed = true; }
}
Object.assign(outputs, { 'backend/internal/contracts/menus.json': SEED_MENUS.filter((menu) => selected.has(menu.id)).map(({ featureKey: _feature, createdAt: _created, updatedAt: _updated, ...menu }) => menu) });
const settings = Object.fromEntries(Object.entries(settingSchemas).map(([key, value]) => {
  const defaults = value.parse({}) as Record<string, unknown>;
  if (key === 'auth') defaults.captchaEnabled = true;
  if (key === 'ui') defaults.preferences = policy;
  const validation = z.toJSONSchema(value.strict(), { unrepresentable: 'any' });
  if (key === 'ui') {
    const preferenceDefaults = (validation.properties!.preferences as any).properties.defaults.properties;
    preferenceDefaults.homePath = schema.properties!.homePath;
    preferenceDefaults.themeColor = schema.properties!.themeColor;
  }
  return [key, { defaults, schema: validation, title: SETTINGS_MODULES[key as keyof typeof settingSchemas].title, description: SETTINGS_MODULES[key as keyof typeof settingSchemas].description, path: key === 'identitySecurity' ? '/identity-security' : `/${key}`, readPermission: SETTINGS_MODULES[key as keyof typeof settingSchemas].readPermission, writePermission: SETTINGS_MODULES[key as keyof typeof settingSchemas].writePermission, page: key === 'identitySecurity' ? '/system/identity-security' : null }];
}));
Object.assign(outputs, { 'backend/internal/contracts/settings.json': settings });
for (const [path, value] of Object.entries(outputs)) {
  const content = `${JSON.stringify(value, null, 2)}\n`;
  if (process.argv.includes('--check')) {
    if (readFileSync(path, 'utf8').replace(/\r\n/g, '\n') !== content) throw new Error(`Generated artifact drift: ${path}`);
  } else writeFileSync(path, content);
}
