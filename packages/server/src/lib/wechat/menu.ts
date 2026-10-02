import { wechatApiGet, wechatApiPost } from './api';
import type { MpCredential } from './api';
import type { MpMenuButton } from '@arcbase/shared/mp';

interface MenuMutateResponse {
  errcode?: number;
  errmsg?: string;
}

interface MenuGetResponse {
  errcode?: number;
  errmsg?: string;
  menu?: { button: MpMenuButton[] };
}

/** 创建/覆盖自定义菜单 */
export async function createWechatMenu(account: MpCredential, buttons: MpMenuButton[]): Promise<void> {
  await wechatApiPost<MenuMutateResponse>(account, '/cgi-bin/menu/create', { button: buttons });
}

/** 拉取当前生效的自定义菜单 */
export async function getWechatMenu(account: MpCredential): Promise<MpMenuButton[]> {
  const data = await wechatApiGet<MenuGetResponse>(account, '/cgi-bin/menu/get');
  return data.menu?.button ?? [];
}

/** 删除自定义菜单 */
export async function deleteWechatMenu(account: MpCredential): Promise<void> {
  await wechatApiGet<MenuMutateResponse>(account, '/cgi-bin/menu/delete');
}

interface ConditionalAddResponse {
  errcode?: number;
  errmsg?: string;
  menuid?: string;
}

/** 匹配规则（按标签/性别/地区/客户端/语言下发个性化菜单） */
export interface WechatMenuMatchRule {
  tag_id?: string;
  sex?: string;
  country?: string;
  province?: string;
  city?: string;
  client_platform_type?: string;
  language?: string;
}

/** 创建个性化菜单，返回微信 menuid */
export async function addConditionalWechatMenu(account: MpCredential, buttons: MpMenuButton[], matchrule: WechatMenuMatchRule): Promise<string> {
  const data = await wechatApiPost<ConditionalAddResponse>(account, '/cgi-bin/menu/addconditional', { button: buttons, matchrule });
  return data.menuid ?? '';
}

/** 删除个性化菜单 */
export async function delConditionalWechatMenu(account: MpCredential, menuid: string): Promise<void> {
  await wechatApiPost<MenuMutateResponse>(account, '/cgi-bin/menu/delconditional', { menuid });
}

interface TryMatchResponse {
  errcode?: number;
  errmsg?: string;
  button?: MpMenuButton[];
}

/** 测试个性化菜单匹配（user_id 可为 openid 或微信号），返回命中的菜单按钮 */
export async function tryMatchWechatMenu(account: MpCredential, userId: string): Promise<MpMenuButton[]> {
  const data = await wechatApiPost<TryMatchResponse>(account, '/cgi-bin/menu/trymatch', { user_id: userId });
  return data.button ?? [];
}
