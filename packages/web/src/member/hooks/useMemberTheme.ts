import { useState, useCallback } from 'react';

const THEME_COLOR_KEY = 'arcbase_member_theme_color';
export const DEFAULT_THEME_COLOR = '#07c160';

export interface ThemePreset {
  name: string;
  color: string;
  label: string;
}

export const THEME_PRESETS: ThemePreset[] = [
  { name: 'green', color: '#07c160', label: '微信绿' },
  { name: 'blue', color: '#1677ff', label: '天空蓝' },
  { name: 'purple', color: '#722ed1', label: '优雅紫' },
  { name: 'orange', color: '#fa8c16', label: '活力橙' },
  { name: 'red', color: '#f5222d', label: '中国红' },
  { name: 'teal', color: '#13c2c2', label: '青碧色' },
  { name: 'pink', color: '#eb2f96', label: '粉玫瑰' },
];

function safeGetColor(): string {
  try {
    return (typeof window !== 'undefined' && localStorage.getItem(THEME_COLOR_KEY)) || DEFAULT_THEME_COLOR;
  } catch {
    return DEFAULT_THEME_COLOR;
  }
}

function safeSaveColor(color: string): void {
  try {
    if (typeof window !== 'undefined') {
      localStorage.setItem(THEME_COLOR_KEY, color);
    }
  } catch {
    // ignore — private mode or storage quota exceeded
  }
}

function applyColor(color: string): void {
  if (typeof document !== 'undefined') {
    document.documentElement.style.setProperty('--m-primary', color);
  }
}

/** 在 React 渲染前调用一次，避免主题闪烁 */
export function initMemberTheme() {
  applyColor(safeGetColor());
}

export function useMemberTheme() {
  const [themeColor, setThemeColorState] = useState<string>(safeGetColor);

  const setThemeColor = useCallback((color: string) => {
    safeSaveColor(color);
    applyColor(color);
    setThemeColorState(color);
  }, []);

  return { themeColor, setThemeColor, presets: THEME_PRESETS };
}
