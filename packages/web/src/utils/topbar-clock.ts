import type { TopbarClockMode } from '@/hooks/usePreferences';

const WEEKDAYS = ['周日', '周一', '周二', '周三', '周四', '周五', '周六'] as const;

function pad(value: number): string {
  return String(value).padStart(2, '0');
}

/** 按偏好把当前时刻格式化为时钟文本；纯函数便于测试 */
export function formatTopbarClock(now: Date, mode: Exclude<TopbarClockMode, 'off'>, showDate: boolean): string {
  const hours = now.getHours();
  const minutes = pad(now.getMinutes());
  const time = mode === '24h'
    ? `${pad(hours)}:${minutes}`
    : `${hours < 12 ? '上午' : '下午'}${hours % 12 === 0 ? 12 : hours % 12}:${minutes}`;
  if (!showDate) return time;
  return `${now.getMonth() + 1}月${now.getDate()}日 ${WEEKDAYS[now.getDay()]} ${time}`;
}
