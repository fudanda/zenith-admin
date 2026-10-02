/**
 * 错误告警规则编辑弹窗：前端错误监控与服务端异常日志共用，只有可选的错误类型集合不同。
 * 表单以本地状态维护（条件 / 渠道联动显示阈值、Webhook、收件人），提交时收敛为契约请求体。
 */
import { useEffect, useState } from 'react';
import { Col, Form, Input, InputNumber, Row, Select, Switch, TagInput, Toast } from '@douyinfe/semi-ui';
import type { ErrorAlertChannel, ErrorAlertCondition, ErrorAlertRule, ErrorLevel, ErrorType } from '@arcbase/shared/analytics';
import { ERROR_ALERT_CONDITION_OPTIONS, ERROR_LEVEL_OPTIONS } from '@arcbase/shared/analytics';
import { NOTIFY_CHANNEL_OPTIONS } from '@arcbase/shared/messaging';
import AppModal from '@/components/AppModal';
import { toAlertChannels, toStringArray } from './issue-meta';

export interface ErrorAlertRuleValues {
  name: string;
  errorType: ErrorType | null;
  level: ErrorLevel | null;
  condition: ErrorAlertCondition;
  thresholdCount: number;
  windowMinutes: number;
  channels: ErrorAlertChannel[];
  webhookUrl: string | null;
  recipients: string[];
  enabled: boolean;
}

interface AlertFormState {
  name: string;
  errorType: ErrorType | null;
  level: ErrorLevel | null;
  condition: ErrorAlertCondition;
  thresholdCount: number;
  windowMinutes: number;
  channels: ErrorAlertChannel[];
  webhookUrl: string;
  recipients: string[];
  enabled: boolean;
}

const DEFAULT_FORM: AlertFormState = {
  name: '',
  errorType: null,
  level: null,
  condition: 'threshold',
  thresholdCount: 10,
  windowMinutes: 60,
  channels: ['inapp'],
  webhookUrl: '',
  recipients: [],
  enabled: true,
};

function formFromRule(rule: ErrorAlertRule | null): AlertFormState {
  if (!rule) return DEFAULT_FORM;
  return {
    name: rule.name,
    errorType: rule.errorType,
    level: rule.level,
    condition: rule.condition,
    thresholdCount: rule.thresholdCount,
    windowMinutes: rule.windowMinutes,
    channels: toAlertChannels(rule.channels),
    webhookUrl: rule.webhookUrl ?? '',
    recipients: rule.recipients,
    enabled: rule.enabled,
  };
}

export interface ErrorAlertRuleModalProps {
  readonly visible: boolean;
  /** 编辑中的规则；null = 新增 */
  readonly rule: ErrorAlertRule | null;
  /** 可选错误类型（前端错误页传浏览器端类型，异常日志页传服务端类型） */
  readonly typeOptions: ReadonlyArray<{ value: ErrorType; label: string }>;
  readonly saving: boolean;
  readonly onCancel: () => void;
  readonly onSubmit: (values: ErrorAlertRuleValues) => Promise<void>;
}

