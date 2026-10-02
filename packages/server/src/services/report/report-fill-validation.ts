import dayjs from 'dayjs';
import { HTTPException } from 'hono/http-exception';
import type { WorkflowFieldVisibilityCondition, WorkflowFieldVisibilityRuleGroup, WorkflowFormField, WorkflowFormSchema } from '@arcbase/shared/workflow';
import { workflowFormSchemaSchema, isWorkflowRuleGroup, collectWorkflowRuleConditions } from '@arcbase/shared/workflow';

const RESERVED_KEYS = new Set([
  'id', 'tenantId', 'templateId', 'templateRevision', 'submitterId', 'status',
  'workflowInstanceId', 'generatedDatasetId', 'createdAt', 'updatedAt',
]);
const UNSUPPORTED_TYPES = new Set(['password', 'formula', 'detail', 'serialNumber', 'relation']);
const NON_VALUE_TYPES = new Set(['description', 'row', 'divider', 'group', 'tabs', 'steps']);
const STRING_TYPES = new Set([
  'text', 'textarea', 'autoComplete', 'colorPicker', 'phone', 'email', 'idCard',
  'url', 'pinCode', 'signature', 'richtext',
]);
const ARRAY_TYPES = new Set(['multiSelect', 'checkbox', 'tags']);

function fail(message: string): never {
  throw new HTTPException(400, { message });
}

function nestedFields(field: WorkflowFormField): WorkflowFormField[] {
  if (field.type === 'row') return (field.columns ?? []).flatMap((column) => column.fields);
  if (field.type === 'tabs' || field.type === 'steps') return (field.panes ?? []).flatMap((pane) => pane.fields);
  return field.children ?? [];
}

export function flattenReportFillFields(fields: WorkflowFormField[]): WorkflowFormField[] {
  const result: WorkflowFormField[] = [];
  const visit = (items: WorkflowFormField[]) => {
    for (const field of items) {
      result.push(field);
      visit(nestedFields(field));
    }
  };
  visit(fields);
  return result;
}

function validateConditionReference(
  condition: WorkflowFieldVisibilityCondition,
  keys: Set<string>,
  label: string,
) {
  if (!keys.has(condition.field)) fail(`${label}引用了不存在的字段：${condition.field}`);
}

function validateRuleGroup(
  group: WorkflowFieldVisibilityRuleGroup | undefined,
  keys: Set<string>,
  label: string,
) {
  for (const condition of collectWorkflowRuleConditions(group)) validateConditionReference(condition, keys, label);
}

function assertSafePattern(pattern: string, label: string) {
  if (pattern.length > 256 || /(?:\([^)]*[+*][^)]*\))[+*{]/.test(pattern)) {
    fail(`${label}的正则表达式过于复杂`);
  }
  try {
    new RegExp(pattern);
  } catch {
    fail(`${label}的正则表达式无效`);
  }
}

