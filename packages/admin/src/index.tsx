import './styles.css';
import { ZenithAdmin as OriginalAdmin } from '@zenith/web/admin';
import type { ZenithAdminProps } from '@zenith/web/admin';

/** Embeddable full-page admin; all pages remain in the web workspace. */
export function ZenithAdmin(props: ZenithAdminProps) {
  return <OriginalAdmin {...props} assetBasePath={props.assetBasePath ?? new URL('./public/', import.meta.url).href} />;
}

export type { ZenithAdminProps, ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from '@zenith/web/admin';