export function ErrorAlertRuleModal({ visible, rule, typeOptions, saving, onCancel, onSubmit }: ErrorAlertRuleModalProps) {
  const [form, setForm] = useState<AlertFormState>(() => formFromRule(rule));

  // 每次打开按当前规则重置（新增 → 默认值；编辑 → 规则值），关闭期间的残留不带入下一次
  useEffect(() => {
    if (visible) setForm(formFromRule(rule));
  }, [visible, rule]);

  const submit = async () => {
    if (!form.name.trim()) {
      Toast.warning('请输入规则名称');
      return;
    }
    await onSubmit({
      name: form.name.trim(),
      errorType: form.errorType,
      level: form.level,
      condition: form.condition,
      thresholdCount: form.thresholdCount,
      windowMinutes: form.windowMinutes,
      channels: form.channels,
      webhookUrl: form.webhookUrl.trim() || null,
      recipients: form.recipients,
      enabled: form.enabled,
    });
  };

  return (
    <AppModal
      title={rule ? '编辑告警规则' : '新增告警规则'}
      visible={visible}
      onCancel={onCancel}
      onOk={() => void submit()}
      confirmLoading={saving}
      width={660}
      closeOnEsc
    >
      <Form labelPosition="left" labelWidth={80}>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Slot label="名称">
              <Input value={form.name} placeholder="请输入规则名称" maxLength={128} onChange={(value) => setForm((prev) => ({ ...prev, name: value }))} />
            </Form.Slot>
          </Col>
          <Col span={12}>
            <Form.Slot label="启用">
              <Switch checked={form.enabled} onChange={(checked) => setForm((prev) => ({ ...prev, enabled: checked }))} />
            </Form.Slot>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Slot label="类型">
              <Select
                showClear
                placeholder="全部"
                value={form.errorType ?? undefined}
                optionList={[...typeOptions]}
                style={{ width: '100%' }}
                onChange={(value) => setForm((prev) => ({ ...prev, errorType: (value as ErrorType | undefined) ?? null }))}
              />
            </Form.Slot>
          </Col>
          <Col span={12}>
            <Form.Slot label="级别">
              <Select
                showClear
                placeholder="全部"
                value={form.level ?? undefined}
                optionList={ERROR_LEVEL_OPTIONS}
                style={{ width: '100%' }}
                onChange={(value) => setForm((prev) => ({ ...prev, level: (value as ErrorLevel | undefined) ?? null }))}
              />
            </Form.Slot>
          </Col>
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Slot label="条件">
              <Select
                value={form.condition}
                style={{ width: '100%' }}
                optionList={ERROR_ALERT_CONDITION_OPTIONS}
                onChange={(value) => setForm((prev) => ({ ...prev, condition: value as ErrorAlertCondition }))}
              />
            </Form.Slot>
          </Col>
          {/* new_error 只判断「窗口内是否出现新分组」，不读阈值；一直摆着会让人以为调它有用 */}
          {form.condition !== 'new_error' && (
            <Col span={12}>
              <Form.Slot label="阈值">
                <InputNumber min={1} max={100000} value={form.thresholdCount} onChange={(value) => setForm((prev) => ({ ...prev, thresholdCount: Number(value) || 1 }))} style={{ width: '100%' }} />
              </Form.Slot>
            </Col>
          )}
        </Row>
        <Row gutter={16}>
          <Col span={12}>
            <Form.Slot label="窗口">
              <InputNumber min={1} max={10080} value={form.windowMinutes} suffix="分钟" onChange={(value) => setForm((prev) => ({ ...prev, windowMinutes: Number(value) || 1 }))} style={{ width: '100%' }} />
            </Form.Slot>
          </Col>
          <Col span={12}>
            <Form.Slot label="渠道">
              <Select
                multiple
                maxTagCount={2}
                value={form.channels}
                style={{ width: '100%' }}
                optionList={[...NOTIFY_CHANNEL_OPTIONS]}
                onChange={(value) => setForm((prev) => ({ ...prev, channels: toAlertChannels(toStringArray(value)) }))}
              />
            </Form.Slot>
          </Col>
        </Row>
        {/*
          Webhook 与收件人按所选渠道显示：服务端在启用时强校验
          （含 webhook 渠道 → URL 必填；含邮件/站内信 → 收件人必填，见 validateAlertDelivery）。
          切换渠道不清空已填值——重新勾回来时还在，比丢掉用户输入更可取。
        */}
        {form.channels.includes('webhook') && (
          <Form.Slot label="Webhook">
            <Input value={form.webhookUrl} placeholder="https://example.com/webhook" onChange={(value) => setForm((prev) => ({ ...prev, webhookUrl: value }))} />
          </Form.Slot>
        )}
        {(form.channels.includes('email') || form.channels.includes('inapp')) && (
          <Form.Slot label="收件人">
            <TagInput
              value={form.recipients}
              placeholder="输入用户名或邮箱后回车"
              onChange={(value) => setForm((prev) => ({ ...prev, recipients: value }))}
            />
          </Form.Slot>
        )}
      </Form>
    </AppModal>
  );
}
