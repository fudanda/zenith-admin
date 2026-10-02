import './styles.css';
import { ArcBaseAdmin as OriginalAdmin } from '@arcbase/web/admin';
import type { ArcBaseAdminProps } from '@arcbase/web/admin';

/** Embeddable full-page admin; all pages remain in the web workspace. */
export function ArcBaseAdmin(props: ArcBaseAdminProps) {
  return <OriginalAdmin {...props} assetBasePath={props.assetBasePath ?? new URL('./public/', import.meta.url).href} />;
}

export type { ArcBaseAdminProps, ArcBaseBrand, ArcBaseLocale, ArcBaseTheme, ArcBaseSessionAdapter, ArcBaseAdminModule, ArcBaseAdminPage, ArcBasePageProps } from '@arcbase/web/admin';
