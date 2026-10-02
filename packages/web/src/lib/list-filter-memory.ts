import type { QueryKey } from '@tanstack/react-query';

/**
 * 列表页筛选条件的会话级记忆（偏好「记住列表筛选条件」开启时由 `useListSearch` 读写）。
 *
 * 以列表 query key 为标识存进 sessionStorage：同一账号在同一浏览器会话内离开再回到列表页，
 * 恢复上次**已提交**的筛选条件；关闭浏览器即清，不跨登录保留。
 * 只存条件不存页码——回到列表页从第 1 页看起更符合预期。
 */
const PREFIX = 'arcbase:list-filters:';
const DATE_MARK = '__date';

function storageKey(listKey: QueryKey): string {
  return `${PREFIX}${JSON.stringify(listKey)}`;
}

/** Date 在 JSON.stringify 里先经 toJSON 变成字符串，replacer 拿到的已是字符串，需从宿主对象读原值 */
function replacer(this: Record<string, unknown>, key: string, value: unknown): unknown {
  const raw = this[key];
  if (raw instanceof Date) return { [DATE_MARK]: raw.getTime() };
  return value;
}

function reviver(_key: string, value: unknown): unknown {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record);
    if (keys.length === 1 && keys[0] === DATE_MARK && typeof record[DATE_MARK] === 'number') {
      return new Date(record[DATE_MARK]);
    }
  }
  return value;
}

export function readListFilterSnapshot<T>(listKey: QueryKey): T | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey(listKey));
    if (!raw) return undefined;
    const parsed = JSON.parse(raw, reviver) as unknown;
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? (parsed as T) : undefined;
  } catch {
    return undefined;
  }
}

export function writeListFilterSnapshot(listKey: QueryKey, params: unknown): void {
  try {
    sessionStorage.setItem(storageKey(listKey), JSON.stringify(params, replacer));
  } catch { /* 存储不可用（隐私模式 / 配额）时静默放弃记忆 */ }
}

export function clearListFilterSnapshot(listKey: QueryKey): void {
  try {
    sessionStorage.removeItem(storageKey(listKey));
  } catch { /* ignore */ }
}

/** 偏好关闭时清掉全部快照，避免再次开启时恢复出陈旧条件 */
export function clearAllListFilterSnapshots(): void {
  try {
    const stale: string[] = [];
    for (let i = 0; i < sessionStorage.length; i++) {
      const key = sessionStorage.key(i);
      if (key?.startsWith(PREFIX)) stale.push(key);
    }
    stale.forEach((key) => sessionStorage.removeItem(key));
  } catch { /* ignore */ }
}
