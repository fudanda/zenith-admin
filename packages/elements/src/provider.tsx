import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import LocaleContext from '@douyinfe/semi-ui/lib/es/locale/context';
import type { Client } from '@arcbase/client';
import { createCookieSession, type ArcBaseSessionAdapter, type ArcBaseSessionValue } from './session';

export type ArcBaseLocale = 'zh-CN' | 'en-US';
export type ArcBaseTheme = 'light' | 'dark' | 'system';
export interface ArcBaseBrand {
  name?: string; logo?: ReactNode; loginImage?: string;
  copyrightName?: string; icpNumber?: string; icpUrl?: string;
}
export interface ArcBaseProviderProps {
  client: Client; children: ReactNode;
  /** Controlled bridge for an existing app session; creates no additional auth requests. */
  session?: ArcBaseSessionValue;
  authSession?: ArcBaseSessionAdapter;
  locale?: ArcBaseLocale;
  brand?: ArcBaseBrand;
  navigate?: (path: string) => void;
  routes?: { home?: string; login?: string };
}
interface ElementsContextValue extends Omit<ArcBaseProviderProps, 'children' | 'authSession' | 'session'> { session: ArcBaseSessionValue; locale: ArcBaseLocale }
const ElementsContext = createContext<ElementsContextValue | null>(null);

function Localized({ locale, children }: { locale?: ArcBaseLocale; children: ReactNode }) {
  const inherited = useContext(LocaleContext);
  const [loaded, setLoaded] = useState<{ locale: ArcBaseLocale; value: typeof inherited }>();
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

function ControlledProvider({ session, children, ...props }: ArcBaseProviderProps & { session: ArcBaseSessionValue }) {
  const locale = props.locale ?? 'zh-CN';
  const value = useMemo(() => ({ ...props, locale, session }), [props.client, props.brand, props.navigate, props.routes, locale, session]);
  return <ElementsContext.Provider value={value}><Localized locale={props.locale}>{children}</Localized></ElementsContext.Provider>;
}
function ManagedProvider(props: ArcBaseProviderProps) {
  const [adapter, setAdapter] = useState<ArcBaseSessionAdapter | null>(props.authSession ?? null);
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
const pendingSession: ArcBaseSessionValue = { status: 'checking', session: null, error: null, refreshing: true, login: unavailableAction, logout: unavailableAction, resolveSessionConflict: unavailableAction, refresh: unavailableAction, updateUser: () => {} };
function AdapterProvider({ adapter, ...props }: ArcBaseProviderProps & { adapter: ArcBaseSessionAdapter }) {
  const snapshot = useSyncExternalStore(adapter.subscribe, adapter.getSnapshot, adapter.getSnapshot);
  useEffect(() => { props.client.setCsrfToken(snapshot.session?.csrfToken ?? null); }, [props.client, snapshot.session]);
  const value = useMemo(() => ({ ...snapshot, login: adapter.login, logout: adapter.logout, refresh: adapter.refresh, resolveSessionConflict: adapter.resolveSessionConflict, updateUser: adapter.updateUser }), [snapshot, adapter]);
  return <ControlledProvider {...props} session={value} />;
}
export function ArcBaseProvider(props: ArcBaseProviderProps) {
  if (props.session && props.authSession) throw new Error('Supply session or authSession, not both');
  return props.session ? <ControlledProvider {...props} session={props.session} /> : <ManagedProvider {...props} />;
}
export function useArcBase() {
  const value = useContext(ElementsContext);
  if (!value) throw new Error('ArcBase elements require ArcBaseProvider');
  return value;
}
export function useSession() { return useArcBase().session; }
