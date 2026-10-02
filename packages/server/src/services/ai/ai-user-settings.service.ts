import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { aiUserSettings } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { AI_USER_SETTINGS_DEFAULTS } from '@arcbase/shared/ai';
import type { AiUserSettings, AiUserSettingsPatch, SaveAiUserSettingsInput } from '@arcbase/shared/ai';

/**
 * 用户级 AI 设置(单份文档,分域):
 * - DB 只存与默认值的稀疏差异(settings jsonb),读取时与 AI_USER_SETTINGS_DEFAULTS 深合并;
 * - 新增设置域零迁移:扩展 shared 的 schema + DEFAULTS 即可。
 */

function mergeSettings(patch: AiUserSettingsPatch | null | undefined): AiUserSettings {
  const d = AI_USER_SETTINGS_DEFAULTS;
  return {
    instructions: { ...d.instructions, ...patch?.instructions },
    memory: { ...d.memory, ...patch?.memory },
  };
}

/** 获取当前用户的 AI 设置(无记录返回默认值) */
export async function getMyAiSettings(): Promise<AiUserSettings> {
  const user = currentUser();
  const [row] = await db.select().from(aiUserSettings).where(eq(aiUserSettings.userId, user.userId));
  return mergeSettings(row?.settings);
}

/** 内部:按 userId 读取(生成链路查 memory 开关等,无登录上下文约束) */
export async function getUserAiSettings(userId: number): Promise<AiUserSettings> {
  const [row] = await db.select().from(aiUserSettings).where(eq(aiUserSettings.userId, userId));
  return mergeSettings(row?.settings);
}

/** 保存当前用户的 AI 设置(域内字段级合并,upsert) */
export async function saveMyAiSettings(input: SaveAiUserSettingsInput): Promise<AiUserSettings> {
  const user = currentUser();
  const [existing] = await db.select().from(aiUserSettings).where(eq(aiUserSettings.userId, user.userId));
  const prev = (existing?.settings ?? {}) as AiUserSettingsPatch;
  const next: AiUserSettingsPatch = {
    ...prev,
    ...(input.instructions && { instructions: { ...prev.instructions, ...input.instructions } }),
    ...(input.memory && { memory: { ...prev.memory, ...input.memory } }),
  };
  const [row] = await db
    .insert(aiUserSettings)
    .values({ userId: user.userId, settings: next })
    .onConflictDoUpdate({ target: aiUserSettings.userId, set: { settings: next } })
    .returning();
  return mergeSettings(row.settings);
}

/**
 * 组装个人指令片段（拼接进对话 system prompt 末尾）。
 * 未启用或内容为空时返回 null。
 */
export async function buildPreferencePrompt(userId: number): Promise<string | null> {
  const settings = await getUserAiSettings(userId);
  if (!settings.instructions.enabled) return null;
  const parts: string[] = [];
  if (settings.instructions.aboutMe?.trim()) parts.push(`关于用户的背景信息：${settings.instructions.aboutMe.trim()}`);
  if (settings.instructions.replyStyle?.trim()) parts.push(`用户对回答风格的要求：${settings.instructions.replyStyle.trim()}`);
  return parts.length > 0 ? parts.join('\n') : null;
}
