import { desc, eq } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowBusinessContext, WorkflowBusinessPreview, WorkflowFlowData } from '@arcbase/shared/workflow';
import { db } from '../../db';
import { workflowDefinitions, workflowInstances } from '../../db/schema';
import { currentUser } from '../../lib/context';
import { tenantCondition } from '../../lib/tenant';
import { buildWhere } from '../../lib/where-helpers';
import { requireRow } from '../../lib/db-assert';
import { formatDateTime } from '../../lib/datetime';
import { getBusinessInstanceDetail, getInstanceDetail } from './instances/queries';
import { requireVisibleInstance } from './instances/shared';
import { sanitizeSnapshotFlowData } from './instances/mapping';
import { previewFlowData } from './workflow-preview.service';
import { assertWorkflowInitiatorScope } from './workflow-launch-access';

/** 业务域完成对象权限校验后调用；从业务确定的定义预览，不接受任意定义的公开查询。 */
export async function previewBusinessWorkflow(definitionId: number, variables: Record<string, unknown>): Promise<WorkflowBusinessPreview> {
  const [def] = await db.select().from(workflowDefinitions).where(buildWhere(
    eq(workflowDefinitions.id, definitionId), eq(workflowDefinitions.status, 'published'),
    eq(workflowDefinitions.formType, 'external'), tenantCondition(workflowDefinitions, currentUser()),
  )).limit(1);
  requireRow(def, '业务审批流程不存在或未发布');
  await assertWorkflowInitiatorScope(def);
  const flowData = def.flowData as WorkflowFlowData | null;
  if (!flowData?.nodes.length) throw new HTTPException(400, { message: '流程未配置，无法预览' });
  return {
    definition: { id: def.id, name: def.name, description: def.description, version: def.version, flowData: sanitizeSnapshotFlowData(flowData) },
    nodes: await previewFlowData(flowData, variables),
  };
}

/** 用精确实例授权审批资料；重提之后也保留该轮参与者的访问，不依赖业务表当前实例指针。 */
export async function requireBusinessApprovalInstance(instanceId: number, bizType: string, bizId: string) {
  const instance = await requireVisibleInstance(instanceId);
  if (instance.bizType !== bizType || instance.bizId !== bizId) {
    throw new HTTPException(404, { message: '该审批实例不属于当前业务记录' });
  }
  return getInstanceDetail(instanceId);
}

/** 业务 Service 先授权本域记录，再按同一业务键加载实例；返回值只用于流程信息展示。 */
export async function getBusinessWorkflowContext(
  bizType: string, bizId: string, currentInstanceId: number | null | 'latest', selectedInstanceId?: number,
): Promise<WorkflowBusinessContext> {
  const rows = await db.select({ id: workflowInstances.id, title: workflowInstances.title,
    status: workflowInstances.status, createdAt: workflowInstances.createdAt,
    definitionName: workflowDefinitions.name,
  }).from(workflowInstances).leftJoin(workflowDefinitions, eq(workflowDefinitions.id, workflowInstances.definitionId))
    .where(buildWhere(eq(workflowInstances.bizType, bizType), eq(workflowInstances.bizId, bizId), tenantCondition(workflowInstances, currentUser())))
    .orderBy(desc(workflowInstances.id));
  const id = selectedInstanceId ?? (currentInstanceId === 'latest' ? rows[0]?.id : currentInstanceId);
  if (id != null && !rows.some((r) => r.id === id)) throw new HTTPException(404, { message: '该审批实例不属于当前业务记录' });
  return {
    instance: id == null ? null : await getBusinessInstanceDetail(id, bizType, bizId),
    previousInstances: rows.map((row) => ({ ...row, createdAt: formatDateTime(row.createdAt) })),
  };
}
