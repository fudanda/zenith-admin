import { authContract } from '@arcbase/shared/identity';
import { contractKey, useApiMutation, useApiQuery } from '@/lib/contract-query';
import { useSignatureClient } from '@/components/signature/SignatureClientContext';

export const personalSignatureKey = contractKey(authContract.mySignature);

export function useMySignature(enabled = true) {
  const client = useSignatureClient();
  return useApiQuery(authContract.mySignature, {
    enabled, staleTime: 30_000, gcTime: 60_000, requestOptions: { client, silent: true },
  });
}

export function useSaveMySignature() {
  const client = useSignatureClient();
  return useApiMutation(authContract.saveMySignature, {
    requestOptions: { client },
    // 读写同一私有实体、同一返回形状，更新后所有签名选择器立即使用新版本。
    invalidate: (qc, saved) => qc.setQueryData(personalSignatureKey, saved),
  });
}

export function useDeleteMySignature() {
  const client = useSignatureClient();
  return useApiMutation(authContract.deleteMySignature, {
    requestOptions: { client },
    invalidate: (qc) => qc.setQueryData(personalSignatureKey, null),
  });
}
