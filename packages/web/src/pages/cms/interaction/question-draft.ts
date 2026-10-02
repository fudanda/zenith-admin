import { CMS_INTERACTION_CHOICE_QUESTION_TYPES, CMS_INTERACTION_MATRIX_SEPARATOR, CMS_INTERACTION_NPS_MAX, CMS_INTERACTION_OTHER_VALUE, CMS_INTERACTION_RATING_MAX_LIMIT } from '@arcbase/shared/cms';
import type { CmsInteractionConditionOp, CmsInteractionKind, CmsInteractionMatrixRow, CmsInteractionQuestion, CmsInteractionQuestionType, CmsInteractionVisibleWhen } from '@arcbase/shared/cms';

export type QuestionOption = CmsInteractionQuestion['options'][number];

export interface QuestionDraft {
  /** 前端稳定 key（新建题目无后端 id 时用于 React key 与错误定位） */
  key: string;
  /** 后端题目 id，仅编辑既有题目时存在 */
  id?: number;
  label: string;
  type: CmsInteractionQuestionType;
  required: boolean;
  minChoices: number;
  maxChoices: number;
  options: QuestionOption[];
  allowOther: boolean;
  otherLabel: string;
  ratingMax: number;
  matrixRows: CmsInteractionMatrixRow[];
  pageNo: number;
  visibleWhen: CmsInteractionVisibleWhen | null;
}

export const CHOICE_TYPES: readonly CmsInteractionQuestionType[] = CMS_INTERACTION_CHOICE_QUESTION_TYPES;
/** 支持「其他 ___」填空的题型 */
export const OTHER_CAPABLE_TYPES: readonly CmsInteractionQuestionType[] = ['single', 'multiple'];
/** 可作为条件显示依据的题型 */
export const CONDITION_SOURCE_TYPES: readonly CmsInteractionQuestionType[] = ['single', 'multiple'];

export function isChoiceType(type: CmsInteractionQuestionType): boolean {
  return CHOICE_TYPES.includes(type);
}

