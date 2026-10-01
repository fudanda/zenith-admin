import type { Client } from '@zenith/client';
import type { QueryClient } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import type { ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from '@zenith/elements';

export type { ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from '@zenith/elements';

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
  navigateExternal?: (url: string) => void;
  loading?: ReactNode;
  errorFallback?: (error: Error) => ReactNode;
}