/** 在共享 Workflow schema 校验之后执行填报专属语义校验。 */
export function validateReportFillSchema(schema: unknown): WorkflowFormSchema {
  const parsed = workflowFormSchemaSchema.safeParse(schema);
  if (!parsed.success) fail('填报表单定义不符合工作流表单协议');
  const normalized = parsed.data as WorkflowFormSchema;
  const fields = flattenReportFillFields(normalized.fields);
  const keys = new Set<string>();
  for (const field of fields) {
    if (!field.key || !/^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(field.key)) {
      fail(`字段「${field.label || field.key}」的键必须以字母开头且只包含字母、数字和下划线`);
    }
    if (field.key.startsWith('_') || RESERVED_KEYS.has(field.key)) fail(`字段键「${field.key}」为系统保留键`);
    if (keys.has(field.key)) fail(`字段键「${field.key}」重复`);
    keys.add(field.key);
    if (UNSUPPORTED_TYPES.has(field.type)) fail(`字段「${field.label}」使用了填报暂不支持的类型：${field.type}`);
    if (field.dataSourceId) fail(`字段「${field.label}」不能使用远程选项数据源`);
    if (field.pattern) assertSafePattern(field.pattern, `字段「${field.label}」`);
    const optionValues = field.optionItems?.map((item) => item.value) ?? field.options ?? [];
    if (new Set(optionValues).size !== optionValues.length) fail(`字段「${field.label}」存在重复选项`);
    if (field.type === 'row' && !(field.columns?.length)) fail(`栅格字段「${field.label}」必须包含列`);
    if ((field.type === 'tabs' || field.type === 'steps') && !(field.panes?.length)) {
      fail(`容器字段「${field.label}」必须包含面板`);
    }
  }
  for (const field of fields) {
    if (field.visibilityCondition) validateConditionReference(field.visibilityCondition, keys, `字段「${field.label}」的显隐规则`);
    validateRuleGroup(field.visibilityRules, keys, `字段「${field.label}」的显隐规则`);
    validateRuleGroup(field.requiredRules, keys, `字段「${field.label}」的必填规则`);
    validateRuleGroup(field.readOnlyRules, keys, `字段「${field.label}」的只读规则`);
    for (const rule of field.compareRules ?? []) {
      if (!keys.has(rule.field)) fail(`字段「${field.label}」的比较规则引用了不存在的字段：${rule.field}`);
    }
  }
  return normalized;
}

function isEmpty(value: unknown): boolean {
  return value === undefined || value === null || value === '' || (Array.isArray(value) && value.length === 0);
}

function compare(left: unknown, operator: WorkflowFieldVisibilityCondition['operator'], right: unknown): boolean {
  if (operator === 'isEmpty') return isEmpty(left);
  if (operator === 'notEmpty') return !isEmpty(left);
  if (operator === 'in') return Array.isArray(right) && right.includes(left);
  if (operator === 'contains') return Array.isArray(left)
    ? left.includes(right)
    : typeof left === 'string' && left.includes(String(right ?? ''));
  if (operator === 'eq') return left === right;
  if (operator === 'neq') return left !== right;
  const leftValue = typeof left === 'number' ? left : dayjs(String(left)).valueOf();
  const rightValue = typeof right === 'number' ? right : dayjs(String(right)).valueOf();
  if (!Number.isFinite(leftValue) || !Number.isFinite(rightValue)) return false;
  if (operator === 'gt') return leftValue > rightValue;
  if (operator === 'gte') return leftValue >= rightValue;
  if (operator === 'lt') return leftValue < rightValue;
  return leftValue <= rightValue;
}

function matchesGroup(group: WorkflowFieldVisibilityRuleGroup | undefined, values: Record<string, unknown>): boolean {
  if (!group?.rules.length) return false;
  const matches = group.rules.map((rule) =>
    isWorkflowRuleGroup(rule)
      ? matchesGroup(rule, values)
      : compare(values[rule.field], rule.operator, rule.value));
  return group.logic === 'and' ? matches.every(Boolean) : matches.some(Boolean);
}

function isFieldVisible(field: WorkflowFormField, values: Record<string, unknown>): boolean {
  if (field.visibilityRules?.rules.length) return matchesGroup(field.visibilityRules, values);
  if (field.hidden) return false;
  if (field.visibilityCondition?.field) {
    const condition = field.visibilityCondition;
    return compare(values[condition.field], condition.operator, condition.value);
  }
  return true;
}

function visibleReportFillFields(
  fields: WorkflowFormField[],
  values: Record<string, unknown>,
  parentVisible = true,
): WorkflowFormField[] {
  const result: WorkflowFormField[] = [];
  for (const field of fields) {
    const visible = parentVisible && isFieldVisible(field, values);
    if (visible && !NON_VALUE_TYPES.has(field.type)) result.push(field);
    result.push(...visibleReportFillFields(nestedFields(field), values, visible));
  }
  return result;
}

function assertStringValue(field: WorkflowFormField, value: unknown): asserts value is string {
  if (typeof value !== 'string') fail(`字段「${field.label}」必须是文本`);
  if (field.minLength !== undefined && value.length < field.minLength) fail(`字段「${field.label}」长度不能少于 ${field.minLength}`);
  if (field.maxLength !== undefined && value.length > field.maxLength) fail(`字段「${field.label}」长度不能超过 ${field.maxLength}`);
  if (field.pattern && !new RegExp(field.pattern).test(value)) fail(field.patternMessage || `字段「${field.label}」格式不正确`);
}

