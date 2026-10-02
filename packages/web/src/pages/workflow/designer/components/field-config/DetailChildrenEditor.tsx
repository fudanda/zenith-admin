// ─── 明细子字段编辑器（拆分自 FieldConfigPanel.tsx）───
import { useState } from 'react';
import { Button, Input, InputNumber, Select, TagInput, TextArea, Toast, Tooltip, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkflowFormField, WorkflowFormFieldType } from '@arcbase/shared/workflow';
import { createLocalFieldKey } from './helpers';

// ─── 明细子字段编辑器 ────────────────────────────────────────────────

const DETAIL_CHILD_TYPES: Array<{ value: WorkflowFormFieldType; label: string }> = [
  { value: 'text', label: '文本' },
  { value: 'number', label: '数字' },
  { value: 'amount', label: '金额' },
  { value: 'date', label: '日期' },
  { value: 'select', label: '单选' },
];

export function DetailChildrenEditor({
  items,
  onChange,
}: Readonly<{ items: WorkflowFormField[]; onChange: (fields: WorkflowFormField[]) => void }>) {
  // 展开行内公式/校验编辑的列下标
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null);

  const addChild = () => {
    const key = createLocalFieldKey('text');
    onChange([
      ...items,
      { key, label: `列${items.length + 1}`, type: 'text' },
    ]);
  };

  const updateChild = (index: number, updates: Partial<WorkflowFormField>) => {
    const updated = [...items];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const removeChild = (index: number) => {
    onChange(items.filter((_, i) => i !== index));
  };

  return (
    <div className="fd-detail-children">
      {items.map((child, i) => (
        <div key={child.key}>
          <div className="fd-detail-children__row">
          <Input
            size="small"
            value={child.label}
            onChange={(v) => updateChild(i, { label: v })}
            placeholder="列名"
            style={{ flex: 1 }}
          />
          <Select
            size="small"
            value={child.type}
            onChange={(v) => updateChild(i, { type: v as WorkflowFormFieldType })}
            placeholder="选择类型"
            style={{ width: 90 }}
            optionList={DETAIL_CHILD_TYPES}
          />
          {(child.type === 'select') && (
            <TagInput
              size="small"
              value={child.options ?? []}
              onChange={(v) => updateChild(i, { options: v })}
              placeholder="选项"
              style={{ flex: 1 }}
            />
          )}
          {(child.type === 'number' || child.type === 'amount') && (
            <button
              type="button"
              className={`fd-detail-children__sum ${child.detailSummary ? 'fd-detail-children__sum--active' : ''}`}
              title={child.detailSummary ? '取消合计' : '在底部显示合计'}
              onClick={() => updateChild(i, { detailSummary: !child.detailSummary })}
            >
              Σ
            </button>
          )}
          <Tooltip content="列宽（px），留空自动均分">
            <InputNumber
              size="small"
              value={child.detailColumnWidth}
              onChange={(v) => updateChild(i, { detailColumnWidth: v === undefined || v === '' ? undefined : Number(v) })}
              min={40}
              max={800}
              placeholder="宽"
              hideButtons
              style={{ width: 56 }}
            />
          </Tooltip>
          <button
            type="button"
            className={`fd-detail-children__sum ${child.unique ? 'fd-detail-children__sum--active' : ''}`}
            title={child.unique ? '取消禁止重复' : '该列值不可重复'}
            onClick={() => updateChild(i, { unique: !child.unique || undefined })}
          >
            唯
          </button>
          <button
            type="button"
            className={`fd-detail-children__sum ${(child.formula || child.validationFormula || expandedIndex === i) ? 'fd-detail-children__sum--active' : ''}`}
            title="列设置：key / 行内公式 / 校验公式"
            onClick={() => setExpandedIndex(expandedIndex === i ? null : i)}
          >
            fx
          </button>
          <button
            type="button"
            className="fd-detail-children__delete"
            onClick={() => removeChild(i)}
          >
            <Trash2 size={12} />
          </button>
          </div>
          {expandedIndex === i && (
            <div className="fd-detail-children__fx">
              <Typography.Text strong size="small">列标识 key</Typography.Text>
              <Input
                key={`key-editor-${child.key}`}
                size="small"
                defaultValue={child.key}
                placeholder="用于公式引用与提交数据"
                onBlur={(e) => {
                  const v = e.target.value.trim();
                  if (!v || v === child.key) return;
                  if (items.some((c, ci) => ci !== i && c.key === v)) {
                    Toast.error(`列 key「${v}」与其他列重复`);
                    return;
                  }
                  updateChild(i, { key: v });
                  Toast.success(`列 key 已改为 ${v}，引用该列的公式需同步调整`);
                }}
              />
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginBottom: 6 }}>
                {'行内公式用 {key} 引用本列，主表汇总用 {明细key.列key} 引用'}
              </Typography.Text>
              <Typography.Text strong size="small">行内公式</Typography.Text>
              <TextArea
                value={child.formula ?? ''}
                onChange={(v) => updateChild(i, { formula: v || undefined })}
                placeholder={'引用同行其它列，如 {qty}*{price}；设置后该列只读自动计算'}
                rows={2}
              />
              <Typography.Text strong size="small" style={{ marginTop: 6, display: 'block' }}>行内校验公式</Typography.Text>
              <TextArea
                value={child.validationFormula ?? ''}
                onChange={(v) => updateChild(i, { validationFormula: v || undefined })}
                placeholder={'结果为真通过，如 {qty} > 0'}
                rows={2}
              />
              {child.validationFormula && (
                <Input
                  size="small"
                  style={{ marginTop: 6 }}
                  value={child.validationMessage ?? ''}
                  onChange={(v) => updateChild(i, { validationMessage: v || undefined })}
                  placeholder="校验失败提示（可选）"
                />
              )}
            </div>
          )}
        </div>
      ))}
      <Button
        size="small"
        type="tertiary"
        icon={<Plus size={12} />}
        onClick={addChild}
      >
        添加列
      </Button>
    </div>
  );
}
