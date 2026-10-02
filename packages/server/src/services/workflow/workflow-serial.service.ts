/**
 * 业务编号 / 流水号生成
 *
 * 每个流程定义 + 周期键维护一个自增序列，通过 INSERT ... ON CONFLICT DO UPDATE 原子自增，
 * 在发起事务内调用，确保并发下编号唯一、连续。
 *
 * 计数器仅存储「原始 1-based 序数」，序号起始值 / 步长 / 前后缀 / 日期 / 模板占位符等
 * 展示规则全部委托给 `@arcbase/shared` 的 `renderWorkflowSerialNo` 纯函数（前后端共用，杜绝漂移）。
 */
import { sql } from 'drizzle-orm';
import dayjs from 'dayjs';
import { workflowSerialCounters } from '../../db/schema';
import type { DbTransaction } from '../../db/types';
import type { WorkflowSerialNoConfig, WorkflowSerialVars } from '@arcbase/shared/workflow';
import { renderWorkflowSerialNo, resolveSerialPeriodKey } from '@arcbase/shared/workflow';

/** 生成业务编号所需的上下文（动态变量 / 表单数据 / 生成时刻） */
export interface SerialNoGenContext {
  /** 动态变量（部门 / 发起人 / 租户），仅 template 模式引用时需要 */
  vars?: WorkflowSerialVars;
  /** 表单数据，用于 `{FORM.字段}` 占位符 */
  formData?: Record<string, unknown>;
  /** 生成时刻，默认当前时间（便于测试） */
  now?: Date;
}

/**
 * 生成业务编号；config 未启用时返回 null。
 * 必须在事务内调用以保证原子自增。
 */
export async function generateSerialNo(
  tx: DbTransaction,
  definitionId: number,
  config: WorkflowSerialNoConfig | undefined | null,
  ctx?: SerialNoGenContext,
): Promise<string | null> {
  if (!config?.enabled) return null;
  const now = dayjs(ctx?.now);
  const formatDate = (pattern: string) => now.format(pattern);
  const periodKey = resolveSerialPeriodKey(config.resetPeriod ?? 'never', formatDate);
  const [row] = await tx
    .insert(workflowSerialCounters)
    .values({ definitionId, periodKey, seq: 1 })
    .onConflictDoUpdate({
      target: [workflowSerialCounters.definitionId, workflowSerialCounters.periodKey],
      set: { seq: sql`${workflowSerialCounters.seq} + 1` },
    })
    .returning({ seq: workflowSerialCounters.seq });
  return renderWorkflowSerialNo(config, {
    ordinal: row.seq,
    formatDate,
    vars: ctx?.vars,
    formData: ctx?.formData,
  });
}
