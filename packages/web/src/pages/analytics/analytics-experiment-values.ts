import { formatDateTimeForApi } from '@/utils/date';
import { trimToNull } from './analytics-format';

/**
 * 表单时间值 → 接口的 `YYYY-MM-DD HH:mm:ss`；留空表示不限，需明确传 null。
 *
 * 导出供单测：漏掉 `instanceof Date` 分支不会报错，Date 会被 JSON 序列化成带 `Z` 的
 * ISO 串，后端按本地时区解析后产生数小时偏移——构建、类型检查、页面渲染全都正常。
 */
export function toApiDateTime(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return formatDateTimeForApi(value);
  return trimToNull(value);
}
