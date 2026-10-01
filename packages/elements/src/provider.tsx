import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import LocaleContext from '@douyinfe/semi-ui/lib/es/locale/context';
import type { Client } from '@zenith/client';
import { createCookieSession, type ZenithSessionAdapter, type ZenithSessionValue } from './session';

export type ZenithLocale = 'zh-CN' | 'en-US';
export type ZenithTheme = 'light' | 'dark' | 'system';
export interface ZenithBrand {
  name?: string; logo?: ReactNode; loginImage?: string;
  copyrightName?: string; icpNumber?: string; icpUrl?: string;
}
export interface ZenithProviderProps {
  client: Client; children: ReactNode;
  /** Controlled bridge for an existing app session; creates no additional auth requests. */
  session?: ZenithSessionValue;
  authSession?: ZenithSessionAdapter;
  locale?: ZenithLocale;
  brand?: ZenithBrand;
  navigate?: (path: string) => void;
  routes?: { home?: string; login?: string };
}
interface ElementsContextValue extends Omit<ZenithProviderProps, 'children' | 'authSession' | 'session'> { session: ZenithSessionValue; locale: ZenithLocale }
const ElementsContext = createContext<ElementsContextValue | null>(null);

function Localized({ locale, children }: { locale?: ZenithLocale; children: ReactNode }) {
  const inherited = useContext(LocaleContext);
  const [loaded, setLoaded] = useState<{ locale: ZenithLocale; value: typeof inherited }>();
  const [error, setError] = useState<Error | null>(null);
  useEffect(() => {
    if (!locale) return;
    let disposed = false;
    const source = locale === 'en-US' ? import('@douyinfe/semi-ui/lib/es/locale/source/en_US') : import('@douyinfe/semi-ui/lib/es/locale/source/zh_CN');
    void source.then(module => { if (!disposed) setLoaded({ locale, value: module.default }); })
      .catch((problem: unknown) => { if (!disposed) setError(problem instanceof Error ? problem : new Error(String(problem))); });
    return () => { disposed = true; };
  }, [locale]);
  if (error) throw error;
  // Keep the same provider tree while a locale loads; never remount forms/pages.
  return <LocaleContext.Provider value={locale && loaded?.locale === locale ? loaded.value : inherited}>{children}</LocaleContext.Provider>;
}

function ControlledProvider({ session, children, ...props }: ZenithProviderProps & { session: ZenithSessionValue }) {
  const locale = props.locale ?? 'zh-CN';
  const value = useMemo(() => ({ ...props, locale, session }), [props.client, props.brand, props.navigate, props.routes, locale, session]);
  return <ElementsContext.Provider value={value}><Localized locale={props.locale}>{children}</Localized></ElementsContext.Provider>;
}
function ManagedProvider(props: ZenithProviderProps) {
  const [adapter, setAdapter] = useState<ZenithSessionAdapter | null>(props.authSession ?? null);
  useEffect(() => {
    const owned = props.authSession ? null : createCookieSession(props.client);
    const current = props.authSession ?? owned!;
    setAdapter(current);
    if (owned) void owned.refresh();
    return () => { owned?.dispose(); };
  }, [props.client, props.authSession]);
  return adapter ? <AdapterProvider {...props} adapter={adapter} /> : <ControlledProvider {...props} session={pendingSession} />;
}
const unavailableAction = async (): Promise<never> => { throw new Error('Session is not ready'); };
const pendingSession: ZenithSessionValue = { status: 'checking', session: null, error: null, refreshing: true, login: unavailableAction, logout: unavailableAction, resolveSessionConflict: unavailableAction, refresh: unavailableAction, updateUser: () => {} };
function AdapterProvider({ adapter, ...props }: ZenithProviderProps & { adapter: ZenithSessionAdapter }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
  useEffect(() => { props.client.setCsrfToken(snapshot.session?.csrfToken ?? null); }, [props.client, snapshot.session]);
  const value = useMemo(() => ({ ...snapshot, login: adapter.login, logout: adapter.logout, refresh: adapter.refresh, resolveSessionConflict: adapter.resolveSessionConflict, updateUser: adapter.updateUser }), [snapshot, adapter]);
  return <ControlledProvider {...props} session={value} />;
}
export function ZenithProvider(props: ZenithProviderProps) {
  if (props.session && props.authSession) throw new Error('Supply session or authSession, not both');
  return props.session ? <ControlledProvider {...props} session={props.session} /> : <ManagedProvider {...props} />;
}
export function useZenith() {
  const value = useContext(ElementsContext);
  if (!value) throw new Error('Zenith elements require ZenithProvider');
  return value;
}
export function useSession() { return useZenith().session; }
