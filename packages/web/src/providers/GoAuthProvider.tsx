import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { hashKey, useQuery, useQueryClient } from '@tanstack/react-query';
import { goAuthContract, type GoSession } from '@zenith/shared/identity';
import { AuthContext, type AuthContextValue } from '@/hooks/useAuth';
import { PermissionContext } from '@/hooks/usePermission';
import { apiRaw, contractKey } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { loginGo, logoutGo } from '@/lib/go-auth-api';
import { GO_SESSION_INVALIDATED, goApiClient } from '@/lib/go-api-client';
import { goTransport } from '@/lib/go-transport';
import { TOKEN_KEY, REFRESH_TOKEN_KEY, PREFERENCES_KEY, TABS_STORAGE_KEY } from '@zenith/shared/core';
import { showRequestErrorToast } from '@/utils/request-toast';
import { ZenithProvider, useSession, type ZenithSessionAdapter, type ZenithSessionValue, type LoginResult as ElementsLoginResult } from '@zenith/elements';
import type { Client, ApiEnvelope } from '@zenith/client';
import { useAdminOptions } from '@/admin/runtime';
import { useAuth } from '@/hooks/useAuth';
import PageLoading from '@/components/PageLoading';

export const goSessionKey = contractKey(goAuthContract.me);
const unsupported = async (): Promise<never> => { throw new Error('此功能尚未迁移到 Go'); };

function OwnedGoAuthProvider({ children }: Readonly<{ children: ReactNode }>) {
  const qc = useQueryClient();
  const session = useQuery({
    queryKey: goSessionKey,
    queryFn: async ({ signal }): Promise<GoSession | null> => {
      const res = await apiRaw(goAuthContract.me, { client: goApiClient, silent: true, signal });
      if (res.code === 401) return null;
      if (res.code !== 0) throw new ApiError(res.code, res.message);
      return goAuthContract.me.response.parse(res.data);
    },
    retry: false, staleTime: 0, refetchOnWindowFocus: true,
  });
  const authenticated = useRef(false);
  const mounted = useRef(true);
  const { refetch } = session;
  authenticated.current = Boolean(session.data);
  const channel = useRef<BroadcastChannel | null>(null);

  const clearResourceCache = useCallback(async () => {
    await qc.cancelQueries();
    // Keep the mounted /me observer attached to its query. Clearing the whole
    // cache disconnects it and makes a successful login look anonymous.
    qc.removeQueries({ predicate: (query) => query.queryHash !== hashKey(goSessionKey) });
    qc.getMutationCache().clear();
  }, [qc]);

  const clearIdentity = useCallback(async () => {
    if (!mounted.current) return;
    // Identity changes invalidate every user's cached resource, not only /me.
    await clearResourceCache();
    if (!mounted.current) return;
    goTransport.clearSession();
    localStorage.removeItem(PREFERENCES_KEY);
    localStorage.removeItem(TABS_STORAGE_KEY);
    qc.setQueryData(goSessionKey, null);
  }, [qc, clearResourceCache]);

  useEffect(() => {
    mounted.current = true;
    // Remove legacy credentials during migration. Cookie state is always
    // established by /me, never inferred from these browser values.
    localStorage.removeItem(TOKEN_KEY);
    localStorage.removeItem(REFRESH_TOKEN_KEY);
    const invalidated = () => { if (authenticated.current) void clearIdentity(); };
    globalThis.addEventListener(GO_SESSION_INVALIDATED, invalidated);
    if (typeof BroadcastChannel !== 'undefined') {
      channel.current = new BroadcastChannel('zenith-go-session');
      channel.current.onmessage = () => { void clearIdentity().then(() => refetch()); };
    }
    return () => {
      mounted.current = false;
      globalThis.removeEventListener(GO_SESSION_INVALIDATED, invalidated);
      channel.current?.close();
      channel.current = null;
    };
  }, [clearIdentity, refetch]);

  const login: AuthContextValue['login'] = useCallback(async (username, password, captchaId, captchaCode, _tenantCode, options) => {
    if (options?.addAccount) return unsupported();
    const res = await loginGo({ username, password, captchaId: captchaId ?? '', captchaAnswer: captchaCode ?? '' });
    if (res.code === 0 && 'csrfToken' in res.data) {
      await clearResourceCache();
      qc.setQueryData(goSessionKey, goAuthContract.me.response.parse(res.data));
      channel.current?.postMessage('changed');
    }
    return res;
  }, [qc, clearResourceCache]);

  const resolveSessionConflict: AuthContextValue['resolveSessionConflict'] = useCallback(async (ticket) => {
    const res = await apiRaw(goAuthContract.resolveSessionConflict, { body: { ticket } }, { silent: true });
    if (res.code === 0) { await clearResourceCache(); qc.setQueryData(goSessionKey, res.data); channel.current?.postMessage('changed'); }
    return res;
  }, [qc, clearResourceCache]);
  const logout = useCallback(() => {
    void logoutGo().then(async (res) => {
      if (res.code !== 0 && res.code !== 401) throw new ApiError(res.code, res.message);
      await clearIdentity();
      channel.current?.postMessage('changed');
    }).catch((error: unknown) => showRequestErrorToast(error instanceof Error ? error.message : '退出失败，请重试'));
  }, [clearIdentity]);
  const refresh = useCallback(async () => { await refetch(); }, [refetch]);
  const value = useMemo<AuthContextValue>(() => ({
    user: session.isError ? null : session.data?.user ?? null,
    permissions: session.isError ? [] : session.data?.permissions ?? [],
    status: session.isPending ? 'checking' : session.isError ? 'unavailable' : session.data ? 'authenticated' : 'anonymous',
    loading: session.isPending, refreshing: session.isFetching, error: session.error,
    parkedAccounts: [], canAddAccount: false, impersonation: null,
    login, logout, refresh,
    updateUser: (user) => qc.setQueryData<GoSession | null>(goSessionKey, (current) => current ? { ...current, user } : current),
    verifyMfaLogin: unsupported, resolveSessionConflict, register: unsupported,
    switchAccount: unsupported, removeAccount: unsupported,
    logoutAllAccounts: async () => { const res = await logoutGo(); if (res.code !== 0 && res.code !== 401) throw new ApiError(res.code, res.message); await clearIdentity(); },
    startImpersonation: () => { throw new Error('模拟登录尚未迁移'); }, endImpersonation: unsupported,
  }), [session.data, session.isError, session.isPending, session.isFetching, session.error, login, logout, refresh, qc, clearIdentity, resolveSessionConflict]);
  return <AuthContext.Provider value={value}><PermissionContext.Provider value={value.permissions}>{children}</PermissionContext.Provider></AuthContext.Provider>;
}

