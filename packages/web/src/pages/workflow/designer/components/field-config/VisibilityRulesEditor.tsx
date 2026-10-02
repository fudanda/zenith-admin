// ─── 显隐规则编辑器（含条件值编辑，支持一层嵌套条件组）（拆分自 FieldConfigPanel.tsx）───
import { Button, Input, InputNumber, Select, Switch, Typography, RadioGroup, Radio } from '@douyinfe/semi-ui';
import { Plus, Trash2, FolderPlus } from 'lucide-react';
import type { WorkflowFormField, WorkflowFieldVisibilityCondition, WorkflowFieldVisibilityRule } from '@arcbase/shared/workflow';
import { isWorkflowRuleGroup } from '@arcbase/shared/workflow';
import { NO_VALUE_OPERATORS, formatVisibilityValue, operatorsForField } from './helpers';

// 根据依赖字段类型与操作符渲染合适的「值」编辑器
function ConditionValueEditor({ refField, operator, value, onChange }: Readonly<{
  refField: WorkflowFormField | undefined;
  operator: string;
  value: unknown;
  onChange: (v: unknown) => void;
}>) {
  if (NO_VALUE_OPERATORS.has(operator)) return null;
  const type = refField?.type;
  const options = refField?.options ?? [];

  if (type === 'switch') {
    return (
      <Select
        value={value === true ? 'true' : value === false ? 'false' : undefined}
        onChange={(v) => onChange(v === 'true')} style={{ width: '100%' }}
        optionList={[{ value: 'true', label: '是 / 开' }, { value: 'false', label: '否 / 关' }]}
        placeholder="选择开关状态"
      />
    );
  }
  if (type === 'number' || type === 'amount' || type === 'slider') {
    return (
      <InputNumber
        value={value as number | undefined}
        onChange={(v) => onChange(v === '' || v === undefined ? undefined : Number(v))}
        style={{ width: '100%' }} placeholder="输入数值"
      />
    );
  }
  if (options.length > 0 && (type === 'select' || type === 'radio' || type === 'multiSelect' || type === 'checkbox')) {
    if (operator === 'in') {
      const arr = Array.isArray(value)
        ? value as string[]
        : (typeof value === 'string' && value ? value.split(',').map(s => s.trim()).filter(Boolean) : []);
      return (
        <Select
          multiple value={arr} onChange={(v) => onChange(v)} style={{ width: '100%' }}
          optionList={options.map(o => ({ value: o, label: o }))}
          placeholder="选择一个或多个值"
        />
      );
    }
    return (
      <Select
        value={value as string | undefined} onChange={onChange} style={{ width: '100%' }}
        optionList={options.map(o => ({ value: o, label: o }))}
        showClear placeholder="选择值"
      />
    );
  }
  return (
    <Input
      value={formatVisibilityValue(value)}
      onChange={(v) => onChange(v)}
      placeholder="条件值（多个值用英文逗号分隔表示「包含在」）"
    />
  );
}

