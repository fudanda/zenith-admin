import { HTTPException } from 'hono/http-exception';
import { ensureMpAccountExists } from './mp-account.service';
import { msgSecCheck } from '../../lib/wechat';
import { mapWechatError } from '../../lib/wechat-error';
import logger from '../../lib/logger';
import type { MpAccountRow } from '../../db/schema';
import type { CheckMpContentInput } from '@arcbase/shared/mp';

/** 主动测试一段文本是否通过内容安全校验 */
export async function checkMpContent(data: CheckMpContentInput): Promise<{ pass: boolean; suggest: string }> {
  const account = await ensureMpAccountExists(data.accountId);
  try {
    const r = await msgSecCheck(account, data.content);
    return { pass: r.pass, suggest: r.suggest ?? (r.pass ? 'pass' : 'risky') };
  } catch (err) {
    return mapWechatError(err);
  }
}

/**
 * 发送前内容安全前置校验（供群发 / 客服消息复用）。
 * 仅当账号开启 contentCheckEnabled 且内容非空时生效；命中违规抛 400；
 * 校验接口本身异常时放行（避免风控接口抖动阻断正常业务，最终仍由微信发送接口把关）。
 */
export async function assertContentSafe(account: MpAccountRow, content: string | null | undefined): Promise<void> {
  if (!account.contentCheckEnabled || !content || !content.trim()) return;
  let pass: boolean;
  try {
    const r = await msgSecCheck(account, content);
    pass = r.pass;
  } catch (err) {
    logger.warn(`[mp-security] 内容校验接口异常，放行: ${(err as Error).message}`);
    return;
  }
  if (!pass) throw new HTTPException(400, { message: '内容命中敏感信息，已拦截发送' });
}
