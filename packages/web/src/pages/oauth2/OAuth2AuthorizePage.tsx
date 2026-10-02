/**
 * OAuth2 授权同意页面（独立页面，不在 AdminLayout 内）
 * 路由：/oauth2/authorize
 * 说明：
 *   - 未登录 → 跳转到 /login?redirect=当前URL
 *   - 已登录 → 展示应用信息和权限范围，用户选择同意/拒绝
 */
import { useEffect, useState } from 'react';
import { useSearchParams, useNavigate } from 'react-router-dom';
import { Spin, Card, Avatar, Tag, Button, Space, Typography, Divider, Toast } from '@douyinfe/semi-ui';
import { ShieldCheck, X } from 'lucide-react';
import { TOKEN_KEY } from '@arcbase/shared/core';
import { isSafeOAuthRedirectUri } from '@arcbase/shared/identity';
import { oauth2AuthContract } from '@arcbase/shared/open-platform';
import type { OAuth2AuthorizeInfo } from '@arcbase/shared/open-platform';
import { api } from '@/lib/contract-query';

const { Title, Text, Paragraph } = Typography;

export default function OAuth2AuthorizePage() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();

  const clientId = searchParams.get('client_id') ?? '';
  const redirectUri = searchParams.get('redirect_uri') ?? '';
  const responseType = searchParams.get('response_type') ?? 'code';
  const scope = searchParams.get('scope') ?? 'openid';
  const state = searchParams.get('state') ?? '';
  const codeChallenge = searchParams.get('code_challenge') ?? '';
  const codeChallengeMethod = searchParams.get('code_challenge_method') ?? '';

  const [info, setInfo] = useState<OAuth2AuthorizeInfo | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    // 检查是否已登录
    const token = localStorage.getItem(TOKEN_KEY);
    if (!token) {
      const returnUrl = encodeURIComponent(globalThis.location.pathname + globalThis.location.search);
      navigate(`/login?redirect=${returnUrl}`, { replace: true });
      return;
    }

    if (!clientId || !redirectUri) {
      setError('缺少必要的授权参数（client_id / redirect_uri）');
      setLoading(false);
      return;
    }
    if (!isSafeOAuthRedirectUri(redirectUri)) {
      setError('redirect_uri 使用了不安全的协议');
      setLoading(false);
      return;
    }
    if (responseType !== 'code') {
      setError('仅支持 OAuth 2.1 授权码模式（response_type=code）');
      setLoading(false);
      return;
    }
    // PKCE 是授权端点的硬性要求（OAuth 2.1）。参数缺失时必须在进入同意页之前拦下——
    // 否则用户会看到一个可点击但注定失败的「同意授权」按钮。
    if (!codeChallenge) {
      setError('授权请求缺少 code_challenge：本平台要求授权码流程必须使用 PKCE（S256）');
      setLoading(false);
      return;
    }
    if (codeChallengeMethod !== 'S256') {
      setError('仅支持 PKCE S256，请携带 code_challenge_method=S256');
      setLoading(false);
      return;
    }
    if (!/^[A-Za-z0-9_-]{43}$/.test(codeChallenge)) {
      setError('code_challenge 格式无效：应为 base64url 编码的 SHA-256 摘要（43 个字符）');
      setLoading(false);
      return;
    }

    api(oauth2AuthContract.authorizeInfo, {
      query: {
        client_id: clientId,
        redirect_uri: redirectUri,
        response_type: responseType,
        scope,
      },
    }).then(setInfo).catch((err: Error) => {
      setError(err.message || '应用信息加载失败');
    }).finally(() => setLoading(false));
  }, [clientId, redirectUri, responseType, scope, codeChallenge, codeChallengeMethod, navigate]);

  const handleApprove = async () => {
    setSubmitting(true);
    try {
      const { redirectUrl } = await api(oauth2AuthContract.authorize, {
        body: {
          client_id: clientId,
          redirect_uri: redirectUri,
          response_type: 'code',
          scope,
          state: state || undefined,
          code_challenge: codeChallenge,
          code_challenge_method: 'S256',
        },
      }, { silent: true });
      if (!isSafeOAuthRedirectUri(redirectUrl)) {
        Toast.error('服务端返回了不安全的跳转地址');
        return;
      }
      globalThis.location.href = redirectUrl;
    } catch (err) {
      // silent:true 关闭了拦截器提示，这里必须自行反馈，否则点击「同意授权」会毫无反应
      Toast.error(err instanceof Error && err.message ? err.message : '授权失败，请稍后重试');
    } finally {
      setSubmitting(false);
    }
  };

  const handleDeny = () => {
    if (!isSafeOAuthRedirectUri(redirectUri)) {
      Toast.error('拒绝跳转地址不安全');
      return;
    }
    const stateParam = state ? `&state=${encodeURIComponent(state)}` : '';
    globalThis.location.href = `${redirectUri}?error=access_denied&error_description=User%20denied%20access${stateParam}`;
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh' }}>
        <Card style={{ maxWidth: 400, textAlign: 'center' }}>
          <X size={48} color="var(--semi-color-danger)" style={{ marginBottom: 16 }} />
          <Title heading={4}>授权请求无效</Title>
          <Paragraph type="tertiary">{error}</Paragraph>
        </Card>
      </div>
    );
  }

  if (!info) return null;

  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        minHeight: '100vh',
        background: 'var(--semi-color-bg-2)',
        padding: 24,
      }}
    >
      <Card style={{ width: '100%', maxWidth: 460, borderRadius: 'var(--semi-border-radius-large)' }}>
        {/* 应用信息 */}
        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          {info.logoUrl ? (
            <Avatar src={info.logoUrl} size="extra-large" style={{ marginBottom: 12 }} />
          ) : (
            <div
              style={{
                width: 64,
                height: 64,
                borderRadius: '50%',
                background: 'var(--semi-color-primary)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                margin: '0 auto 12px',
              }}
            >
              <ShieldCheck size={32} color="#fff" />
            </div>
          )}
          <Title heading={4} style={{ marginBottom: 4 }}>{info.name}</Title>
          {info.description && <Text type="tertiary">{info.description}</Text>}
        </div>

        <Divider />

        <div style={{ margin: '16px 0' }}>
          <Text strong>该应用请求以下权限：</Text>
          <div style={{ marginTop: 12 }}>
            {info.scopeDetails.map((item) => (
              <div
                key={item.code}
                style={{
                  display: 'flex',
                  alignItems: 'flex-start',
                  gap: 8,
                  padding: '8px 0',
                  borderBottom: '1px solid var(--semi-color-border)',
                }}
              >
                <Tag color="blue" size="small" style={{ marginTop: 2, flexShrink: 0 }}>{item.code}</Tag>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                  <Text style={{ fontSize: 13 }}>{item.name}</Text>
                  {item.description && (
                    <Text type="tertiary" size="small">{item.description}</Text>
                  )}
                </div>
              </div>
            ))}
          </div>
        </div>

        {info.alreadyGranted && (
          <div style={{ marginBottom: 12, padding: '8px 12px', background: 'var(--semi-color-success-light-default)', borderRadius: 'var(--semi-border-radius-medium)' }}>
            <Text type="success" size="small">✓ 您之前已授权该应用相同的权限，确认即可继续</Text>
          </div>
        )}

        <Divider />

        <div style={{ marginTop: 16, textAlign: 'center' }}>
          <Text type="tertiary" size="small">
            授权后，{info.name} 将可以按上述权限访问您的账户信息。
          </Text>
        </div>

        <Space style={{ width: '100%', justifyContent: 'center', marginTop: 20 }}>
          <Button type="danger" theme="light" onClick={handleDeny} style={{ minWidth: 120 }}>
            拒绝
          </Button>
          <Button type="primary" loading={submitting} onClick={handleApprove} style={{ minWidth: 120 }}>
            同意授权
          </Button>
        </Space>
      </Card>
    </div>
  );
}
