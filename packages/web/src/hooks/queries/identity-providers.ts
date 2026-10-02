import { identityProviderContract } from '@arcbase/shared/identity';
import { createResourceQueries, useApiMutation } from '@/lib/contract-query';
import { useAllTenants } from './tenants';

export const {
  keys: identityProviderKeys,
  useList: useIdentityProviderList,
  useDetail: useIdentityProviderDetail,
  useSave: useSaveIdentityProvider,
  useDelete: useDeleteIdentityProviders,
} = createResourceQueries(identityProviderContract);

/**
 * 身份源配置页的租户下拉——直接复用 tenants 域的共享 lookup，
 * 避免同一端点在两个 key 下各存一份（租户切换器常驻 AdminLayout，会同时在线）。
 */
export function useIdentityProviderTenants(options?: { enabled?: boolean }) {
  return useAllTenants(options?.enabled ?? true);
}

/** 连接测试 / 目录搜索 / 目录同步都是即时诊断动作，结果只在弹窗内展示，不失效任何缓存 */
export function useTestIdentityProviderConnection() {
  return useApiMutation(identityProviderContract.test, { requestOptions: { silent: true } });
}

export function useSearchLdapDirectoryUsers() {
  return useApiMutation(identityProviderContract.ldapUsers, { requestOptions: { silent: true } });
}

export function useSyncIdentityProviderDirectory() {
  return useApiMutation(identityProviderContract.sync, { requestOptions: { silent: true } });
}