/** The original admin and composable elements share one existing Cookie session. */
function ElementsBridge({ children, client }: { children: ReactNode; client: Client }) {
  const auth = useAuth();
  const options = useAdminOptions();
  const session = useMemo<ZenithSessionValue>(() => ({
    status: auth.status, error: auth.error, refreshing: auth.refreshing,
    session: auth.user ? { user: auth.user, permissions: auth.permissions, csrfToken: client.sessionHeaders()['X-CSRF-Token'] ?? '', superAdmin: auth.permissions.includes('*') } : null,
    login: input => auth.login(input.username, input.password, input.captchaId, input.captchaAnswer) as Promise<ApiEnvelope<ElementsLoginResult>>,
    resolveSessionConflict: ticket => auth.resolveSessionConflict(ticket) as Promise<ApiEnvelope<GoSession>>,
    refresh: auth.refresh, updateUser: auth.updateUser,
    logout: auth.logoutAllAccounts,
  }), [auth, client]);
  return <ZenithProvider client={client} session={session} locale={options.locale} brand={options.brand}>{children}</ZenithProvider>;
}

function HostAuthBridge({ children }: { children: ReactNode }) {
  const hostSession = useSession();
  const refreshSession = hostSession.refresh;
  const qc = useQueryClient();
  const previous = useRef<number | null>(null);
  const invalidationInFlight = useRef(false);
  const [visibleIdentity, setVisibleIdentity] = useState<number | null>(null);
  const user = hostSession.status === 'authenticated' ? hostSession.session?.user ?? null : null;
  useEffect(() => {
    if (previous.current !== (user?.id ?? null)) {
      // A host identity change invalidates every previous user's cached resource.
      void qc.cancelQueries(); qc.removeQueries(); qc.getMutationCache().clear();
      localStorage.removeItem(PREFERENCES_KEY); localStorage.removeItem(TABS_STORAGE_KEY);
      previous.current = user?.id ?? null;
      setVisibleIdentity(user?.id ?? null);
    }
    qc.setQueryData(goSessionKey, hostSession.session);
  }, [qc, user?.id, hostSession.session]);
  useEffect(() => {
    const refresh = () => {
      if (invalidationInFlight.current) return;
      invalidationInFlight.current = true;
      void refreshSession().catch((error: unknown) => showRequestErrorToast(error instanceof Error ? error.message : '会话恢复失败'))
        .finally(() => { invalidationInFlight.current = false; });
    };
    globalThis.addEventListener(GO_SESSION_INVALIDATED, refresh);
    return () => globalThis.removeEventListener(GO_SESSION_INVALIDATED, refresh);
  }, [refreshSession]);
  const value = useMemo<AuthContextValue>(() => ({
    user, permissions: user ? hostSession.session?.permissions ?? [] : [], status: hostSession.status,
    error: hostSession.error, loading: hostSession.status === 'checking', refreshing: hostSession.refreshing,
    parkedAccounts: [], canAddAccount: false, impersonation: null,
    login: (username, password, captchaId, captchaAnswer) => hostSession.login({ username, password, captchaId, captchaAnswer }),
    logout: () => { void hostSession.logout().catch((error: unknown) => showRequestErrorToast(error instanceof Error ? error.message : '退出失败，请重试')); },
    refresh: hostSession.refresh, updateUser: hostSession.updateUser,
    resolveSessionConflict: hostSession.resolveSessionConflict, logoutAllAccounts: hostSession.logout,
    verifyMfaLogin: unsupported, register: unsupported, switchAccount: unsupported, removeAccount: unsupported,
    startImpersonation: () => { throw new Error('模拟登录尚未迁移'); }, endImpersonation: unsupported,
  }), [hostSession, user]);
  return <AuthContext.Provider value={value}><PermissionContext.Provider value={value.permissions}>{visibleIdentity === (user?.id ?? null) ? children : <PageLoading />}</PermissionContext.Provider></AuthContext.Provider>;
}

export function GoAuthProvider({ children, client = goTransport, authSession }: { children: ReactNode; client?: Client; authSession?: ZenithSessionAdapter }) {
  const options = useAdminOptions();
  return authSession
    ? <ZenithProvider client={client} authSession={authSession} locale={options.locale} brand={options.brand}><HostAuthBridge>{children}</HostAuthBridge></ZenithProvider>
    : <OwnedGoAuthProvider><ElementsBridge client={client}>{children}</ElementsBridge></OwnedGoAuthProvider>;
}
