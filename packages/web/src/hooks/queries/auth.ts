import { queryOptions, type QueryClient } from '@tanstack/react-query';
import { authContract, goAuthContract, type GoSession, type User } from '@arcbase/shared/identity';
import { IS_GO_FOUNDATION } from '@/lib/foundation-mode';
import { api, contractKey } from '@/lib/contract-query';
import { ApiError, LOOKUP_STALE_TIME } from '@/lib/query';

export interface AuthSession {
  user: User;
  permissions: string[];
}

export class AuthRejectedError extends ApiError {
  constructor(message = '登录状态已失效') {
    super(401, message);
    this.name = 'AuthRejectedError';
  }
}

export const authKeys = {
  all: ['auth'] as const,
  me: ['auth', 'me'] as const,
};

export function authSessionQueryOptions() {
  return queryOptions({
    queryKey: authKeys.me,
    queryFn: async ({ signal }): Promise<AuthSession> => {
      try {
        const { permissions, ...user } = await api(authContract.me, { silent: true, signal });
        return { user, permissions: permissions ?? [] };
      } catch (err) {
        // 401 单独成类：消费方据此区分「登录态失效」与其它接口错误
        if (err instanceof ApiError && err.code === 401) throw new AuthRejectedError(err.message);
        throw err;
      }
    },
    staleTime: LOOKUP_STALE_TIME,
    retry: false,
    refetchOnWindowFocus: true,
  });
}

export function updateCachedAuthUser(queryClient: QueryClient, user: User): void {
  if (IS_GO_FOUNDATION) {
    queryClient.setQueryData<GoSession | null>(contractKey(goAuthContract.me), current => current?.user.id === user.id ? { ...current, user } : current);
    return;
  }
  queryClient.setQueryData<AuthSession>(authKeys.me, (current) => {
    if (!current || current.user.id !== user.id) return current;
    return { ...current, user };
  });
}
