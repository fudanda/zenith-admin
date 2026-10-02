import { initVChartSemiTheme } from '@visactor/vchart-semi-theme';

declare global {
  interface Window {
    __arcbaseVChartSemiThemeInitialized__?: boolean;
  }
}

export function setupVChartSemiTheme() {
  if (typeof window === 'undefined' || window.__arcbaseVChartSemiThemeInitialized__) {
    return;
  }

  initVChartSemiTheme({ isWatchingThemeSwitch: true });
  window.__arcbaseVChartSemiThemeInitialized__ = true;
}
