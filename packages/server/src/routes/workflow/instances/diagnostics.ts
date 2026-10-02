// ─── 运行时诊断/轨迹/令牌视图/诊断包 ───
import { workflowInstanceOpsContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../../lib/contract-route';
import { okBody } from '../../../lib/openapi-schemas';
import { getInstanceRuntimeDiagnostics, getInstanceTrace, getInstanceExecutionTokens, exportInstanceDiagnosticBundle } from '../../../services/workflow/workflow-instances.service';

export const diagnosticsRoute = defineContractRoute(workflowInstanceOpsContract.diagnostics, {
  handler: async (c) => c.json(okBody(await getInstanceRuntimeDiagnostics(c.req.valid('param').id)), 200),
});

export const traceRoute = defineContractRoute(workflowInstanceOpsContract.trace, {
  handler: async (c) => c.json(okBody(await getInstanceTrace(c.req.valid('param').id)), 200),
});

export const tokensRoute = defineContractRoute(workflowInstanceOpsContract.tokens, {
  handler: async (c) => c.json(okBody(await getInstanceExecutionTokens(c.req.valid('param').id)), 200),
});

export const diagnosticBundleRoute = defineContractRoute(workflowInstanceOpsContract.diagnosticBundle, {
  handler: async (c) => c.json(okBody(await exportInstanceDiagnosticBundle(c.req.valid('param').id)), 200),
});
