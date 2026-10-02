import { keepPreviousData, type QueryClient } from '@tanstack/react-query';
import type { InputOf, QueryOf } from '@arcbase/shared/core';
import {
  deployReleaseContract,
  deployRunContract,
  deployTargetContract,
} from '@arcbase/shared/ops';
import { contractKey, useApiMutation, useApiQuery, useSaveMutation } from '@/lib/contract-query';

export type DeployTargetListParams = NonNullable<QueryOf<typeof deployTargetContract.list>>;
export type DeployRunListParams = NonNullable<QueryOf<typeof deployRunContract.list>>;
export type DeployRunLogParams = NonNullable<QueryOf<typeof deployRunContract.logs>>;
export type DeployReleaseListParams = NonNullable<QueryOf<typeof deployReleaseContract.list>>;

export const deployKeys = {
  targets: contractKey(deployTargetContract.list),
  target: (id: number | undefined) => contractKey(deployTargetContract.detail, { params: { id: id ?? 0 } }),
  runs: contractKey(deployRunContract.list),
  run: (id: number | undefined) => contractKey(deployRunContract.detail, { params: { id: id ?? 0 } }),
  logs: (id: number | undefined, query: DeployRunLogParams) => contractKey(deployRunContract.logs, { params: { id: id ?? 0 }, query }),
  releases: contractKey(deployReleaseContract.list),
};

export function useDeployTargetList(params: DeployTargetListParams = {}, enabled = true) {
  return useApiQuery(deployTargetContract.list, { query: params }, { enabled });
}

export function useDeployTargetDetail(id: number | undefined, enabled = true) {
  return useApiQuery(deployTargetContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useSaveDeployTarget() {
  return useSaveMutation(deployTargetContract.create, deployTargetContract.update, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: deployKeys.targets });
    },
  });
}

export function useDeleteDeployTarget() {
  return useApiMutation(deployTargetContract.remove, {
    invalidate: (qc, _output, variables) => {
      qc.removeQueries({ queryKey: deployKeys.target(variables.params.id) });
      void qc.invalidateQueries({ queryKey: deployKeys.targets });
    },
  });
}

export function useSyncDeployTarget() {
  return useApiMutation(deployTargetContract.sync, {
    invalidate: (qc, output, variables) => {
      qc.setQueryData(deployKeys.target(variables.params.id), output.target);
      void qc.invalidateQueries({ queryKey: deployKeys.targets });
      void qc.invalidateQueries({ queryKey: deployKeys.releases });
    },
  });
}

export function useDeployRunList(params: DeployRunListParams, enabled = true) {
  return useApiQuery(deployRunContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDeployRunDetail(id: number | undefined, enabled = true) {
  return useApiQuery(deployRunContract.detail, { params: { id: id ?? 0 } }, { enabled: enabled && id !== undefined });
}

export function useDeployRunLogs(id: number | undefined, query: DeployRunLogParams, enabled = true) {
  return useApiQuery(deployRunContract.logs, { params: { id: id ?? 0 }, query }, { placeholderData: keepPreviousData, enabled: enabled && id !== undefined, refetchInterval: enabled && id !== undefined ? 1500 : false });
}

export function useCreateDeployRun() {
  return useApiMutation(deployRunContract.create, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: deployKeys.runs });
      void qc.invalidateQueries({ queryKey: deployKeys.targets });
    },
  });
}

export function useRetryDeployRun() {
  return useApiMutation(deployRunContract.retry, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: deployKeys.runs });
      void qc.invalidateQueries({ queryKey: deployKeys.targets });
    },
  });
}

export function useCancelDeployRun() {
  return useApiMutation(deployRunContract.cancel, {
    invalidate: (qc, _output, variables) => {
      void qc.invalidateQueries({ queryKey: deployKeys.runs });
      void qc.invalidateQueries({ queryKey: deployKeys.run(variables.params.id) });
    },
  });
}

export function useDeployReleaseList(params: DeployReleaseListParams, enabled = true) {
  return useApiQuery(deployReleaseContract.list, { query: params }, { placeholderData: keepPreviousData, enabled });
}

export function useDeleteDeployRelease() {
  return useApiMutation(deployReleaseContract.remove, {
    invalidate: (qc) => {
      void qc.invalidateQueries({ queryKey: deployKeys.releases });
      void qc.invalidateQueries({ queryKey: deployKeys.targets });
    },
  });
}

/** 部署日志 / run 完成的 WS 消息触发精确失效；轮询仍是刷新兜底 */
export function invalidateDeployRun(qc: QueryClient, runId: number) {
  void qc.invalidateQueries({ queryKey: deployKeys.runs });
  void qc.invalidateQueries({ queryKey: deployKeys.run(runId) });
  void qc.invalidateQueries({ queryKey: deployKeys.releases });
  void qc.invalidateQueries({ queryKey: deployKeys.targets });
}

export type CreateDeployTargetValues = InputOf<typeof deployTargetContract.create>['body'];
