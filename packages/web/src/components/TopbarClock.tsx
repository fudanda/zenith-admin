import { formatTopbarClock } from '../utils/topbar-clock';
import { useEffect, useState } from 'react';
import type { TopbarClockMode } from '@/hooks/usePreferences';

/**
 * 顶栏时钟：分钟对齐 tick（59 秒内最多晚一分钟，无秒级定时器开销）。
 * 调用方在 `topbarClock === 'off'` 时不渲染。
 */
export function TopbarClock({ mode, showDate }: Readonly<{ mode: Exclude<TopbarClockMode, 'off'>; showDate: boolean }>) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let interval: ReturnType<typeof setInterval> | undefined;
    const timeout = setTimeout(() => {
      setNow(new Date());
      interval = setInterval(() => setNow(new Date()), 60 * 1000);
    }, (60 - new Date().getSeconds()) * 1000 + 50);
    return () => {
      clearTimeout(timeout);
      if (interval !== undefined) clearInterval(interval);
    };
  }, []);
  return (
    <span className="admin-topbar-clock" title={formatTopbarClock(now, mode, true)}>
      {formatTopbarClock(now, mode, showDate)}
    </span>
  );
}
