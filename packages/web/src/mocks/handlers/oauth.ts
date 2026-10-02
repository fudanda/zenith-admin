import { OAUTH_PROVIDERS, oauthContract } from '@arcbase/shared/identity';
import { mock } from '@/mocks/utils/contract';

export const oauthHandlers = [
  // OAuth 账号绑定列表（demo 模式默认未绑定任何账号；须先于 {provider} 注册）
  mock(oauthContract.accounts, ({ ok }) => {
    return ok([]);
  }),

  // 已启用的提供方（演示模式全部开放；须先于 {provider} 注册，否则被当成 provider="providers"）
  mock(oauthContract.providers, ({ ok }) => {
    return ok([...OAUTH_PROVIDERS]);
  }),

  // 获取登录授权链接
  mock(oauthContract.authUrl, ({ params, ok }) => {
    return ok({
      authUrl: `https://example.com/oauth/${params.provider}?demo=true`,
      state: 'mock-state-123',
    });
  }),

  // 获取绑定授权链接（当前用户）
  mock(oauthContract.bindUrl, ({ params, ok }) => {
    return ok({
      authUrl: `https://example.com/oauth/${params.provider}?demo=true&intent=bind`,
      state: 'mock-bind-state-123',
    });
  }),

  // OAuth 登录回调（code + state）
  mock(oauthContract.callback, ({ ok }) => {
    return ok({ needBind: true, oauthInfo: { provider: 'github', openId: 'mock-123', nickname: 'DemoUser' } }, '演示模式：第三方登录暂不可用');
  }),

  // 绑定（provider + code + state）
  mock(oauthContract.bind, ({ ok }) => {
    return ok(null, '绑定成功（演示）');
  }),

  // 解绑
  mock(oauthContract.unbind, ({ ok }) => {
    return ok(null, '已解绑（演示）');
  }),
];