let keySeed = 0;
/** 生成进程内唯一的前端 key（题目 / 选项通用） */
export function nextKey(prefix: string): string {
  keySeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeed}`;
}

/** 选项 id 需匹配后端 `^[A-Za-z0-9_-]+$`，此处只生成合规字符 */
function nextStableId(prefix: string): string {
  keySeed += 1;
  return `${prefix}-${Date.now().toString(36)}-${keySeed}`;
}

export function createOption(label = ''): QuestionOption {
  const id = nextStableId('opt');
  return { id, label, value: id };
}

export function createMatrixRow(label = ''): CmsInteractionMatrixRow {
  return { id: nextStableId('row'), label };
}

export function createQuestion(type: CmsInteractionQuestionType = 'single'): QuestionDraft {
  return {
    key: nextKey('q'),
    label: '',
    type,
    required: true,
    minChoices: type === 'multiple' ? 1 : (type === 'single' ? 1 : 0),
    maxChoices: 1,
    options: isChoiceType(type) ? [createOption('选项一'), createOption('选项二')] : [],
    allowOther: false,
    otherLabel: '',
    ratingMax: type === 'nps' ? CMS_INTERACTION_NPS_MAX : 5,
    matrixRows: type === 'matrix' ? [createMatrixRow('第一行'), createMatrixRow('第二行')] : [],
    pageNo: 1,
    visibleWhen: null,
  };
}

export function questionToDraft(question: CmsInteractionQuestion): QuestionDraft {
  return {
    key: nextKey('q'),
    id: question.id,
    label: question.label,
    type: question.type,
    required: question.required,
    minChoices: question.minChoices,
    maxChoices: question.maxChoices,
    options: (question.options ?? []).map((option) => ({ ...option })),
    allowOther: question.allowOther ?? false,
    otherLabel: question.otherLabel ?? '',
    ratingMax: question.ratingMax ?? 5,
    matrixRows: (question.matrixRows ?? []).map((row) => ({ ...row })),
    pageNo: question.pageNo ?? 1,
    visibleWhen: question.visibleWhen ?? null,
  };
}

/** 同级上移（dir=-1）/ 下移（dir=1）；越界时原样返回 */
export function moveItem<T>(list: T[], index: number, dir: -1 | 1): T[] {
  const target = index + dir;
  if (index < 0 || index >= list.length || target < 0 || target >= list.length) return list;
  const next = [...list];
  [next[index], next[target]] = [next[target], next[index]];
  return next;
}

/** 复制题目：清除后端 id 与选项/行 id，避免与原题目冲突 */
export function duplicateQuestion(question: QuestionDraft): QuestionDraft {
  return {
    ...question,
    key: nextKey('q'),
    id: undefined,
    label: question.label ? `${question.label}（副本）` : '',
    options: question.options.map((option) => createOption(option.label)),
    matrixRows: question.matrixRows.map((row) => createMatrixRow(row.label)),
    // 条件依赖的是题序，复制后语义不再成立，直接清空
    visibleWhen: null,
  };
}

/** 「每行一个」文本 → 选项数组；尽量复用同名旧选项的 id/value，保持答卷口径稳定 */
export function parseOptionsText(text: string, existing: QuestionOption[] = []): QuestionOption[] {
  const pool = new Map<string, QuestionOption[]>();
  existing.forEach((option) => {
    const bucket = pool.get(option.label);
    if (bucket) bucket.push(option);
    else pool.set(option.label, [option]);
  });
  return text
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean)
    .map((label) => pool.get(label)?.shift() ?? createOption(label));
}

export function stringifyOptions(options: { label: string }[]): string {
  return options.map((option) => option.label).join('\n');
}

/** 返回重复出现的文案（用于行内重复提示） */
export function duplicateLabels(items: { label: string }[]): Set<string> {
  const seen = new Set<string>();
  const duplicates = new Set<string>();
  items.forEach((item) => {
    const label = item.label.trim();
    if (!label) return;
    if (seen.has(label)) duplicates.add(label);
    else seen.add(label);
  });
  return duplicates;
}

/** 切换题型时同步收敛选项、矩阵行与选择数量约束 */
export function applyQuestionType(question: QuestionDraft, type: CmsInteractionQuestionType): QuestionDraft {
  if (type === question.type) return question;
  const next: QuestionDraft = {
    ...question,
    type,
    allowOther: OTHER_CAPABLE_TYPES.includes(type) ? question.allowOther : false,
    ratingMax: type === 'nps' ? CMS_INTERACTION_NPS_MAX : (question.ratingMax || 5),
    matrixRows: type === 'matrix'
      ? (question.matrixRows.length > 0 ? question.matrixRows : [createMatrixRow('第一行'), createMatrixRow('第二行')])
      : [],
  };
  if (!isChoiceType(type)) {
    return { ...next, options: [], minChoices: 0, maxChoices: 1 };
  }
  const options = question.options.length > 0
    ? question.options
    : [createOption('选项一'), createOption('选项二')];
  if (type === 'multiple') {
    return {
      ...next,
      options,
      minChoices: Math.max(0, question.minChoices),
      maxChoices: Math.min(Math.max(question.maxChoices, 1), options.length),
    };
  }
  return { ...next, options, minChoices: type === 'single' ? 1 : 0, maxChoices: 1 };
}

/**
 * 题目增删/排序后重算条件引用。
 * `moved[newIndex] = oldIndex`；引用失效（指向自身或后面的题目）时清除条件。
 */
export function remapConditions(questions: QuestionDraft[], moved: number[]): QuestionDraft[] {
  const oldToNew = new Map<number, number>();
  moved.forEach((oldIndex, newIndex) => {
    if (oldIndex >= 0) oldToNew.set(oldIndex, newIndex);
  });
  return questions.map((question, index) => {
    if (!question.visibleWhen) return question;
    const mapped = oldToNew.get(question.visibleWhen.questionIndex);
    if (mapped === undefined || mapped >= index) return { ...question, visibleWhen: null };
    if (mapped === question.visibleWhen.questionIndex) return question;
    return { ...question, visibleWhen: { ...question.visibleWhen, questionIndex: mapped } };
  });
}

/** 页码归一化：保持相对顺序的前提下压缩成 1..N 连续页 */
export function normalizePageNumbers(questions: QuestionDraft[]): QuestionDraft[] {
  const pages = [...new Set(questions.map((question) => question.pageNo))].sort((a, b) => a - b);
  const remap = new Map(pages.map((page, index) => [page, index + 1]));
  return questions.map((question) => {
    const pageNo = remap.get(question.pageNo) ?? 1;
    return pageNo === question.pageNo ? question : { ...question, pageNo };
  });
}

/** 提交前归一化为后端 payload 结构 */
export function normalizeQuestions(questions: QuestionDraft[]) {
  const paged = normalizePageNumbers(questions);
  return paged.map((question, index) => {
    const choice = isChoiceType(question.type);
    const options = choice
      ? question.options
          .map((option) => ({ ...option, label: option.label.trim() }))
          .filter((option) => option.label)
      : [];
    return {
      ...(question.id ? { id: question.id } : {}),
      label: question.label.trim(),
      type: question.type,
      required: question.required,
      options,
      minChoices: question.type === 'multiple' ? question.minChoices : (question.type === 'single' ? 1 : 0),
      maxChoices: question.type === 'multiple' ? question.maxChoices : 1,
      sort: index,
      allowOther: OTHER_CAPABLE_TYPES.includes(question.type) && question.allowOther,
      otherLabel: question.otherLabel.trim() || null,
      ratingMax: question.type === 'nps' ? CMS_INTERACTION_NPS_MAX : question.ratingMax,
      matrixRows: question.type === 'matrix'
        ? question.matrixRows
            .map((row) => ({ ...row, label: row.label.trim() }))
            .filter((row) => row.label)
        : [],
      pageNo: question.pageNo,
      visibleWhen: question.visibleWhen,
    };
  });
}

/** 逐题校验，返回 `题目 key -> 错误文案`；空 Map 表示全部通过 */
export function validateQuestions(
  questions: QuestionDraft[],
  kind: CmsInteractionKind,
): Map<string, string> {
  const errors = new Map<string, string>();
  questions.forEach((question, index) => {
    if (!question.label.trim()) {
      errors.set(question.key, '题目不能为空');
      return;
    }
    if (kind === 'poll' && question.type !== 'single' && question.type !== 'multiple') {
      errors.set(question.key, '投票只支持单选或多选题');
      return;
    }
    if (question.type === 'rating'
      && (question.ratingMax < 2 || question.ratingMax > CMS_INTERACTION_RATING_MAX_LIMIT)) {
      errors.set(question.key, `评分上限需在 2-${CMS_INTERACTION_RATING_MAX_LIMIT} 之间`);
      return;
    }
    if (question.visibleWhen) {
      const source = questions[question.visibleWhen.questionIndex];
      if (question.visibleWhen.questionIndex >= index || !source) {
        errors.set(question.key, '条件显示只能依赖排在前面的题目');
        return;
      }
      if (!CONDITION_SOURCE_TYPES.includes(source.type)) {
        errors.set(question.key, '条件显示只能依赖单选或多选题');
        return;
      }
      if (question.visibleWhen.values.length === 0) {
        errors.set(question.key, '条件显示至少选择一个触发选项');
        return;
      }
    }
    if (question.type === 'matrix') {
      const rowLabels = question.matrixRows.map((row) => row.label.trim()).filter(Boolean);
      if (rowLabels.length === 0) {
        errors.set(question.key, '矩阵题至少配置一行');
        return;
      }
      if (new Set(rowLabels).size !== rowLabels.length) {
        errors.set(question.key, '矩阵行文案不能重复');
        return;
      }
    }
    if (!isChoiceType(question.type)) return;
    const labels = question.options.map((option) => option.label.trim()).filter(Boolean);
    if (labels.length < 2) {
      errors.set(question.key, '选择题至少需要 2 个选项');
      return;
    }
    if (new Set(labels).size !== labels.length) {
      errors.set(question.key, '选项文案不能重复');
      return;
    }
    if (question.options.some((option) => option.value.startsWith(CMS_INTERACTION_OTHER_VALUE))) {
      errors.set(question.key, `选项标识不能以 ${CMS_INTERACTION_OTHER_VALUE} 开头`);
      return;
    }
    if (question.options.some((option) => option.value.includes(CMS_INTERACTION_MATRIX_SEPARATOR))) {
      errors.set(question.key, `选项标识不能包含 ${CMS_INTERACTION_MATRIX_SEPARATOR}`);
      return;
    }
    if (question.type === 'multiple') {
      if (question.minChoices > question.maxChoices) {
        errors.set(question.key, '最少选择数不能大于最多选择数');
        return;
      }
      if (question.maxChoices > labels.length) {
        errors.set(question.key, '最多选择数不能超过选项个数');
      }
    }
  });
  return errors;
}

/** 题目整体结构校验（数量 / 类型约束），返回首条错误文案 */
export function validateQuestionSet(
  questions: QuestionDraft[],
  kind: CmsInteractionKind,
): string | null {
  if (questions.length === 0) return '至少配置一道题目';
  if (kind === 'poll' && questions.length !== 1) return '投票必须且只能包含一道选择题';
  if (kind === 'poll' && questions.some((question) => question.pageNo > 1)) return '投票不支持分页';
  return null;
}

export const CONDITION_OPS: readonly CmsInteractionConditionOp[] = ['any', 'none'];
