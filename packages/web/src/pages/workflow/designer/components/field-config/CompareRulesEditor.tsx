// ─── 跨字段比较校验规则编辑器（拆分自 FieldConfigPanel.tsx）───
import { Button, Input, Select, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldCompareRule } from '@arcbase/shared/workflow';
import { COMPARE_OPERATOR_OPTIONS } from '../../form-types';

// ─── 跨字段比较校验编辑器 ────────────────────────────────────────────

export function CompareRulesEditor({
  field,
  candidates,
  onChange,
}: Readonly<{ field: WorkflowFormField; candidates: WorkflowFormField[]; onChange: (updates: Partial<WorkflowFormField>) => void }>) {
  const rules = field.compareRules ?? [];
  const commit = (next: WorkflowFormFieldCompareRule[]) => onChange({ compareRules: next.length ? next : undefined });
  const add = () => commit([...rules, { operator: 'gt', field: candidates[0]?.key ?? '' }]);
  const update = (i: number, patch: Partial<WorkflowFormFieldCompareRule>) =>
    commit(rules.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const remove = (i: number) => commit(rules.filter((_, idx) => idx !== i));

  if (candidates.length === 0) {
    return <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>暂无可比较的其他字段</Typography.Text>;
  }

  return (
    <div className="fd-compare-rules">
      {rules.map((r, i) => (
        <div key={`cmp-${i}`} className="fd-compare-rules__row">
          <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
            <Typography.Text type="tertiary" size="small">当前值</Typography.Text>
            <Select
              size="small"
              value={r.operator}
              onChange={(v) => update(i, { operator: v as WorkflowFormFieldCompareRule['operator'] })}
              optionList={COMPARE_OPERATOR_OPTIONS}
              style={{ width: 110 }}
            />
            <Select
              size="small"
              value={r.field}
              onChange={(v) => update(i, { field: String(v) })}
              optionList={candidates.map((c) => ({ value: c.key, label: c.label || c.key }))}
              style={{ flex: 1 }}
              placeholder="目标字段"
            />
            <button type="button" className="fd-options-editor__delete" onClick={() => remove(i)}>
              <Trash2 size={12} />
            </button>
          </div>
          <Input
            size="small"
            value={r.message ?? ''}
            onChange={(v) => update(i, { message: v || undefined })}
            placeholder="校验失败提示（选填）"
            style={{ marginTop: 4 }}
          />
        </div>
      ))}
      <Button size="small" type="tertiary" icon={<Plus size={12} />} onClick={add}>添加比较规则</Button>
    </div>
  );
}
