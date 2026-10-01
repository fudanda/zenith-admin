import { callRaw, ApiError, type Client, type ApiEnvelope } from '@zenith/client';
import { goAuthContract, type GoSession } from '@zenith/shared/identity';
import type { InputOf, OutputOf } from '@zenith/shared/core';

export type LoginInput = InputOf<typeof goAuthContract.login>['body'];
export type LoginResult = OutputOf<typeof goAuthContract.login>;
export type SessionStatus = 'checking' | 'authenticated' | 'anonymous' | 'unavailable';
export interface SessionSnapshot {
  status: SessionStatus;
  session: GoSession | null;
  error: Error | null;
  refreshing: boolean;
}
export interface SessionActions {
  login(input: LoginInput): Promise<ApiEnvelope<LoginResult>>;
  resolveSessionConflict(ticket: string): Promise<ApiEnvelope<GoSession>>;
  logout(): Promise<void>;
  refresh(): Promise<void>;
  updateUser(user: GoSession['user']): void;
}
export interface ZenithSessionAdapter extends SessionActions {
  getSnapshot(): SessionSnapshot;
  subscribe(listener: () => void): () => void;
}
export type ZenithSessionValue = SessionSnapshot & SessionActions;

/** In-memory Cookie session. The server remains the identity/permission authority. */
export function createCookieSession(client: Client): ZenithSessionAdapter & { dispose(): void } {
  let snapshot: SessionSnapshot = { status: 'checking', session: null, error: null, refreshing: false };
  const listeners = new Set<() => void>();
  const requests = new Set<AbortController>();
  let revision = 0;
  const publish = (next: SessionSnapshot) => { snapshot = next; for (const listener of listeners) listener(); };
  const accept = (session: GoSession | null) => {
    client.setCsrfToken(session?.csrfToken ?? null);
    publish({ status: session ? 'authenticated' : 'anonymous', session, error: null, refreshing: false });
  };
  const invalidated = client.subscribeUnauthorized(() => { revision++; accept(null); });
  const run = async <T,>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> => {
    const controller = new AbortController(); requests.add(controller);
    try { return await fn(controller.signal); } finally { requests.delete(controller); }
  };
  const adapter = {
    getSnapshot: () => snapshot,
    subscribe: (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; },
    async refresh() {
      const current = ++revision;
      publish({ ...snapshot, refreshing: true });
      try {
        const result = await run(signal => callRaw(client, goAuthContract.me, undefined, { signal }));
        // A 401 from this request already invalidated its revision.
        if (result.code === 401) { if (current === revision) accept(null); return; }
        if (current !== revision) return;
        if (result.code !== 0) throw new ApiError(result.code, result.message);
        accept(result.data);
      } catch (error) {
        if (current !== revision) return;
        client.clearSession();
        publish({ status: 'unavailable', session: null, refreshing: false, error: error instanceof Error ? error : new Error(String(error)) });
      }
    },
    async login(input: LoginInput) {
      const current = ++revision;
      const result = await run(signal => callRaw(client, goAuthContract.login, { body: input }, { signal }));
      if (current !== revision) throw new DOMException('Session changed', 'AbortError');
      if (current === revision && result.code === 0 && 'csrfToken' in result.data) accept(result.data);
      return result;
    },
    async resolveSessionConflict(ticket: string) {
      const current = ++revision;
      const result = await run(signal => callRaw(client, goAuthContract.resolveSessionConflict, { body: { ticket } }, { signal }));
      if (current !== revision) throw new DOMException('Session changed', 'AbortError');
      if (current === revision && result.code === 0) accept(result.data);
      return result;
    },
    async logout() {
      const current = ++revision;
      const result = await run(signal => callRaw(client, goAuthContract.logout, undefined, { signal }));
      if (result.code !== 0 && result.code !== 401) throw new ApiError(result.code, result.message);
      if (current === revision) accept(null);
    },
    updateUser(user: GoSession['user']) {
      if (snapshot.session) publish({ ...snapshot, session: { ...snapshot.session, user } });
    },
    dispose() {
      revision++; for (const controller of requests) controller.abort(); requests.clear();
      invalidated(); listeners.clear();
      // Unmount does not revoke the server Cookie or clear a host-owned client.
    },
  };
  return adapter;
}
