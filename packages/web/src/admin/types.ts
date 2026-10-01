import type { Client } from '@zenith/client';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import type { GoSession } from '@zenith/shared/identity';
import type { ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from '@zenith/elements';

export type { ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from '@zenith/elements';

export interface ZenithPageProps {
  client: Client;
  user: GoSession['user'];
  permissions: readonly string[];
  hasPermission: (permission: string) => boolean;
}
export interface ZenithAdminPage {
  id: string;
  title: string;
  /** Host routes live below /extensions/{module.id}/. */
  path: string;
  permission: string;
  component: ComponentType<ZenithPageProps>;
  icon?: string;
  keepAlive?: boolean;
}
export interface ZenithAdminModule {
  id: string;
  title: string;
  icon?: string;
  pages: readonly ZenithAdminPage[];
}

export interface ZenithAdminProps {
  /** Defaults to a same-origin Cookie client. Keep the instance stable. */
  client?: Client;
  /** React Router basename; defaults to /dash. Remount to change it. */
  basePath?: string;
  /** Public avatars and Monaco resources, independent of the route basename. */
  assetBasePath?: string;
  /** Optional dedicated admin cache. It is cancelled and cleared on unmount. */
  queryClient?: QueryClient;
  brand?: ZenithBrand;
  /** Semi controls and standalone elements locale; existing business labels stay unchanged. */
  locale?: ZenithLocale;
  /** Initial default only; server policy and personal overrides take precedence. */
  theme?: ZenithTheme;
  /** Optional host-owned Cookie session. The admin does not create a second /me observer. */
  authSession?: ZenithSessionAdapter;
  /** Stable host declarations; page and button access still require Go authorization. */
  modules?: readonly ZenithAdminModule[];
  navigateExternal?: (url: string) => void;
  loading?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
}
