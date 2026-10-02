import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { AI_EVAL_EXPERIMENT_STATUSES } from '../constants';
import { addAiEvalItemsSchema, createAiEvalDatasetSchema, runAiExperimentSchema, updateAiEvalDatasetSchema } from '../validation';

// ─── 实体（Mastra Datasets + Experiments 的视图） ────────────────────────────

/** 评测数据集(Mastra dataset 包装视图) */
export const aiEvalDatasetSchema = z.object({
  id: z.string().meta({ description: 'Mastra dataset ID(UUID)' }),
  name: z.string(),
  description: z.string().nullable(),
  itemCount: z.int(),
  version: z.int().meta({ description: '当前版本号(每次条目变更递增,可回放)' }),
  createdAt: z.string(),
  updatedAt: z.string(),
}).meta({ id: 'AiEvalDataset' });

export type AiEvalDataset = z.infer<typeof aiEvalDatasetSchema>;

/** 数据集条目:input 为提问文本,groundTruth 为期望要点(可选) */
export const aiEvalDatasetItemSchema = z.object({
  id: z.string(),
  input: z.string().meta({ description: '评测问题' }),
  groundTruth: z.string().nullable().meta({ description: '期望要点' }),
}).meta({ id: 'AiEvalDatasetItem' });

export type AiEvalDatasetItem = z.infer<typeof aiEvalDatasetItemSchema>;

/** 实验(评测运行):对数据集全量条目执行注册的目标智能体并打分 */
export const aiEvalExperimentSchema = z.object({
  id: z.string(),
  name: z.string(),
  datasetId: z.string(),
  targetId: z.string().meta({ description: '目标 Mastra agent ID(agent-{id} / arcbase-chat / 内置智能体)' }),
  status: z.enum(AI_EVAL_EXPERIMENT_STATUSES),
  totalCount: z.int(),
  succeededCount: z.int(),
  failedCount: z.int(),
  avgScores: z.record(z.string(), z.number()).nullable().meta({ description: '各 scorer 平均分(0-1)' }),
  createdAt: z.string(),
}).meta({ id: 'AiEvalExperiment' });

export type AiEvalExperiment = z.infer<typeof aiEvalExperimentSchema>;

/** 实验单条结果 */
export const aiEvalExperimentResultSchema = z.object({
  itemId: z.string(),
  input: z.string(),
  groundTruth: z.string().nullable(),
  output: z.string().meta({ description: '模型输出' }),
  scores: z.record(z.string(), z.number()).meta({ description: '各打分器得分(0-1)' }),
  reasons: z.record(z.string(), z.string()).meta({ description: 'LLM 评审理由(按 scorerId,code 类打分器无理由)' }),
  error: z.string().nullable(),
}).meta({ id: 'AiEvalExperimentResult' });

export type AiEvalExperimentResult = z.infer<typeof aiEvalExperimentResultSchema>;

export const aiEvalExperimentStartedSchema = z.object({
  experimentId: z.string(),
  name: z.string(),
}).meta({ id: 'AiEvalExperimentStarted' });

export type AiEvalExperimentStarted = z.infer<typeof aiEvalExperimentStartedSchema>;

export const aiEvalExperimentDetailSchema = z.object({
  experiment: aiEvalExperimentSchema,
  results: z.array(aiEvalExperimentResultSchema),
}).meta({ id: 'AiEvalExperimentDetail' });

export type AiEvalExperimentDetail = z.infer<typeof aiEvalExperimentDetailSchema>;

// ─── 路径参数（Mastra ID 为字符串） ──────────────────────────────────────────

export const aiEvalDatasetIdParam = z.object({
  id: z.string().min(1).meta({ description: '评测集 ID', example: 'ds-uuid' }),
});

export const aiEvalItemParams = aiEvalDatasetIdParam.extend({
  itemId: z.string().min(1).meta({ description: '条目 ID', example: 'item-uuid' }),
});

export const aiEvalExperimentParams = aiEvalDatasetIdParam.extend({
  experimentId: z.string().min(1).meta({ description: '实验 ID', example: 'exp-uuid' }),
});

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const aiEvalContract = defineContract('/api/ai/eval', {
  list: op.get('/', { access: { permission: 'ai:eval:list' }, response: z.array(aiEvalDatasetSchema), summary: '评测数据集列表(Mastra Datasets)' }),
  create: op.post('/', { access: { permission: 'ai:eval:manage' }, body: createAiEvalDatasetSchema, response: aiEvalDatasetSchema, summary: '创建评测数据集' }),
  update: op.put('/{id}', { access: { permission: 'ai:eval:manage' }, params: aiEvalDatasetIdParam, body: updateAiEvalDatasetSchema, response: aiEvalDatasetSchema, summary: '更新评测数据集' }),
  remove: op.delete('/{id}', { access: { permission: 'ai:eval:manage' }, params: aiEvalDatasetIdParam, summary: '删除评测数据集' }),
  items: op.get('/{id}/items', { access: { permission: 'ai:eval:list' }, params: aiEvalDatasetIdParam, response: z.array(aiEvalDatasetItemSchema), summary: '数据集条目列表' }),
  addItems: op.post('/{id}/items', { access: { permission: 'ai:eval:manage' }, params: aiEvalDatasetIdParam, body: addAiEvalItemsSchema, response: z.array(aiEvalDatasetItemSchema), summary: '批量添加数据集条目' }),
  removeItem: op.delete('/{id}/items/{itemId}', { access: { permission: 'ai:eval:manage' }, params: aiEvalItemParams, summary: '删除数据集条目' }),
  runExperiment: op.post('/{id}/experiments', { access: { permission: 'ai:eval:manage' }, audit: '发起评测实验', params: aiEvalDatasetIdParam, body: runAiExperimentSchema, response: aiEvalExperimentStartedSchema, summary: '发起实验(异步执行,经实验列表轮询状态)' }),
  experiments: op.get('/{id}/experiments', { access: { permission: 'ai:eval:list' }, params: aiEvalDatasetIdParam, response: z.array(aiEvalExperimentSchema), summary: '实验列表(含各打分器平均分,可横向对比)' }),
  experimentDetail: op.get('/{id}/experiments/{experimentId}', { access: { permission: 'ai:eval:list' }, params: aiEvalExperimentParams, response: aiEvalExperimentDetailSchema, summary: '实验详情与逐条结果' }),
}, { auditModule: '智能助手', tags: ['AI'] });
