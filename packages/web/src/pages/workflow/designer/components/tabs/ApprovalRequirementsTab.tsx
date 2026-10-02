/**
 * 审批要求配置 Tab
 * 签名策略与审批意见分开配置。
 */
import { Checkbox, Select, Typography } from '@douyinfe/semi-ui';
import { WORKFLOW_SIGNATURE_POLICY_OPTIONS } from '@arcbase/shared/workflow';
import type { OperationPermission } from '../../types';

/** 操作权限分组定义 */
const OPERATION_GROUPS = [
  {
    title: '审批意见',
    items: [
      { value: 'opinionRequired' as OperationPermission, label: '提交审批需审批人填写审批意见', desc: '' },
    ],
  },
];

interface ApprovalRequirementsTabProps {
  operations: OperationPermission[];
  onChange: (operations: OperationPermission[]) => void;
  signaturePolicy: 'none' | 'reusable' | 'handwritten';
  onSignaturePolicyChange: (policy: 'none' | 'reusable' | 'handwritten') => void;
}

export default function ApprovalRequirementsTab({
  operations,
  onChange,
  signaturePolicy,
  onSignaturePolicyChange,
}: Readonly<ApprovalRequirementsTabProps>) {

  const addOp = (value: OperationPermission) => onChange([...operations, value]);
  const removeOp = (value: OperationPermission) => onChange(operations.filter(v => v !== value));

  return (
    <div className="fd-drawer-tab-content">
      <div className="fd-operation-group">
        <div className="fd-operation-group__title">签名要求</div>
        <Select value={signaturePolicy} style={{ width: '100%' }} optionList={WORKFLOW_SIGNATURE_POLICY_OPTIONS}
          onChange={(value) => onSignaturePolicyChange(value as 'none' | 'reusable' | 'handwritten')} />
        <Typography.Paragraph type="tertiary" size="small" style={{ marginTop: 8 }}>
          {signaturePolicy === 'reusable' ? '审批人可确认使用个人签名，也可重新手写；支持明确确认后的批量签署。'
            : signaturePolicy === 'handwritten' ? '每次同意均需现场重新手写，不能使用个人签名或批量同意。'
            : '同意时无需提供签名。'}
        </Typography.Paragraph>
      </div>
      {OPERATION_GROUPS.map(group => (
        <div key={group.title} className="fd-operation-group">
          <div className="fd-operation-group__title">{group.title}</div>
          <div style={{ borderTop: '1px solid var(--semi-color-border)', paddingTop: 12 }}>
            <div className="fd-operation-group__items">
              {group.items.map(item => (
                <div key={item.value}>
                  <Checkbox
                    checked={operations.includes(item.value)}
                    onChange={(e) => {
                      if (e.target.checked) addOp(item.value);
                      else removeOp(item.value);
                    }}
                  >
                    {item.label}
                  </Checkbox>
                  {item.desc && (
                    <div className="fd-operation-group__item-desc">{item.desc}</div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
