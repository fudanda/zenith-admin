import { RealtimeBridge } from '@/providers/RealtimeBridge';
import '../platform-polyfills';
import '@douyinfe/semi-ui/react19-adapter';
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react';
import { QueryClientProvider } from '@tanstack/react-query';
import { Client } from '@zenith/client';
import { GoAuthProvider } from '../providers/GoAuthProvider';
import { createAdminQueryClient } from '../lib/query';
import { goTransport } from '../lib/go-transport';
import { installScopedStorage } from '../utils/storage';
import PageLoading from '../components/PageLoading';
import { AdminOptionsContext, AdminPathsContext, normalizeAdminBasePath, normalizeAssetBasePath, validateAdminOptions } from './runtime';
import type { ZenithAdminProps } from './types';

const App = lazy(() => import('../App'));

class HostErrorBoundary extends Component<{ children: ReactNode; fallback?: ZenithAdminProps['errorFallback'] }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) { return { error }; }
  render() {
    if (this.state.error) return this.props.fallback?.(this.state.error) ?? <div role="alert">{this.state.error.message}</div>;
    return this.props.children;
  }
}

function AdminHost(props: ZenithAdminProps) {
  validateAdminOptions(props);
  const [runtime] = useState(() => ({
    client: props.client ?? new Client(),
    cache: props.queryClient ?? createAdminQueryClient(),
    paths: { basePath: normalizeAdminBasePath(props.basePath), assetBasePath: normalizeAssetBasePath(props.assetBasePath ?? import.meta.env.BASE_URL) },
    original: { client: props.client, queryClient: props.queryClient, authSession: props.authSession },
  }));
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<Error | null>(null);

  useEffect(() => {
    let release: (() => void) | undefined;
    let releaseStorage: (() => void) | undefined;
    let disposed = false;
    const bodyStyle = document.body.getAttribute('style');
    const rootStyle = document.documentElement.getAttribute('style');
    const themeMode = document.body.getAttribute('theme-mode');
    const title = document.title;
    const language = document.documentElement.getAttribute('lang');
    const favicon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const faviconHref = favicon?.getAttribute('href');
    const faviconType = favicon?.getAttribute('type');
    try {
      release = goTransport.bind(runtime.client);
      releaseStorage = installScopedStorage();
      void import('@monaco-editor/react').then(({ loader }) => {
        if (disposed) return;
        loader.config({ paths: { vs: `${runtime.paths.assetBasePath}monaco/vs` } });
        setReady(true);
      }).catch((problem: unknown) => { if (!disposed) setError(problem instanceof Error ? problem : new Error(String(problem))); });
    } catch (problem) { setError(problem instanceof Error ? problem : new Error(String(problem))); }
    return () => {
      disposed = true;
      if (!release) return;
      release();
      void runtime.cache.cancelQueries();
      runtime.cache.clear();
      releaseStorage?.();
      const restore = (element: Element, attribute: string, value: string | null) => { if (value === null) element.removeAttribute(attribute); else element.setAttribute(attribute, value); };
      restore(document.body, 'style', bodyStyle);
      restore(document.documentElement, 'style', rootStyle);
      restore(document.body, 'theme-mode', themeMode);
      document.title = title;
      restore(document.documentElement, 'lang', language);
      if (favicon) { restore(favicon, 'href', faviconHref ?? null); restore(favicon, 'type', faviconType ?? null); }
      else document.querySelector('link[rel="icon"]')?.remove();
    };
  }, [runtime]);

  useEffect(() => { if (props.locale) document.documentElement.lang = props.locale; }, [props.locale]);

  if (error) throw error;
  if (runtime.original.client !== props.client || runtime.original.queryClient !== props.queryClient
    || runtime.original.authSession !== props.authSession
    || runtime.paths.basePath !== normalizeAdminBasePath(props.basePath)
    || runtime.paths.assetBasePath !== normalizeAssetBasePath(props.assetBasePath ?? import.meta.env.BASE_URL)) throw new Error('Remount ZenithAdmin to change its client, cache or paths');
  if (!ready) return props.loading ?? <PageLoading />;
  return (
    <AdminOptionsContext.Provider value={props}>
    <AdminPathsContext.Provider value={runtime.paths}>
      <QueryClientProvider client={runtime.cache}>
        <GoAuthProvider client={runtime.client} authSession={props.authSession}>
          <RealtimeBridge><Suspense fallback={props.loading ?? <PageLoading />}><App /></Suspense></RealtimeBridge>
        </GoAuthProvider>
      </QueryClientProvider>
    </AdminPathsContext.Provider>
    </AdminOptionsContext.Provider>
  );
}

/** One full-page original Zenith admin per document, with its own cache/lifetime. */
export function ZenithAdmin(props: ZenithAdminProps) {
  return <HostErrorBoundary fallback={props.errorFallback}><AdminHost {...props} /></HostErrorBoundary>;
}

export type { ZenithAdminProps, ZenithBrand, ZenithLocale, ZenithTheme, ZenithSessionAdapter } from './types';
