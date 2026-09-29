import { useEffect, useState, type FormEvent } from 'react';
import { Button, Input, Toast } from '@douyinfe/semi-ui';
import { useAuth } from '@zenith/admin-core';
import { authApi } from '@zenith/admin-client';
import { ZenithMark } from '@zenith/admin-ui';

export function LoginPage() {
  const { login } = useAuth();
  const [username, setUsername] = useState(''); const [password, setPassword] = useState('');
  const [tenantCode, setTenantCode] = useState(''); const [captchaAnswer, setCaptchaAnswer] = useState('');
  const [captcha, setCaptcha] = useState<{ captchaId: string; image: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const reloadCaptcha = () => authApi.captcha().then(setCaptcha).catch(err => Toast.error(String(err)));
  useEffect(() => { void reloadCaptcha(); }, []);
  const submit = async (event: FormEvent) => {
    event.preventDefault(); if (!captcha) return; setBusy(true);
    try { await login({ username, password, tenantCode, captchaId: captcha.captchaId, captchaAnswer }); }
    catch (error) { Toast.error(String(error)); setCaptchaAnswer(''); void reloadCaptcha(); }
    finally { setBusy(false); }
  };
  return <div className="zenith-login"><div className="zenith-card"><ZenithMark/><h1>欢迎使用 Zenith Admin</h1><p>登录后继续使用管理后台</p>
    <form onSubmit={submit}>
      <div className="zenith-form-row"><label htmlFor="username">用户名</label><Input id="username" autoComplete="username" value={username} onChange={setUsername}/></div>
      <div className="zenith-form-row"><label htmlFor="password">密码</label><Input id="password" mode="password" autoComplete="current-password" value={password} onChange={setPassword}/></div>
      <div className="zenith-form-row"><label htmlFor="tenant">租户编码（平台管理员留空）</label><Input id="tenant" value={tenantCode} onChange={setTenantCode}/></div>
      <div className="zenith-form-row"><label htmlFor="captcha">验证码</label><div className="zenith-captcha"><Input id="captcha" value={captchaAnswer} onChange={setCaptchaAnswer}/>{captcha && <img src={captcha.image} alt="点击刷新验证码" onClick={reloadCaptcha}/>}</div></div>
      <Button htmlType="submit" theme="solid" loading={busy} block>登录</Button>
    </form></div></div>;
}
