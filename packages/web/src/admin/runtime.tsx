import { createContext, useContext, useCallback } from 'react';
import type { ZenithAdminProps } from './types';
import { config } from '../config';

export interface AdminPaths { basePath: string; assetBasePath: string }
export const AdminPathsContext = createContext<AdminPaths | null>(null);
export type AdminOptions = Pick<ZenithAdminProps, 'brand' | 'locale' | 'theme' | 'navigateExternal' | 'authSession'>;
export const AdminOptionsContext = createContext<AdminOptions>({});
export function useAdminOptions() { return useContext(AdminOptionsContext); }
export function useAdminTitle() { return useAdminOptions().brand?.name ?? config.appTitle; }

export function validateAdminOptions(options: AdminOptions) {
  if (options.locale !== undefined && !['zh-CN', 'en-US'].includes(options.locale)) throw new Error('Unsupported admin locale');
  if (options.theme !== undefined && !['light', 'dark', 'system'].includes(options.theme)) throw new Error('Unsupported admin theme');
  for (const value of [options.brand?.loginImage, options.brand?.icpUrl]) {
    if (value === undefined) continue;
    const url = new URL(value, 'https://localhost');
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Brand links must be safe local paths or HTTP URLs');
  }
}

export function normalizeAdminBasePath(value = '/dash'): string {
  if (!/^\/(?:[A-Za-z0-9_-]+\/?)*$/.test(value) || value.includes('//')) throw new Error('basePath must be an absolute local route path');
  return value.replace(/\/$/, '') || '/';
}

export function normalizeAssetBasePath(value: string): string {
  const url = new URL(value, globalThis.location.origin);
  if (!['http:', 'https:'].includes(url.protocol) || url.search || url.hash || url.username || url.password) throw new Error('assetBasePath must be a local path or HTTP URL without credentials, query or fragment');
  return url.href.replace(/\/$/, '') + '/';
}

export function useAdminPaths(): AdminPaths {
  return useContext(AdminPathsContext) ?? {
    basePath: import.meta.env.BASE_URL.replace(/\/$/, '') || '/',
    assetBasePath: import.meta.env.BASE_URL,
  };
}

export function useAdminExternalNavigation() {
  const callback = useAdminOptions().navigateExternal;
  return useCallback((value: string) => {
    const url = new URL(value, globalThis.location.origin);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password) throw new Error('Invalid external navigation URL');
    if (callback) callback(url.href); else globalThis.open(url.href, '_blank', 'noopener,noreferrer');
  }, [callback]);
}
