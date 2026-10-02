import { SunIcon, MoonIcon, MonitorIcon } from './ThemeIcons';
import type { ThemeMode } from '@/hooks/useTheme';

export const themeLabelMap: Record<ThemeMode, { label: string; icon: React.ReactNode }> = {
  light: { label: '浅色', icon: <SunIcon /> },
  dark:  { label: '深色', icon: <MoonIcon /> },
  system: { label: '跟随系统', icon: <MonitorIcon /> },
};
