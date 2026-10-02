import { sql } from 'drizzle-orm';
import { db } from '../../../db';
import { users, aiConversations, aiMessages } from '../../../db/schema';
import logger from '../../../lib/logger';
import type { Mastra } from '@mastra/core';
import type { AiBuiltinAgent } from '@arcbase/shared/ai';

/**
 * 业务示例:编程式智能体(教学)。
 *
 * 与「智能体页面」的表单智能体不同,本示例展示如何**用代码**构建更复杂的智能体,
 * 并演示 Mastra 中 Agent 与 Workflow 的双向整合:
 *
 *   ┌ 方向一:Agent 挂 Workflow ────────────────────────────────────────────┐
 *   │ new Agent({ workflows: { weeklyReport } })                            │
 *   │ Mastra 自动把 workflow 转成 `workflow-weeklyReport` 工具,             │
 *   │ 用户对话中提出"生成运营周报"时由模型自主触发整条确定性流程。          │
 *   └───────────────────────────────────────────────────────────────────────┘
 *   ┌ 方向二:Workflow 用 Agent ────────────────────────────────────────────┐
 *   │ createWorkflow().then(collectStep).agent(summarizer, {                │
 *   │   structuredOutput: { schema } })                                     │
 *   │ 工作流中间的"总结"步骤交给 Agent 推理,并以 zod schema 约束输出,      │
 *   │ 下一步以类型安全的结构化数据继续处理。                                │
 *   └───────────────────────────────────────────────────────────────────────┘
 *
 * 设计要点(编程式智能体相对表单智能体的增量能力):
 * - 自定义 zod 工具:直接查询业务数据库(表单智能体只能勾选预置工具)
 * - 工作流编排:确定性多步流程(取数 → LLM 总结 → 格式化),可挂起恢复、Studio 可视化
 * - 结构化输出:LLM 步骤返回 typed object 而非自由文本
 *
 * 注册后:
 * - 智能体列表以「内置」形式只读展示,可直接发起对话
 * - Studio 中可调试 agent 与 workflow;可作为实验(Experiments)的评测对象
 */

/** 内置智能体元信息(智能体列表展示用) */
export const DEMO_AGENT_METAS: AiBuiltinAgent[] = [
  {
    agentId: 'biz-ops-assistant',
    name: '运营助手(编程式示例)',
    description: '代码定义的智能体示例:自定义数据工具 + 周报工作流(Agent×Workflow 双向整合)',
    avatar: '📊',
    openingMessage: '你好,我是运营助手。我可以查询系统运营快照,也可以为你生成运营周报(内部会执行一条多步工作流)。',
    suggestedQuestions: ['当前系统运营快照', '生成本周运营周报', '最近 7 天 AI 对话活跃吗?'],
  },
];

/** 查询运营快照(真实业务数据):注册用户数 / AI 对话与消息量 */
async function loadOpsSnapshot() {
  const [row] = await db
    .select({
      totalUsers: sql<number>`(select count(*) from ${users})::int`,
      totalConversations: sql<number>`(select count(*) from ${aiConversations})::int`,
      totalMessages: sql<number>`(select count(*) from ${aiMessages})::int`,
      messages7d: sql<number>`(select count(*) from ${aiMessages} where created_at >= now() - interval '7 days')::int`,
      activeUsers7d: sql<number>`(select count(distinct c.user_id) from ${aiMessages} m join ${aiConversations} c on m.conversation_id = c.id where m.created_at >= now() - interval '7 days')::int`,
    })
    .from(sql`(select 1) as _`);
  return row;
}

