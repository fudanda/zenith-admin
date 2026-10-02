import { oauthConfigContract, type OAuthConfig } from '@arcbase/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { mockDateTime } from '@/mocks/utils/date';

const mockConfigs: OAuthConfig[] = [
  { id: 1, provider: 'github', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, autoLinkByEmail: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 2, provider: 'dingtalk', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, autoLinkByEmail: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 3, provider: 'wechat_work', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, autoLinkByEmail: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
  { id: 4, provider: 'feishu', clientId: '', clientSecret: '', agentId: null, corpId: null, enabled: false, autoLinkByEmail: false, createdAt: '2025-01-01 00:00:00', updatedAt: '2025-01-01 00:00:00' },
];

export const oauthConfigHandlers = [
  mock(oauthConfigContract.list, ({ ok }) => {
    return ok(mockConfigs, 'success');
  }),

  mock(oauthConfigContract.update, ({ params, body, ok }) => {
    const config = mockConfigs.find((c) => c.provider === params.provider);
    if (config) {
      Object.assign(config, body, { updatedAt: mockDateTime() });
    }
    return ok(config ?? null, '保存成功');
  }),
];
