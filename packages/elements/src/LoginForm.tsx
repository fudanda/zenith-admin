import { useCallback, useEffect, useId, useRef, useState, type SubmitEvent } from 'react';
import Button from '@douyinfe/semi-ui/lib/es/button';
import { call, type ApiEnvelope } from '@arcbase/client';
import { goAuthContract, type GoSession } from '@arcbase/shared/identity';
import { LoginField, LoginFormError } from './LoginField';
import { useLoginForm } from './login-form';
import { useSession, useArcBase } from './provider';
import type { LoginResult } from './session';

export function LoginForm({ onSuccess, className }: { onSuccess?: (session: GoSession) => void; className?: string }) {
  const { client, locale, routes, navigate } = useArcBase();
  const session = useSession();
  const english = locale === 'en-US';
  const uid = useId();
  const [captcha, setCaptcha] = useState<{ enabled: boolean; captchaId: string; image: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [until, setUntil] = useState(0);
  const [seconds, setSeconds] = useState(0);
  const [ticket, setTicket] = useState<string | null>(null);
  const lifetime = useRef<AbortController | null>(null);
  const form = useLoginForm({ username: '', password: '', captchaAnswer: '' }, {
    username: [{ required: true, message: english ? 'Enter username' : '请输入用户名' }],
    password: [{ required: true, message: english ? 'Enter password' : '请输入密码' }],
    captchaAnswer: [{ required: captcha?.enabled, message: english ? 'Enter captcha' : '请输入验证码' }],
  });
  const { setFormError } = form;
  const refreshCaptcha = useCallback(async () => {
    const signal = lifetime.current?.signal;
    if (!signal || signal.aborted) return;
    try { const result = await call(client, goAuthContract.captcha, undefined, { signal }); if (!signal.aborted) setCaptcha(result); }
    catch (error) { if (!signal.aborted) setFormError(error instanceof Error ? error.message : String(error)); }
  }, [client, setFormError]);
  useEffect(() => {
    const controller = new AbortController(); lifetime.current = controller;
    void refreshCaptcha(); return () => { controller.abort(); };
  }, [refreshCaptcha]);
  useEffect(() => {
    const tick = () => setSeconds(Math.max(0, Math.ceil((until - Date.now()) / 1000)));
    tick(); if (!until) return;
    const timer = setInterval(tick, 1000); return () => clearInterval(timer);
  }, [until]);
  const received = async (result: ApiEnvelope<LoginResult>) => {
    if (lifetime.current?.signal.aborted) return;
    form.setValue('captchaAnswer', '');
    if (result.code === 0 && 'csrfToken' in result.data) {
      form.setValue('password', '');
      onSuccess?.(result.data); if (!onSuccess) navigate?.(routes?.home ?? '/');
      return;
    }
    if (result.code === 0 && 'captchaRequired' in result.data) {
      setCaptcha({ enabled: true, captchaId: result.data.captchaId, image: result.data.svg });
    } else if (result.code === 0 && 'ticket' in result.data) { setTicket(result.data.ticket); }
    else { setFormError(result.message); await refreshCaptcha(); }
    if (result.retryAfterSeconds) setUntil(Date.now() + result.retryAfterSeconds * 1000);
  };
  const submit = async (event: SubmitEvent<HTMLFormElement>) => {
    event.preventDefault(); if (loading || seconds || !captcha) return;
    const input = form.validate(); if (!input) return;
    setLoading(true);
    try { await received(await session.login({ ...input, captchaId: captcha.captchaId })); }
    catch (error) { if (!lifetime.current?.signal.aborted) { setFormError(error instanceof Error ? error.message : String(error)); await refreshCaptcha(); } }
    finally { if (!lifetime.current?.signal.aborted) setLoading(false); }
  };
  return (
    <form className={`arcbase-elements-form ${className ?? ''}`} onSubmit={event => { void submit(event); }} noValidate>
      <LoginField {...form.field('username')} id={`${uid}-username`} label={english ? 'Username' : '用户名'} autoComplete="username" size="large" />
      <LoginField {...form.field('password')} id={`${uid}-password`} label={english ? 'Password' : '密码'} mode="password" autoComplete="current-password" size="large" />
      {captcha?.enabled && <div className="arcbase-elements-captcha">
        <LoginField {...form.field('captchaAnswer')} id={`${uid}-captcha`} label={english ? 'Captcha' : '验证码'} autoComplete="one-time-code" size="large" />
        <button type="button" onClick={() => { void refreshCaptcha(); }} aria-label={english ? 'Refresh captcha' : '刷新验证码'}><img src={captcha.image} alt={english ? 'Login captcha' : '登录验证码'} width={160} height={48} /></button>
      </div>}
      <LoginFormError message={form.formError} />
      {ticket && <div role="alert">
        <p>{english ? 'Another session is active. Sign it out and continue?' : '已有在线会话，是否下线其它设备并继续登录？'}</p>
        <Button disabled={loading || seconds > 0} onClick={() => {
          setLoading(true);
          void session.resolveSessionConflict(ticket).then(received).catch((error: unknown) => { if (!lifetime.current?.signal.aborted) setFormError(error instanceof Error ? error.message : String(error)); }).finally(() => { if (!lifetime.current?.signal.aborted) { setLoading(false); setTicket(null); } });
        }}>{english ? 'Continue' : '确认继续'}</Button>
        <Button onClick={() => setTicket(null)}>{english ? 'Cancel' : '取消'}</Button>
      </div>}
      <Button htmlType="submit" type="primary" theme="solid" size="large" block loading={loading} disabled={!captcha || seconds > 0}>
        {seconds ? `${seconds}s` : english ? 'Sign in' : '登录'}
      </Button>
    </form>
  );
}
