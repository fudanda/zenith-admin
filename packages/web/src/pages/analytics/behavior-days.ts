import { createContext, useContext, useState } from 'react';

/**
 * 行为分析「即时响应型」页签（概览/页面停留/功能使用/漏斗/路径/用户分析/点击分布/获客归因）
 * 共享的日期区间（近 N 天）：切换页签统计口径保持一致，不再各自漂移。
 * 提交型（事件分析）、周期型（留存）与实时页签不参与共享。
 */
export const BehaviorDaysContext = createContext<{ days: number; setDays: (days: number) => void } | null>(null);

export const BEHAVIOR_DAYS_OPTIONS = [
  { label: '近 7 天', value: 7 },
  { label: '近 14 天', value: 14 },
  { label: '近 30 天', value: 30 },
  { label: '近 90 天', value: 90 },
];

/** 无 Provider 时回退为组件本地状态（便于单测/独立复用） */
export function useBehaviorDays(): [number, (days: number) => void] {
  const ctx = useContext(BehaviorDaysContext);
  const [localDays, setLocalDays] = useState(7);
  return ctx ? [ctx.days, ctx.setDays] : [localDays, setLocalDays];
}
