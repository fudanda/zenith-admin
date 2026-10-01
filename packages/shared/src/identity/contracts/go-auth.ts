import * as z from 'zod';
import { defineContract, op } from '../../core/contract';
import { preferencePolicySchema } from '../../preferences/validation';
import { loginCaptchaChallengeSchema, sessionConflictSchema } from './auth';
import { userSchema } from './users';

/** First-release Go session shape. It is intentionally separate from legacy JWT auth. */
export const goSessionUserSchema = userSchema.omit({ tenantId: true, tenantName: true, viewingTenantId: true, impersonation: true }).extend({
  preferences: z.record(z.string(), z.unknown()).nullable().optional(),
});

export const goSessionSchema = z.object({
  user: goSessionUserSchema,
  permissions: z.array(z.string()),
  csrfToken: z.string().min(1),
  superAdmin: z.boolean(),
});

export type GoSession = z.infer<typeof goSessionSchema>;

export const goAuthContract = defineContract('/api/v1/auth', {
  captcha: op.get('/captcha', {
    public: true,
    response: z.object({ enabled: z.boolean(), captchaId: z.string(), image: z.string() }),
    summary: '获取 Go 登录验证码',
  }),
  login: op.post('/login', {
    public: true,
    body: z.object({
      username: z.string().min(1),
      password: z.string().min(1),
      captchaId: z.string().optional(),
      captchaAnswer: z.string().optional(),
    }),
    response: z.union([goSessionSchema, loginCaptchaChallengeSchema, sessionConflictSchema]),
    summary: 'Go 密码登录并创建 Cookie 会话',
  }),
  resolveSessionConflict: op.post('/session-conflict/resolve', { public: true, body: z.object({ ticket: z.string().min(1) }), response: goSessionSchema, summary: '下线其它设备并创建 Cookie 会话' }),
  me: op.get('/me', { access: 'authenticated', response: goSessionSchema, summary: '恢复 Go Cookie 会话' }),
  logout: op.post('/logout', { access: 'authenticated', summary: '退出 Go Cookie 会话' }),
  preferencePolicy: op.get('/preference-policy', { access: 'authenticated', response: preferencePolicySchema, summary: '首版界面偏好策略' }),
}, { tags: ['Go auth'] });
