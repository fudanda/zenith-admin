// ─── 布局与外观设置（列宽/只读/隐藏/标签覆盖/分栏/面板/分组，拆分自 FieldConfigPanel.tsx）───
import { Button, Input, InputNumber, Select, Switch, Typography } from '@douyinfe/semi-ui';
import { Plus, Trash2 } from 'lucide-react';
import type { WorkflowFormField } from '@arcbase/shared/workflow';
import { COLUMN_SPAN_OPTIONS, LABEL_POSITION_OPTIONS, LABEL_ALIGN_OPTIONS } from '../../form-types';
import type { FieldTypeFlags } from './field-type-flags';

interface AppearanceSectionProps {
  field: WorkflowFormField;
  flags: FieldTypeFlags;
  onChange: (updates: Partial<WorkflowFormField>) => void;
}

export function AppearanceSection({ field, flags, onChange }: Readonly<AppearanceSectionProps>) {
  const { supportsLayoutState, supportsLabelOverride, isPanesContainer } = flags;

  return (
    <>
          {/* --- 布局与状态（响应式列宽 / 只读 / 隐藏） --- */}
          {supportsLayoutState && (
            <div className="fd-form-config__section" style={{ borderTop: '1px solid var(--semi-color-border)', padding: '12px 0 0', marginTop: 12 }}>
              <div className="fd-form-config__section-title">布局与状态</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">字段宽度</Typography.Text>
                <Select
                  value={field.columnSpan ?? 24}
                  onChange={(v) => onChange({ columnSpan: Number(v) })}
                  style={{ width: '100%' }}
                  optionList={COLUMN_SPAN_OPTIONS}
                />
                <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                  同一行内多个字段会按宽度自动并排（飞书风格）
                </Typography.Text>
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">只读</Typography.Text>
                <Switch
                  checked={field.readOnly ?? false}
                  onChange={(v) => onChange({ readOnly: v || undefined })}
                  size="small"
                />
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">默认隐藏</Typography.Text>
                <Switch
                  checked={field.hidden ?? false}
                  onChange={(v) => onChange({ hidden: v || undefined })}
                  size="small"
                />
              </div>
              {field.hidden && (
                <Typography.Text type="tertiary" size="small" style={{ display: 'block' }}>
                  默认隐藏后，可在「显隐设置」中配置满足条件时再显示
                </Typography.Text>
              )}
            </div>
          )}

          {/* --- 字段级标签设置（覆盖表单级） --- */}
          {supportsLabelOverride && (
            <div className="fd-form-config__section" style={{ borderTop: '1px solid var(--semi-color-border)', padding: '12px 0 0', marginTop: 12 }}>
              <div className="fd-form-config__section-title">标签设置（覆盖表单级）</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">标签位置</Typography.Text>
                <Select
                  value={field.labelPosition ?? ''}
                  onChange={(v) => onChange({ labelPosition: v as 'top' | 'left' | 'inset' | undefined })}
                  placeholder="跟随表单设置"
                  style={{ width: '100%' }}
                  showClear
                  optionList={[{ value: '', label: '跟随表单' }, ...LABEL_POSITION_OPTIONS]}
                />
              </div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small">标签对齐</Typography.Text>
                <Select
                  value={field.labelAlign ?? ''}
                  onChange={(v) => onChange({ labelAlign: v as 'left' | 'right' | undefined })}
                  placeholder="跟随表单设置"
                  style={{ width: '100%' }}
                  showClear
                  optionList={[{ value: '', label: '跟随表单' }, ...LABEL_ALIGN_OPTIONS]}
                />
              </div>
              {(field.labelPosition === 'left' || field.labelPosition === 'inset') && (
                <div className="fd-form-config__field">
                  <Typography.Text strong size="small">标签宽度</Typography.Text>
                  <InputNumber
                    value={field.labelWidth}
                    onChange={(v) => onChange({ labelWidth: v === undefined || v === '' ? undefined : Number(v) })}
                    min={40}
                    max={400}
                    suffix="px"
                    placeholder="跟随表单"
                    style={{ width: '100%' }}
                  />
                </div>
              )}
            </div>
          )}

          {/* --- 分栏设置 --- */}
          {field.type === 'row' && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">分栏设置</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small" style={{ marginBottom: 4, display: 'block' }}>列数</Typography.Text>
                <InputNumber
                  min={2} max={4}
                  value={field.columns?.length || 2}
                  placeholder="请输入列数"
                  onChange={(val) => {
                    const num = Number(val) || 2;
                    const existing = field.columns || [];
                    const newCols = Array.from({ length: num }, (_, i) =>
                      existing[i] || { span: Math.floor(24 / num), fields: [] }
                    );
                    onChange({ columns: newCols });
                  }}
                  style={{ width: '100%' }}
                />
              </div>
              {field.columns?.map((col, i) => (
                <div className="fd-form-config__field" key={`${col.span}-${i}`}>
                  <Typography.Text size="small" style={{ marginBottom: 4, display: 'block' }}>第 {i + 1} 列宽度 (24栅格)</Typography.Text>
                  <InputNumber
                    min={1} max={24}
                    value={col.span}
                    placeholder="请输入列宽"
                    onChange={(val) => {
                      const newCols = [...(field.columns || [])];
                      newCols[i] = { ...newCols[i], span: Number(val) || 1 };
                      onChange({ columns: newCols });
                    }}
                    style={{ width: '100%' }}
                  />
                </div>
              ))}
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 12, marginTop: 4 }}>
                总宽度: {field.columns?.reduce((s, c) => s + c.span, 0) || 0} / 24
                {(field.columns?.reduce((s, c) => s + c.span, 0) || 0) !== 24 && (
                  <span style={{ color: 'var(--semi-color-danger)', marginLeft: 8 }}>⚠ 建议总宽度为24</span>
                )}
              </div>
            </div>
          )}

          {/* --- 分割线设置 --- */}
          {field.type === 'divider' && (
            <div className="fd-form-config__field" style={{ marginTop: 12 }}>
              <div style={{ color: 'var(--semi-color-text-2)', fontSize: 13 }}>
                分割线用于视觉分隔表单区域，除了上方可配置的"名称"外无需额外配置。
              </div>
            </div>
          )}

          {/* --- 标签页 / 分步 面板设置 --- */}
          {isPanesContainer && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">{field.type === 'tabs' ? '标签页设置' : '分步设置'}</div>
              {(field.panes ?? []).map((pane, i) => (
                <div className="fd-form-config__field" key={`pane-${i}`} style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                  <Input
                    size="small"
                    value={pane.title}
                    onChange={(val) => {
                      const next = [...(field.panes ?? [])];
                      next[i] = { ...next[i], title: val };
                      onChange({ panes: next });
                    }}
                    placeholder={`${field.type === 'tabs' ? '标签' : '步骤'}${i + 1}标题`}
                    style={{ flex: 1 }}
                  />
                  <button
                    type="button"
                    className="fd-options-editor__delete"
                    title={(field.panes?.length ?? 0) <= 1 ? '至少保留一个面板' : '删除面板'}
                    disabled={(field.panes?.length ?? 0) <= 1}
                    onClick={() => {
                      const next = (field.panes ?? []).filter((_, idx) => idx !== i);
                      onChange({ panes: next });
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              ))}
              <Button
                size="small"
                type="tertiary"
                icon={<Plus size={12} />}
                onClick={() => {
                  const panes = field.panes ?? [];
                  const label = field.type === 'tabs' ? '标签' : '步骤';
                  onChange({ panes: [...panes, { title: `${label}${panes.length + 1}`, fields: [] }] });
                }}
              >
                添加{field.type === 'tabs' ? '标签' : '步骤'}
              </Button>
              <Typography.Text type="tertiary" size="small" style={{ display: 'block', marginTop: 4 }}>
                删除面板会一并删除其中字段；把控件拖入面板内即可分配。
              </Typography.Text>
            </div>
          )}

          {/* --- 分组设置 --- */}
          {field.type === 'group' && (
            <div className="fd-form-config__section" style={{ borderTop: 'none', padding: 0, marginTop: 12 }}>
              <div className="fd-form-config__section-title">分组设置</div>
              <div className="fd-form-config__field">
                <Typography.Text strong size="small" style={{ marginBottom: 4, display: 'block' }}>分组标题</Typography.Text>
                <Input
                  value={field.title || ''}
                  onChange={(val) => onChange({ title: val })}
                  placeholder="输入分组标题"
                />
              </div>
              <div className="fd-form-config__field fd-form-config__field--inline">
                <Typography.Text strong size="small">可折叠</Typography.Text>
                <Switch
                  checked={field.collapsible ?? false}
                  onChange={(v) => onChange({ collapsible: v || undefined, ...(v ? {} : { defaultCollapsed: undefined }) })}
                  size="small"
                />
              </div>
              {field.collapsible && (
                <div className="fd-form-config__field fd-form-config__field--inline">
                  <Typography.Text strong size="small">默认折叠</Typography.Text>
                  <Switch
                    checked={field.defaultCollapsed ?? false}
                    onChange={(v) => onChange({ defaultCollapsed: v || undefined })}
                    size="small"
                  />
                </div>
              )}
            </div>
          )}
    </>
  );
}
