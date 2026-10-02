import type { ReportResourceType } from '@arcbase/shared/report';

export const REPORT_RESOURCE_TYPE_OPTIONS = [
  { value: 'datasource', label: '数据源' },
  { value: 'dataset', label: '数据集' },
  { value: 'dashboard', label: '仪表盘' },
  { value: 'metric', label: '指标' },
  { value: 'print_template', label: '打印模板' },
  { value: 'fill_template', label: '填报模板' },
  { value: 'asset_template', label: '资产模板' },
] satisfies Array<{ value: ReportResourceType; label: string }>;

export function reportResourceTypeLabel(value: ReportResourceType): string {
  return REPORT_RESOURCE_TYPE_OPTIONS.find((item) => item.value === value)?.label ?? value;
}
