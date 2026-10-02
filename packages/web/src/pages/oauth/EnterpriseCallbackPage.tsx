import { useEffect, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { Spin, Toast } from '@douyinfe/semi-ui';
import { REFRESH_TOKEN_KEY, TOKEN_KEY } from '@arcbase/shared/core';
import { enterpriseAuthContract } from '@arcbase/shared/identity';
import { api } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { markPostLoginHome } from '@/lib/post-login';
import { handoffFromLoginResult } from '@/lib/mfa-handoff';

export default function EnterpriseCallbackPage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const [message, setMessage] = useState('正在处理企业登录...');

  useEffect(() => {
    const samlTicket = searchParams.get('samlTicket');
    const code = searchParams.get('code');
    const state = searchParams.get('state');
    const callback = samlTicket
      ? api(enterpriseAuthContract.samlExchange, { body: { ticket: samlTicket } }, { silent: true })
      : code && state
        ? api(enterpriseAuthContract.callback, { body: { code, state } }, { silent: true })
        : null;
    if (!callback) {
      setMessage('企业登录参数不完整');
      return;
    }
    callback
      .then(({ loginResult, redirectTo }) => {
        // 企业 SSO 与密码登录共用 MFA 策略与会话并发判定：命中挑战 / 冲突时交给登录页的验证表单 / 确认弹层完成
        const handoff = handoffFromLoginResult(loginResult, redirectTo);
        if (handoff) {
          navigate('/login', { replace: true, state: handoff });
          return;
        }
        if (!('token' in loginResult)) return;
        localStorage.setItem(TOKEN_KEY, loginResult.token.accessToken);
        localStorage.setItem(REFRESH_TOKEN_KEY, loginResult.token.refreshToken);
        Toast.success('登录成功');
        // 整页刷新最终落地 BASE_URL（首页），打标记供 HomeEntry 应用默认首页偏好
        markPostLoginHome();
        navigate(redirectTo || '/', { replace: true });
        globalThis.location.href = import.meta.env.BASE_URL;
      })
      .catch((err: unknown) => {
        const text = (err instanceof ApiError && err.message) || '企业登录失败';
        setMessage(text);
        if (err instanceof ApiError) Toast.error(text);
        setTimeout(() => navigate('/login', { replace: true }), 2000);
      });
  }, [navigate, searchParams]);

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', height: '100vh', gap: 16 }}>
      <Spin size="large" />
      <span>{message}</span>
    </div>
  );
}
