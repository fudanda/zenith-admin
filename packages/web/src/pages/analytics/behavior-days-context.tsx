import { BehaviorDaysContext } from './behavior-days';
import { useMemo, useState, type ReactNode } from 'react';

export function BehaviorDaysProvider({ children }: { children: ReactNode }) {
  const [days, setDays] = useState(7);
  const value = useMemo(() => ({ days, setDays }), [days]);
  return <BehaviorDaysContext.Provider value={value}>{children}</BehaviorDaysContext.Provider>;
}