/** 注册示例智能体与工作流到 Mastra 实例(getMastra 初始化时调用) */
export async function registerDemoAgents(mastra: Mastra): Promise<void> {
  const [{ Agent }, { createTool }, { createWorkflow, createStep }, { z }] = await Promise.all([
    import('@mastra/core/agent'),
    import('@mastra/core/tools'),
    import('@mastra/core/workflows'),
    import('zod'),
  ]);
  const { getRawDefaultProviderConfig } = await import('../../ai/ai-providers.service');
  const { buildModelChain } = await import('../../../lib/ai/mastra-models');
  const { getChatMemory } = await import('../../../lib/mastra');

  // 编程式智能体的模型:系统默认服务商(未配置时跳过注册,不影响其他功能)
  const cfg = await getRawDefaultProviderConfig();
  if (!cfg) {
    logger.warn('[demo-agent] no default provider config, skip demo agent registration');
    return;
  }
  const model = buildModelChain([{ source: cfg, model: cfg.defaultModel, maxRetries: 1, modelSettings: cfg.modelSettings }]);

  // ── ① 自定义工具(createTool + zod):模型可按需查询真实业务数据 ──────────
  const opsSnapshotTool = createTool({
    id: 'ops_snapshot',
    description: '查询系统当前运营快照:注册用户数、AI 对话/消息总量、近 7 天消息量与活跃用户数',
    inputSchema: z.object({}),
    execute: async () => JSON.stringify(await loadOpsSnapshot()),
  });

  // ── ② 方向二:Workflow 用 Agent —— 确定性流程中嵌入"需要推理的一步" ──────
  // 内部总结 Agent:仅供 workflow 的 LLM 步骤使用(不对外注册)
  const summarizer = new Agent({
    id: 'biz-ops-summarizer',
    name: '运营数据总结器',
    instructions: '你是资深运营分析师。基于给定的运营数据 JSON 输出中文总结,突出趋势与异常,严格按要求的结构返回。',
    model,
  });

  const reportSchema = z.object({
    headline: z.string().describe('一句话总结本周运营状态'),
    highlights: z.array(z.string()).describe('2-4 条数据亮点'),
    risks: z.array(z.string()).describe('0-2 条风险或异常提示'),
  });

  const collectStep = createStep({
    id: 'collect-metrics',
    description: '收集运营指标(确定性取数,无 LLM)',
    inputSchema: z.object({}),
    outputSchema: z.object({ prompt: z.string() }),
    execute: async () => {
      const snapshot = await loadOpsSnapshot();
      // 输出 { prompt } 正好匹配 agent 步骤的默认输入(prompt: string)
      return { prompt: `请总结以下系统运营数据(JSON):\n${JSON.stringify(snapshot)}` };
    },
  });

  const formatStep = createStep({
    id: 'format-report',
    description: '把结构化总结渲染为 Markdown 周报(确定性格式化,无 LLM)',
    inputSchema: reportSchema,
    outputSchema: z.object({ markdown: z.string() }),
    execute: async ({ inputData }) => ({
      markdown: [
        `## 运营周报`,
        ``,
        `> ${inputData.headline}`,
        ``,
        `### 亮点`,
        ...inputData.highlights.map((h) => `- ${h}`),
        ...(inputData.risks.length > 0 ? ['', '### 风险提示', ...inputData.risks.map((r) => `- ⚠️ ${r}`)] : []),
      ].join('\n'),
    }),
  });

  const weeklyReportWorkflow = createWorkflow({
    id: 'biz-weekly-report',
    description: '生成系统运营周报:取数(step) → LLM 结构化总结(agent step) → Markdown 渲染(step)',
    inputSchema: z.object({}),
    outputSchema: z.object({ markdown: z.string() }),
  })
    .then(collectStep)
    // Agent 作为 workflow 步骤:structuredOutput 约束返回 reportSchema,类型安全地链到下一步
    .agent(summarizer as never, { structuredOutput: { schema: reportSchema } })
    .then(formatStep)
    .commit();

  // ── ① 方向一:Agent 挂 Workflow —— 开放对话中由模型自主调度确定性流程 ────
  const opsAssistant = new Agent({
    id: 'biz-ops-assistant',
    name: '运营助手(编程式示例)',
    description: '查询系统运营快照;支持生成运营周报(触发 biz-weekly-report 工作流)',
    instructions: [
      '你是系统运营助手。',
      '- 用户询问当前数据/快照/活跃度时,调用 ops_snapshot 工具并基于结果回答;',
      '- 用户要求生成运营周报时,调用 workflow-weeklyReport 工具执行完整周报流程,并把返回的 markdown 原样输出;',
      '- 其他问题正常回答,不要编造数据。',
    ].join('\n'),
    model,
    tools: { ops_snapshot: opsSnapshotTool },
    // workflows 配置:Mastra 自动转换为 `workflow-weeklyReport` 工具供模型调用
    workflows: { weeklyReport: weeklyReportWorkflow as never },
    memory: (() => getChatMemory()) as never,
  });

  mastra.addWorkflow(weeklyReportWorkflow as never, 'biz-weekly-report');
  mastra.addAgent(opsAssistant as never, 'biz-ops-assistant');
  logger.info('[demo-agent] registered biz-ops-assistant + biz-weekly-report workflow');
}
