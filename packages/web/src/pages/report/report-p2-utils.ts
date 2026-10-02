import { createReportFillTemplateSchema, updateReportFillTemplateSchema } from '@arcbase/shared/report';
import type { CreateReportFillTemplateInput, ReportChatbiMessage, ReportDataResult, ReportFieldType, ReportFillRecord, ReportFillRecordStatus, ReportWidget, ReportWidgetType, UpdateReportFillTemplateInput } from '@arcbase/shared/report';
import { ApiError } from '@/lib/query';

const SAFE_CHATBI_CHART_TYPES = new Set<ReportWidgetType>([
  'table', 'kpi', 'bar', 'line', 'area', 'pie', 'scatter', 'radar', 'funnel', 'gauge', 'treemap',
]);

function inferFieldType(rows: Record<string, unknown>[], name: string): ReportFieldType {
  const value = rows.find((row) => row[name] !== null && row[name] !== undefined)?.[name];
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  return 'string';
}

export function buildChatbiDataResult(message: ReportChatbiMessage): ReportDataResult {
  const columns = Array.from(new Set(message.resultSample.flatMap((row) => Object.keys(row))));
  return {
    columns,
    fields: columns.map((name) => ({ name, label: name, type: inferFieldType(message.resultSample, name) })),
    rows: message.resultSample,
    total: message.resultRowCount,
    bytes: message.resultByteSize,
    truncated: message.resultRowCount > message.resultSample.length,
  };
}

export function supportedChatbiChartTypes(message: ReportChatbiMessage): ReportWidgetType[] {
  const result = buildChatbiDataResult(message);
  const numberFields = result.fields.filter((field) => field.type === 'number');
  const categoryFields = result.fields.filter((field) => field.type !== 'number');
  const supported: ReportWidgetType[] = ['table'];
  if (numberFields.length) supported.push('kpi', 'gauge');
  if (numberFields.length && categoryFields.length) {
    supported.push('bar', 'line', 'area', 'pie', 'radar', 'funnel', 'treemap');
  }
  if (numberFields.length >= 2) supported.push('scatter');
  const suggested = message.chartSuggestion?.type;
  if (suggested && SAFE_CHATBI_CHART_TYPES.has(suggested) && !supported.includes(suggested)) {
    supported.push(suggested);
  }
  return supported;
}

export function buildSafeChatbiWidget(
  message: ReportChatbiMessage,
  requestedType?: ReportWidgetType,
  datasetId?: number | null,
): ReportWidget {
  const result = buildChatbiDataResult(message);
  const suggested = message.chartSuggestion;
  const supported = supportedChatbiChartTypes(message);
  const type = requestedType && supported.includes(requestedType)
    ? requestedType
    : suggested && supported.includes(suggested.type)
      ? suggested.type
      : 'table';
  const categoryField = suggested?.categoryField && result.columns.includes(suggested.categoryField)
    ? suggested.categoryField
    : result.fields.find((field) => field.type !== 'number')?.name ?? result.columns[0];
  const suggestedValues = suggested?.valueFields?.filter((field) => (
    result.fields.some((candidate) => candidate.name === field && candidate.type === 'number')
  ));
  const valueFields = suggestedValues?.length
    ? suggestedValues
    : result.fields.filter((field) => field.type === 'number').map((field) => field.name).slice(0, 3);
  return {
    i: `chatbi-${message.id}`,
    type,
    title: suggested?.title || '智能问数结果',
    datasetId: datasetId ?? message.savedDatasetId ?? -1,
    options: {
      categoryField,
      valueFields,
      valueField: valueFields[0],
      columns: result.fields,
      pageSize: 10,
      showLabel: true,
    },
    style: { showHeader: false, borderless: true },
  };
}

export function chatbiRequestErrorMessage(error: unknown, aborted = false): string {
  if (aborted) return '本次提问已取消，已生成的会话历史将自动同步。';
  if (error instanceof ApiError && error.code === 404) return '会话不存在或你无权访问该会话。';
  if (error instanceof ApiError && error.code === 422) return `回答生成失败：${error.message}`;
  return error instanceof Error ? error.message : '智能问数请求失败，请稍后重试。';
}

export function getChatbiSavedResourceAction(message: Pick<
  ReportChatbiMessage,
  'savedResourceId' | 'savedResourceType'
>): { label: string; resourceType: 'dataset' | 'dashboard' } | null {
  if (
    !message.savedResourceId
    || (message.savedResourceType !== 'dataset' && message.savedResourceType !== 'dashboard')
  ) return null;
  return {
    label: `查看已保存${message.savedResourceType === 'dashboard' ? '仪表盘' : '数据集'}`,
    resourceType: message.savedResourceType,
  };
}

type FillAction = 'edit' | 'submit' | 'withdraw' | 'review';

const FILL_ACTION_STATUSES: Record<Exclude<FillAction, 'review'>, readonly ReportFillRecordStatus[]> = {
  edit: ['draft', 'rejected'],
  submit: ['draft', 'rejected'],
  withdraw: ['draft', 'rejected', 'submitted', 'in_review'],
};

export function canRunFillRecordAction(
  record: Pick<
    ReportFillRecord,
    'status' | 'templateNeedReview' | 'workflowDefinitionIdSnapshot' | 'workflowInstanceId'
  >,
  action: FillAction,
  canReview = false,
): boolean {
  if (action !== 'review') return FILL_ACTION_STATUSES[action].includes(record.status);
  return canReview
    && record.templateNeedReview
    && !record.workflowDefinitionIdSnapshot
    && !record.workflowInstanceId
    && (record.status === 'submitted' || record.status === 'in_review');
}

export function shouldShowFillReviewTab(canReview: boolean): boolean {
  return canReview;
}

export async function submitFillEntryValues(
  values: Record<string, unknown>,
  persist: (values: Record<string, unknown>) => Promise<Pick<ReportFillRecord, 'id' | 'revision'>>,
  submit: (id: number, expectedRevision: number) => Promise<ReportFillRecord>,
): Promise<ReportFillRecord> {
  const draft = await persist(values);
  return submit(draft.id, draft.revision);
}

export function validateFillTemplateInput(
  input: CreateReportFillTemplateInput | UpdateReportFillTemplateInput,
  editing: boolean,
): { success: true } | { success: false; message: string } {
  const result = editing
    ? updateReportFillTemplateSchema.safeParse(input)
    : createReportFillTemplateSchema.safeParse(input);
  if (result.success) return { success: true };
  return { success: false, message: result.error.issues[0]?.message ?? '模板配置无效' };
}

export function isRevisionConflict(error: unknown): boolean {
  return error instanceof ApiError && error.code === 409;
}
