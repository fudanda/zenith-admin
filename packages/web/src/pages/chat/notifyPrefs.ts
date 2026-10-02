/** 聊天通知偏好（本地存储） */
export interface ChatNotifyPrefs {
  /** 桌面通知（需浏览器授权） */
  desktop: boolean;
  /** 新消息提示音 */
  sound: boolean;
}

const KEY = 'arcbase_chat_notify_prefs';
const DEFAULTS: ChatNotifyPrefs = { desktop: true, sound: true };

export function getChatNotifyPrefs(): ChatNotifyPrefs {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULTS, ...(JSON.parse(raw) as Partial<ChatNotifyPrefs>) };
  } catch { /* ignore */ }
  return { ...DEFAULTS };
}

export function setChatNotifyPrefs(prefs: ChatNotifyPrefs): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(prefs));
  } catch { /* ignore */ }
}
