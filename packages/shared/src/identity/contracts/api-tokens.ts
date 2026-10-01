import * as z from 'zod';
import { idParam } from '../../core/api-schemas';
import { defineContract, op } from '../../core/contract';
import { createApiTokenSchema } from '../validation';

// ─── 实体 ────────────────────────────────────────────────────────────────────

/** 个人访问令牌（列表项只含前缀，完整 token 仅创建时返回一次） */
export const userApiTokenSchema = z.object({
  id: z.int(),
  name: z.string(),
  tokenPrefix: z.string(),
  permissions: z.array(z.string()).optional(),
  lastUsedAt: z.string().nullable(),
  expiresAt: z.string().nullable(),
  createdAt: z.string(),
}).meta({ id: 'UserApiToken' });

export type UserApiToken = z.infer<typeof userApiTokenSchema>;

export const userApiTokenCreatedSchema = z.object({
  id: z.int(),
  name: z.string(),
  token: z.string().meta({ description: '完整 token，仅创建时返回' }),
  createdAt: z.string(),
}).meta({ id: 'UserApiTokenCreated' });

export type UserApiTokenCreated = z.infer<typeof userApiTokenCreatedSchema>;

// ─── 契约 ────────────────────────────────────────────────────────────────────

export const apiTokenContract = defineContract('/api/api-tokens', {
  list: op.get('/', { access: 'authenticated', response: z.array(userApiTokenSchema), summary: '获取我的 API Token 列表' }),
  create: op.post('/', { access: 'authenticated', audit: { description: '创建 API Key', recordBody: false }, body: createApiTokenSchema, response: userApiTokenCreatedSchema, summary: '创建 API Token（完整 token 仅返回一次）' }),
  remove: op.delete('/{id}', { access: 'authenticated', audit: { description: '撤销 API Key', recordBody: false }, params: idParam, summary: '撤销 API Token' }),
}, { tags: ['ApiTokens'], auditModule: 'API Key' });
