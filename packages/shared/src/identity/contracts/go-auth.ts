import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

/** First-release Go session shape. It is intentionally separate from legacy JWT auth. */
export const goSessionUserSchema = z.object({
  id: z.int(),
  username: z.string(),
  nickname: z.string(),
  tenantId: z.int().nullable(),
  status: z.enum(['enabled', 'disabled']),
  email: z.string().nullable(),
  preferences: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const goSessionSchema = z.object({
  user: goSessionUserSchema,
  permissions: z.array(z.string()),
  csrfToken: z.string().min(1),
  tenantViewId: z.int().nullable(),
  superAdmin: z.boolean(),
});

export type GoSession = z.infer<typeof goSessionSchema>;

export const goAuthContract = defineContract('/api/v1/auth', {
  captcha: op.get('/captcha', {
    public: true,
    response: z.object({ captchaId: z.string(), image: z.string() }),
    summary: '获取 Go 登录验证码',
  }),
  login: op.post('/login', {
    public: true,
    body: z.object({
      username: z.string().min(1),
      password: z.string().min(1),
      tenantCode: z.string().optional(),
      captchaId: z.string().min(1),
      captchaAnswer: z.string().min(1),
    }),
    response: goSessionSchema,
    summary: 'Go 密码登录并创建 Cookie 会话',
  }),
  me: op.get('/me', { access: 'authenticated', response: goSessionSchema, summary: '恢复 Go Cookie 会话' }),
  logout: op.post('/logout', { access: 'authenticated', summary: '退出 Go Cookie 会话' }),
}, { tags: ['Go auth'] });