export function VisibilityRulesEditor({
  field,
  conditionFields,
  onChange,
  ruleKey = 'visibilityRules',
  clearLegacy = false,
  toggleLabel = '启用联动规则',
}: Readonly<{
  field: WorkflowFormField;
  conditionFields: WorkflowFormField[];
  onChange: (updates: Partial<WorkflowFormField>) => void;
  ruleKey?: 'visibilityRules' | 'requiredRules' | 'readOnlyRules';
  clearLegacy?: boolean;
  toggleLabel?: string;
}>) {
  const group = field[ruleKey];
  const enabled = !!group && (group.rules?.length ?? 0) > 0;
  const newRule = (): WorkflowFieldVisibilityCondition => ({
    field: conditionFields[0].key,
    operator: 'eq',
    value: '',
  });

  // 设置规则组（显隐规则同时清除旧版单条件，避免冲突）
  const setGroup = (logic: 'and' | 'or', rules: WorkflowFieldVisibilityRule[]) =>
    onChange({ [ruleKey]: { logic, rules }, ...(clearLegacy ? { visibilityCondition: undefined } : {}) });

  const toggle = (v: boolean) => {
    if (v) setGroup('and', [newRule()]);
    else onChange({ [ruleKey]: undefined });
  };

  // path: [index] 顶层条目；[i, j] 子组内第 j 条
  const updateRuleAt = (path: number[], patch: Partial<WorkflowFieldVisibilityCondition>) => {
    if (!group) return;
    const rules = group.rules.map((r, i) => {
      if (i !== path[0]) return r;
      if (path.length === 1) return isWorkflowRuleGroup(r) ? r : { ...r, ...patch };
      if (!isWorkflowRuleGroup(r)) return r;
      return {
        ...r,
        rules: r.rules.map((sub, j) => (j === path[1] && !isWorkflowRuleGroup(sub) ? { ...sub, ...patch } : sub)),
      };
    });
    setGroup(group.logic, rules);
  };

  const removeRuleAt = (path: number[]) => {
    if (!group) return;
    let rules: WorkflowFieldVisibilityRule[];
    if (path.length === 1) {
      rules = group.rules.filter((_, i) => i !== path[0]);
    } else {
      rules = group.rules
        .map((r, i) => {
          if (i !== path[0] || !isWorkflowRuleGroup(r)) return r;
          const subRules = r.rules.filter((_, j) => j !== path[1]);
          return subRules.length > 0 ? { ...r, rules: subRules } : null;
        })
        .filter((r): r is WorkflowFieldVisibilityRule => r != null);
    }
    if (rules.length === 0) onChange({ [ruleKey]: undefined });
    else setGroup(group.logic, rules);
  };

  const addRule = () => {
    if (!group) return;
    setGroup(group.logic, [...group.rules, newRule()]);
  };

  // 添加嵌套子组（子组 logic 默认与父相反，覆盖「A 且 (B 或 C)」高频场景）
  const addSubGroup = () => {
    if (!group) return;
    const subLogic = group.logic === 'and' ? 'or' : 'and';
    setGroup(group.logic, [...group.rules, { logic: subLogic, rules: [newRule(), newRule()] }]);
  };

  const addRuleToGroup = (index: number) => {
    if (!group) return;
    setGroup(group.logic, group.rules.map((r, i) =>
      i === index && isWorkflowRuleGroup(r) ? { ...r, rules: [...r.rules, newRule()] } : r));
  };

  const setSubGroupLogic = (index: number, logic: 'and' | 'or') => {
    if (!group) return;
    setGroup(group.logic, group.rules.map((r, i) =>
      i === index && isWorkflowRuleGroup(r) ? { ...r, logic } : r));
  };

  // 单条条件行（顶层或子组内通用）
  const renderConditionRow = (rule: WorkflowFieldVisibilityCondition, path: number[], removable: boolean) => {
    const refField = conditionFields.find(f => f.key === rule.field);
    const opList = operatorsForField(refField);
    return (
      <div className="fd-form-config__visibility" key={`rule-${path.join('-')}-${rule.field}`} style={{ position: 'relative' }}>
        <div className="fd-form-config__field">
          <Typography.Text size="small">当字段</Typography.Text>
          <Select
            value={rule.field}
            onChange={(v) => {
              const nextField = conditionFields.find(f => f.key === v);
              const nextOps = operatorsForField(nextField);
              const keepOp = nextOps.some(o => o.value === rule.operator) ? rule.operator : nextOps[0].value;
              updateRuleAt(path, { field: v as string, operator: keepOp as WorkflowFieldVisibilityCondition['operator'], value: '' });
            }}
            placeholder="请选择字段"
            style={{ width: '100%' }}
            optionList={conditionFields.map(f => ({ value: f.key, label: f.label }))}
          />
        </div>
        <div className="fd-form-config__field">
          <Typography.Text size="small">条件</Typography.Text>
          <Select
            value={rule.operator}
            onChange={(v) => updateRuleAt(path, {
              operator: v as WorkflowFieldVisibilityCondition['operator'],
              ...(NO_VALUE_OPERATORS.has(v as string) ? { value: '' } : {}),
            })}
            placeholder="请选择条件"
            style={{ width: '100%' }}
            optionList={opList}
          />
        </div>
        {!NO_VALUE_OPERATORS.has(rule.operator) && (
          <div className="fd-form-config__field">
            <Typography.Text size="small">值</Typography.Text>
            <ConditionValueEditor
              refField={refField}
              operator={rule.operator}
              value={rule.value}
              onChange={(v) => updateRuleAt(path, { value: v })}
            />
          </div>
        )}
        {removable && (
          <Button
            size="small"
            type="danger"
            theme="borderless"
            icon={<Trash2 size={12} />}
            onClick={() => removeRuleAt(path)}
            style={{ position: 'absolute', top: 4, right: 0 }}
          />
        )}
      </div>
    );
  };

  return (
    <>
      <div className="fd-form-config__field fd-form-config__field--inline">
        <Typography.Text strong size="small">{toggleLabel}</Typography.Text>
        <Switch checked={enabled} onChange={toggle} size="small" />
      </div>

      {enabled && group && (
        <>
          <div className="fd-form-config__field fd-form-config__field--inline">
            <Typography.Text size="small">满足条件</Typography.Text>
            <RadioGroup
              type="button"
              value={group.logic}
              onChange={(e) => setGroup(e.target.value as 'and' | 'or', group.rules)}
            >
              <Radio value="and">全部（且）</Radio>
              <Radio value="or">任一（或）</Radio>
            </RadioGroup>
          </div>

          {group.rules.map((rule, index) => {
            if (isWorkflowRuleGroup(rule)) {
              return (
                <div className="fd-rule-subgroup" key={`group-${index}`}>
                  <div className="fd-rule-subgroup__head">
                    <RadioGroup
                      type="button"
                      value={rule.logic}
                      onChange={(e) => setSubGroupLogic(index, e.target.value as 'and' | 'or')}
                    >
                      <Radio value="and">且</Radio>
                      <Radio value="or">或</Radio>
                    </RadioGroup>
                    <Button
                      size="small" type="danger" theme="borderless" icon={<Trash2 size={12} />}
                      onClick={() => removeRuleAt([index])} aria-label="删除条件组"
                    />
                  </div>
                  {rule.rules.map((sub, j) =>
                    isWorkflowRuleGroup(sub) ? null : renderConditionRow(sub, [index, j], true))}
                  <Button size="small" type="tertiary" theme="borderless" icon={<Plus size={12} />} onClick={() => addRuleToGroup(index)}>
                    组内加条件
                  </Button>
                </div>
              );
            }
            return renderConditionRow(rule, [index], group.rules.length > 1);
          })}

          <div style={{ display: 'flex', gap: 8, marginTop: 4 }}>
            <Button size="small" type="tertiary" icon={<Plus size={12} />} onClick={addRule}>
              添加条件
            </Button>
            <Button size="small" type="tertiary" icon={<FolderPlus size={12} />} onClick={addSubGroup}>
              添加条件组
            </Button>
          </div>
        </>
      )}
    </>
  );
}
