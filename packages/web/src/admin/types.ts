import type { Client } from '@arcbase/client';
import type { QueryClient } from '@tanstack/react-query';
import type { ComponentType, ReactNode } from 'react';
import type { GoSession } from '@arcbase/shared/identity';
import type { ArcBaseBrand, ArcBaseLocale, ArcBaseTheme, ArcBaseSessionAdapter } from '@arcbase/elements';

export type { ArcBaseBrand, ArcBaseLocale, ArcBaseTheme, ArcBaseSessionAdapter } from '@arcbase/elements';

export interface ArcBasePageProps {
  client: Client;
  user: GoSession['user'];
  permissions: readonly string[];
  hasPermission: (permission: string) => boolean;
}
export interface ArcBaseAdminPage {
  id: string;
  title: string;
  /** Host routes live below /extensions/{module.id}/. */
  path: string;
  permission: string;
  component: ComponentType<ArcBasePageProps>;
  icon?: string;
  keepAlive?: boolean;
}
export interface ArcBaseAdminModule {
  id: string;
  title: string;
  icon?: string;
  pages: readonly ArcBaseAdminPage[];
}

export interface ArcBaseAdminProps {
  /** Defaults to a same-origin Cookie client. Keep the instance stable. */
  client?: Client;
  /** React Router basename; defaults to /dash. Remount to change it. */
  basePath?: string;
  /** Public avatars and Monaco resources, independent of the route basename. */
  assetBasePath?: string;
  /** Optional dedicated admin cache. It is cancelled and cleared on unmount. */
  queryClient?: QueryClient;
  brand?: ArcBaseBrand;
  /** Semi controls and standalone elements locale; existing business labels stay unchanged. */
  locale?: ArcBaseLocale;
  /** Initial default only; server policy and personal overrides take precedence. */
  theme?: ArcBaseTheme;
  /** Optional host-owned Cookie session. The admin does not create a second /me observer. */
  authSession?: ArcBaseSessionAdapter;
  /** Stable host declarations; page and button access still require Go authorization. */
  modules?: readonly ArcBaseAdminModule[];
  navigateExternal?: (url: string) => void;
  loading?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
}
