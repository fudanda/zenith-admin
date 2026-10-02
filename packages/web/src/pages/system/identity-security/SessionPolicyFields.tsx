import { Form, RadioGroup, Radio, useFormApi, useFormState } from '@douyinfe/semi-ui';
import { Info } from 'lucide-react';
import {
  SESSION_CONCURRENCY_SCOPE_LABELS,
  SESSION_CONCURRENCY_SCOPES,
  SESSION_EXCEED_ACTION_LABELS,
  SESSION_EXCEED_ACTIONS,
} from '@arcbase/shared/identity';
import { formatSessionPolicyHint, type SessionConcurrencyPolicy } from '@arcbase/shared/settings';

type LimitMode = 'unlimited' | 'single' | 'limited';

/** 「最多 N 处」的默认起点：从单处切过来时给一个有意义的 N，避免落在 0 / 1 上又变回别的模式 */
const DEFAULT_LIMITED = 3;

function modeOf(maxSessions: number): LimitMode {
  if (maxSessions <= 0) return 'unlimited';
  return maxSessions === 1 ? 'single' : 'limited';
}

/**
 * 身份安全 → 会话并发。渲染在 <Form> 内：同时在线用单选表达「不限 / 单处 / 最多 N 处」，
 * 落到同一个 session.maxSessions 字段；不限制时范围与超限处理置灰。
 */
export function SessionPolicyFields() {
  const formApi = useFormApi();
  const { values } = useFormState<{ session?: Partial<SessionConcurrencyPolicy> }>();
  const draft = values?.session;
  const session: SessionConcurrencyPolicy = {
    maxSessions: draft?.maxSessions ?? 0,
    scope: draft?.scope ?? 'global',
    exceedAction: draft?.exceedAction ?? 'kick-oldest',
  };
  const mode = modeOf(session.maxSessions);
  const unlimited = mode === 'unlimited';
  const preview = formatSessionPolicyHint(session);

  const changeMode = (next: LimitMode) => {
    const value = next === 'unlimited' ? 0 : next === 'single' ? 1 : Math.max(session.maxSessions, DEFAULT_LIMITED);
    formApi.setValue('session.maxSessions', value);
  };

  return (
    <>
      <Form.Slot label="同时在线">
        <div className="session-policy-limit">
          <RadioGroup value={mode} onChange={(e) => changeMode(e.target.value as LimitMode)} aria-label="同时在线上限">
            <Radio value="unlimited">不限制</Radio>
            <Radio value="single">仅一处登录</Radio>
            <Radio value="limited">最多 N 处</Radio>
          </RadioGroup>
          {/* 常驻挂载：Semi Field 卸载会连带移除表单值，切回「不限 / 单处」时 maxSessions 必须仍在提交体里；非 N 处模式仅隐藏 */}
          <Form.InputNumber
            field="session.maxSessions"
            noLabel
            min={mode === 'limited' ? 2 : 0}
            max={20}
            style={{ width: 120 }}
            fieldStyle={{ padding: 0 }}
            fieldClassName={mode === 'limited' ? undefined : 'session-policy-limit-hidden'}
            suffix="处"
            aria-label="同时在线上限（处）"
          />
        </div>
      </Form.Slot>
      <Form.Select
        field="session.scope"
        label="统计范围"
        disabled={unlimited}
        style={{ width: 260 }}
        optionList={SESSION_CONCURRENCY_SCOPES.map((value) => ({ value, label: SESSION_CONCURRENCY_SCOPE_LABELS[value] }))}
        extraText="按终端分别计算时，网页、移动审批、桌面端各占一份名额"
      />
      <Form.RadioGroup
        field="session.exceedAction"
        label="超限处理"
        disabled={unlimited}
        options={SESSION_EXCEED_ACTIONS.map((value) => ({ value, label: SESSION_EXCEED_ACTION_LABELS[value] }))}
        extraText="拒绝新登录时，用户可在登录页选择下线其它设备后继续登录"
      />
      <Form.Slot label=" ">
        <div className="session-policy-preview" role="status">
          <Info size={14} aria-hidden />
          <span>{preview}</span>
        </div>
      </Form.Slot>
    </>
  );
}