function assertNumberValue(field: WorkflowFormField, value: unknown): asserts value is number {
  if (typeof value !== 'number' || !Number.isFinite(value)) fail(`字段「${field.label}」必须是有效数字`);
  if (field.min !== undefined && value < field.min) fail(`字段「${field.label}」不能小于 ${field.min}`);
  if (field.max !== undefined && value > field.max) fail(`字段「${field.label}」不能大于 ${field.max}`);
  if (field.precision !== undefined) {
    const decimals = String(value).split('.')[1]?.length ?? 0;
    if (decimals > field.precision) fail(`字段「${field.label}」最多保留 ${field.precision} 位小数`);
  }
}

function assertDateValue(field: WorkflowFormField, value: unknown) {
  // 校验粒度跟随字段声明的 dateFormat：无日 token（如 YYYY-MM / yyyy-MM）的月粒度
  // 字段接受 YYYY-MM，其余仍要求完整日期（可带时间）
  const monthOnly = !!field.dateFormat && !/d/i.test(field.dateFormat);
  if (monthOnly) {
    if (typeof value !== 'string' || !/^\d{4}-(0[1-9]|1[0-2])$/.test(value)) {
      fail(`字段「${field.label}」必须是有效月份（YYYY-MM）`);
    }
  } else if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}(?: \d{2}:\d{2}(?::\d{2})?)?$/.test(value) || !dayjs(value).isValid()) {
    fail(`字段「${field.label}」必须是有效日期`);
  }
  const date = dayjs(value as string);
  if (field.dateLimit === 'noPast' && date.isBefore(dayjs().startOf('day'))) fail(`字段「${field.label}」不能选择过去日期`);
  if (field.dateLimit === 'noFuture' && date.isAfter(dayjs().endOf('day'))) fail(`字段「${field.label}」不能选择未来日期`);
  if (field.dateLimit === 'custom' && field.minDate && date.isBefore(dayjs(field.minDate).startOf('day'))) {
    fail(`字段「${field.label}」不能早于 ${field.minDate}`);
  }
  if (field.dateLimit === 'custom' && field.maxDate && date.isAfter(dayjs(field.maxDate).endOf('day'))) {
    fail(`字段「${field.label}」不能晚于 ${field.maxDate}`);
  }
}

function optionValues(field: WorkflowFormField): Set<string> {
  const values = new Set(field.options ?? []);
  for (const item of field.optionItems ?? []) if (!item.disabled) values.add(item.value);
  for (const mapped of Object.values(field.optionsFrom?.mapping ?? {})) {
    for (const value of mapped) values.add(value);
  }
  return values;
}

function assertOptions(field: WorkflowFormField, value: unknown, multiple: boolean) {
  const allowed = optionValues(field);
  const values = multiple ? value : [value];
  if (!Array.isArray(values) || values.some((item) => typeof item !== 'string')) {
    fail(`字段「${field.label}」选项格式不正确`);
  }
  if (!field.allowOther && values.some((item) => !allowed.has(item))) fail(`字段「${field.label}」包含无效选项`);
  if (field.maxCount !== undefined && values.length > field.maxCount) fail(`字段「${field.label}」最多选择 ${field.maxCount} 项`);
}

