import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ApiError, authApi, type Session } from '@zenith/admin-client';

const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, refetchOnWindowFocus: false } } });
interface AuthState { session: Session | null; loading: boolean; error: string; login: (input: Parameters<typeof authApi.login>[0]) => Promise<void>; logout: () => Promise<void>; refresh: () => Promise<void>; invalidate: () => void; can: (permission: string) => boolean }
const AuthContext = createContext<AuthState | null>(null);

export function Providers({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => { let mounted = true; authApi.me().then(value => { if (mounted) setSession(value); }).catch(reason => {
    if (mounted && (!(reason instanceof ApiError) || reason.status !== 401)) setError(String(reason));
  }).finally(() => { if (mounted) setLoading(false); }); return () => { mounted = false; }; }, []);
  const login = async (input: Parameters<typeof authApi.login>[0]) => { setSession(await authApi.login(input)); setError(''); };
  const logout = async () => { await authApi.logout(); setSession(null); queryClient.clear(); };
  const refresh = async () => { setSession(await authApi.me()); };
  const invalidate = () => { setSession(null); queryClient.clear(); };
  useEffect(() => { document.body.setAttribute('theme-mode', session?.user.preferences?.theme === 'dark' ? 'dark' : 'light'); }, [session?.user.preferences?.theme]);
  const can = (permission: string) => permission === 'authenticated' ? !!session : permission === 'platform' ? !!session?.superAdmin : !!session?.superAdmin || !!session?.permissions?.includes(permission);
  return <QueryClientProvider client={queryClient}><AuthContext.Provider value={{ session, loading, error, login, logout, refresh, invalidate, can }}>{children}</AuthContext.Provider></QueryClientProvider>;
}
export function useAuth() { const context = useContext(AuthContext); if (!context) throw new Error('Auth provider missing'); return context; }
