import { useEffect, useMemo, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import {
  Banner,
  Button,
  Card,
  Col,
  Form,
  Row,
  Select,
  Space,
  Tag,
  TextArea,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import { Play } from 'lucide-react';
import { enumValueOf } from '@arcbase/shared/core';
import { OPEN_API_DEBUG_METHODS, openGatewayContract } from '@arcbase/shared/open-platform';
import type { OpenApiDebugResult } from '@arcbase/shared/open-platform';
import { urlOf } from '@/lib/contract-query';
import { useDebugEndpoints, useDebugMyApp, useMyAppList } from '@/hooks/queries/developer-apps';
import { ResetButton } from '@/components/toolbar-controls';
import { abortSubmit } from '@/lib/abort-submit';

const { Paragraph, Text, Title } = Typography;

/** 端点下拉的选中值：`METHOD 完整路径`，默认选中连通性测试 */
const DEFAULT_ENDPOINT_KEY = `${openGatewayContract.ping.method.toUpperCase()} ${urlOf(openGatewayContract.ping)}`;

function prettyJson(value: string): string {
  try {
    return JSON.stringify(JSON.parse(value), null, 2);
  } catch {
    return value;
  }
}

export default function ApiDebugConsolePage() {
  const [searchParams] = useSearchParams();
  // 注意 Number(null) === 0：无 appId 参数时必须落到 undefined，否则选择器显示「0」且自动选中首个应用的逻辑失效
  const initialAppIdRaw = searchParams.get('appId');
  const initialAppId = initialAppIdRaw === null ? Number.NaN : Number(initialAppIdRaw);
  const appListQuery = useMyAppList({ page: 1, pageSize: 100 });
  const endpointsQuery = useDebugEndpoints();
  const debugMutation = useDebugMyApp();
  const apps = useMemo(() => appListQuery.data?.list ?? [], [appListQuery.data]);
  // 端点目录来自服务端（按实际注册的开放路由派生），新增开放端点后调试台自动可见
  const endpoints = useMemo(() => endpointsQuery.data ?? [], [endpointsQuery.data]);
  const [appId, setAppId] = useState<number | undefined>(
    Number.isInteger(initialAppId) && initialAppId > 0 ? initialAppId : undefined,
  );
  const [endpointKey, setEndpointKey] = useState<string>(DEFAULT_ENDPOINT_KEY);
  const [pathParams, setPathParams] = useState('');
  const [queryText, setQueryText] = useState('{\n  "message": "hello"\n}');
  const [bodyText, setBodyText] = useState('{\n  "message": "hello from debug console"\n}');
  const [result, setResult] = useState<OpenApiDebugResult | null>(null);

  const endpoint = useMemo(
    () => endpoints.find((item) => `${item.method} ${item.path}` === endpointKey) ?? endpoints[0],
    [endpoints, endpointKey],
  );
  const method = endpoint?.method ?? 'GET';
  const hasPathParams = /\{[^}]+\}/.test(endpoint?.path ?? '');
  const supportsBody = method === 'POST' || method === 'PUT';

  useEffect(() => {
    if (appId === undefined && apps.length > 0) setAppId(apps[0].id);
  }, [appId, apps]);

  const reset = () => {
    setEndpointKey(DEFAULT_ENDPOINT_KEY);
    setPathParams('');
    setQueryText('{\n  "message": "hello"\n}');
    setBodyText('{\n  "message": "hello from debug console"\n}');
    setResult(null);
  };

  const execute = async () => {
    if (!appId) {
      Toast.warning('请先选择应用');
      return;
    }
    if (!endpoint) {
      Toast.warning('请选择调试端点');
      return;
    }
    const debugMethod = enumValueOf(OPEN_API_DEBUG_METHODS, method);
    if (!debugMethod) {
      Toast.warning(`调试台暂不支持 ${method} 请求`);
      return;
    }
    // 路径参数（如 /cms/contents/{id}）由使用者填入实际值后替换
    let resolvedPath = endpoint.path;
    if (hasPathParams) {
      const values = pathParams.split(',').map((s) => s.trim()).filter(Boolean);
      const placeholders = endpoint.path.match(/\{[^}]+\}/g) ?? [];
      if (values.length !== placeholders.length) {
        Toast.error(`该端点需要 ${placeholders.length} 个路径参数：${placeholders.join('、')}`);
        return;
      }
      placeholders.forEach((placeholder, index) => {
        resolvedPath = resolvedPath.replace(placeholder, encodeURIComponent(values[index]));
      });
    }
    let query: Record<string, string> | undefined;
    let body: unknown;
    try {
      const parsed = queryText.trim() ? JSON.parse(queryText) as unknown : undefined;
      if (parsed && (typeof parsed !== 'object' || Array.isArray(parsed))) abortSubmit('query');
      query = parsed
        ? Object.fromEntries(Object.entries(parsed as Record<string, unknown>).map(([key, value]) => [key, String(value)]))
        : undefined;
      body = supportsBody && bodyText.trim() ? JSON.parse(bodyText) : undefined;
    } catch {
      Toast.error('Query 与 Body 必须是合法 JSON');
      return;
    }
    const response = await debugMutation.mutateAsync({
      params: { id: appId },
      body: { method: debugMethod, path: resolvedPath, query, body },
    });
    setResult(response);
  };

  return (
    <div className="page-container">
      <Banner
        type="info"
        description="调试请求由服务端代签并发送到开放网关，不会在浏览器中暴露 AppSecret。沙箱应用不会消耗生产配额。"
        style={{ marginBottom: 16 }}
      />
      <Row gutter={16}>
        <Col xs={24} md={10}>
          <Card title={<Title heading={6} style={{ margin: 0 }}>构造请求</Title>}>
            <Form labelPosition="left" labelWidth={90}>
              <Select
                prefix="应用"
                placeholder="选择应用"
                value={appId}
                onChange={(value) => setAppId(Number(value))}
                optionList={apps.map((app) => ({
                  value: app.id,
                  label: `${app.name}（${app.environment === 'sandbox' ? '沙箱' : '生产'}）`,
                }))}
                loading={appListQuery.isFetching}
                style={{ width: '100%', marginBottom: 16 }}
              />
              <Select
                prefix="端点"
                value={endpointKey}
                onChange={(value) => setEndpointKey(value as string)}
                optionList={endpoints.map((item) => ({
                  value: `${item.method} ${item.path}`,
                  label: `${item.method} ${item.path}${item.summary ? ` · ${item.summary}` : ''}`,
                }))}
                loading={endpointsQuery.isFetching}
                filter
                style={{ width: '100%', marginBottom: 16 }}
              />
              {endpoint?.scope && (
                <div style={{ marginBottom: 16 }}>
                  <Text type="tertiary" size="small">所需 scope：</Text>
                  <Tag size="small" color="blue" style={{ marginLeft: 6 }}>{endpoint.scope}</Tag>
                </div>
              )}
              {hasPathParams && (
                <div style={{ marginBottom: 16 }}>
                  <Text strong>路径参数</Text>
                  <Text type="tertiary" size="small" style={{ display: 'block', marginTop: 2 }}>
                    按顺序填写 {endpoint?.path.match(/\{[^}]+\}/g)?.join('、')}，多个用英文逗号分隔
                  </Text>
                  <TextArea value={pathParams} onChange={setPathParams} rows={1} style={{ marginTop: 6 }} />
                </div>
              )}
              <div style={{ marginBottom: 16 }}>
                <Text strong>Query JSON</Text>
                <TextArea value={queryText} onChange={setQueryText} rows={5} style={{ marginTop: 6 }} />
              </div>
              {supportsBody && (
                <div style={{ marginBottom: 16 }}>
                  <Text strong>Body JSON</Text>
                  <TextArea value={bodyText} onChange={setBodyText} rows={7} style={{ marginTop: 6 }} />
                </div>
              )}
              <Space style={{ marginTop: 8 }}>
                <Button type="primary" icon={<Play size={14} />} loading={debugMutation.isPending} onClick={() => void execute()}>发送请求</Button>
                <ResetButton onClick={reset} />
              </Space>
            </Form>
          </Card>
        </Col>
        <Col xs={24} md={14}>
          <Card title={<Title heading={6} style={{ margin: 0 }}>响应与签名过程</Title>}>
            {!result ? (
              <div style={{ padding: '56px 0', textAlign: 'center' }}>
                <Text type="tertiary">发送请求后将在这里展示网关响应与待签名串</Text>
              </div>
            ) : (
              <>
                <Space wrap style={{ marginBottom: 12 }}>
                  <Tag color={result.statusCode < 400 ? 'green' : 'red'}>{result.statusCode}</Tag>
                  <Tag>{result.method}</Tag>
                  <Text>{result.durationMs} ms</Text>
                </Space>
                <Text strong>请求地址</Text>
                <Paragraph copyable style={{ wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)' }}>{result.requestUrl}</Paragraph>
                <Text strong>请求头</Text>
                <Paragraph copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)', maxHeight: 180, overflow: 'auto' }}>
                  {JSON.stringify(result.requestHeaders, null, 2)}
                </Paragraph>
                {result.stringToSign && (
                  <>
                    <Text strong>待签名串</Text>
                    <Paragraph copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)', maxHeight: 180, overflow: 'auto' }}>
                      {result.stringToSign}
                    </Paragraph>
                  </>
                )}
                <Text strong>响应体</Text>
                <Paragraph copyable style={{ whiteSpace: 'pre-wrap', wordBreak: 'break-all', padding: 8, background: 'var(--semi-color-fill-0)', maxHeight: 320, overflow: 'auto' }}>
                  {prettyJson(result.responseBody)}
                </Paragraph>
              </>
            )}
          </Card>
        </Col>
      </Row>
    </div>
  );
}