function assertValue(field: WorkflowFormField, value: unknown) {
  if (STRING_TYPES.has(field.type)) {
    assertStringValue(field, value);
    if (field.type === 'phone' && !/^1\d{10}$/.test(value)) fail(`字段「${field.label}」手机号格式不正确`);
    if (field.type === 'email' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) fail(`字段「${field.label}」邮箱格式不正确`);
    if (field.type === 'idCard' && !/^(?:\d{15}|\d{17}[\dXx])$/.test(value)) fail(`字段「${field.label}」身份证格式不正确`);
    if (field.type === 'url') {
      try {
        const url = new URL(value);
        if (!['http:', 'https:'].includes(url.protocol)) fail(`字段「${field.label}」网址协议不受支持`);
      } catch {
        fail(`字段「${field.label}」网址格式不正确`);
      }
    }
    return;
  }
  if (field.type === 'number' || field.type === 'amount' || field.type === 'slider' || field.type === 'rate') {
    assertNumberValue(field, value);
    if (field.type === 'rate' && value > (field.rateMax ?? 5)) fail(`字段「${field.label}」评分超出上限`);
    return;
  }
  if (field.type === 'date') return assertDateValue(field, value);
  if (field.type === 'dateRange') {
    if (!Array.isArray(value) || value.length !== 2) fail(`字段「${field.label}」必须是起止日期`);
    assertDateValue(field, value[0]);
    assertDateValue(field, value[1]);
    if (dayjs(value[0] as string).isAfter(dayjs(value[1] as string))) fail(`字段「${field.label}」起始日期不能晚于结束日期`);
    return;
  }
  if (field.type === 'time') {
    if (typeof value !== 'string' || !/^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value)) fail(`字段「${field.label}」时间格式不正确`);
    return;
  }
  if (field.type === 'select' || field.type === 'radio') return assertOptions(field, value, false);
  if (ARRAY_TYPES.has(field.type)) return assertOptions(field, value, true);
  if (field.type === 'switch') {
    if (typeof value !== 'boolean') fail(`字段「${field.label}」必须是布尔值`);
    return;
  }
  if (field.type === 'attachment' || field.type === 'image') {
    if (!Array.isArray(value)) fail(`字段「${field.label}」必须是文件列表`);
    if (field.maxCount !== undefined && value.length > field.maxCount) fail(`字段「${field.label}」最多上传 ${field.maxCount} 个文件`);
    if (value.some((item) => typeof item !== 'string' && (typeof item !== 'object' || item === null))) {
      fail(`字段「${field.label}」文件格式不正确`);
    }
    return;
  }
  if (field.type === 'region') {
    if (typeof value !== 'string' && (!Array.isArray(value) || value.some((item) => typeof item !== 'string'))) {
      fail(`字段「${field.label}」地区格式不正确`);
    }
    return;
  }
  if (field.type === 'userSelect' || field.type === 'deptSelect' || field.type === 'dictSelect') {
    const values = field.multiple ? value : [value];
    if (!Array.isArray(values) || values.some((item) => typeof item !== 'string' && typeof item !== 'number')) {
      fail(`字段「${field.label}」选择值格式不正确`);
    }
  }
}

/** 按记录冻结的 schema 校验值；拒绝未知字段，避免 renderer 绕过。 */
export function validateReportFillValues(
  schema: WorkflowFormSchema,
  values: Record<string, unknown>,
): Record<string, unknown> {
  validateReportFillSchema(schema);
  const declaredFields = flattenReportFillFields(schema.fields).filter((field) => !NON_VALUE_TYPES.has(field.type));
  const declaredByKey = new Map(declaredFields.map((field) => [field.key, field]));
  for (const key of Object.keys(values)) if (!declaredByKey.has(key)) fail(`提交数据包含模板未声明字段：${key}`);
  const normalized: Record<string, unknown> = {};
  for (const field of visibleReportFillFields(schema.fields, values)) {
    const value = values[field.key];
    const required = field.required || matchesGroup(field.requiredRules, values);
    if (isEmpty(value)) {
      if (required) fail(`字段「${field.label}」不能为空`);
      if (Object.hasOwn(values, field.key)) normalized[field.key] = value;
      continue;
    }
    assertValue(field, value);
    for (const rule of field.compareRules ?? []) {
      if (!compare(value, rule.operator, values[rule.field])) {
        fail(rule.message || `字段「${field.label}」比较校验未通过`);
      }
    }
    normalized[field.key] = value;
  }
  return normalized;
}

export function declaredReportFillFields(schema: WorkflowFormSchema): WorkflowFormField[] {
  return flattenReportFillFields(schema.fields).filter((field) => !NON_VALUE_TYPES.has(field.type));
}
