// ─── 显隐/条件必填/条件只读设置（拆分自 FieldConfigPanel.tsx）───
import { Divider, Typography } from '@douyinfe/semi-ui';
import type { WorkflowFormField } from '@arcbase/shared/workflow';
import type { FieldTypeFlags } from './field-type-flags';
import { VisibilityRulesEditor } from './VisibilityRulesEditor';

interface VisibilitySectionProps {
  field: WorkflowFormField;
  conditionFields: WorkflowFormField[];
  flags: FieldTypeFlags;
  onChange: (updates: Partial<WorkflowFormField>) => void;
}

export function VisibilitySection({ field, conditionFields, flags, onChange }: Readonly<VisibilitySectionProps>) {
  const { supportsLayoutState } = flags;

  return (
        <div className="fd-form-config__section">
          <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 12 }}>
            配置多条件组合（且 / 或）联动；规则优先级高于「默认隐藏」
          </Typography.Text>

          {conditionFields.length === 0 ? (
            <Typography.Text type="tertiary" size="small">
              暂无可作为条件的字段（需要先添加单选/多选/数字/文本等类型字段）
            </Typography.Text>
          ) : (
            <>
              <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>显隐联动</Typography.Text>
              <VisibilityRulesEditor
                field={field}
                conditionFields={conditionFields}
                onChange={onChange}
                ruleKey="visibilityRules"
                clearLegacy
                toggleLabel="启用条件显隐"
              />

              {supportsLayoutState && (
                <>
                  <Divider style={{ margin: '14px 0 10px' }} />
                  <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>条件必填</Typography.Text>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                    满足条件时该字段变为必填（与固定「必填」取或）
                  </Typography.Text>
                  <VisibilityRulesEditor
                    field={field}
                    conditionFields={conditionFields}
                    onChange={onChange}
                    ruleKey="requiredRules"
                    toggleLabel="启用条件必填"
                  />

                  <Divider style={{ margin: '14px 0 10px' }} />
                  <Typography.Text strong size="small" style={{ display: 'block', marginBottom: 6 }}>条件只读</Typography.Text>
                  <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                    满足条件时该字段变为只读（不可编辑）
                  </Typography.Text>
                  <VisibilityRulesEditor
                    field={field}
                    conditionFields={conditionFields}
                    onChange={onChange}
                    ruleKey="readOnlyRules"
                    toggleLabel="启用条件只读"
                  />
                </>
              )}
            </>
          )}
        </div>
  );
}
