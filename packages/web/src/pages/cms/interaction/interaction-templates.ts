import type { CmsInteractionKind } from '@arcbase/shared/cms';
import { createMatrixRow, createOption, createQuestion, type QuestionDraft } from './question-draft';

export interface InteractionTemplate {
  key: string;
  name: string;
  /** 模板适用的互动类型；与当前选择不一致时不展示 */
  kind: CmsInteractionKind;
  description: string;
  /** 应用模板时可回填的标题（用户已填写标题则不覆盖） */
  suggestedTitle: string;
  build: () => QuestionDraft[];
}

type Spec =
  | { label: string; type: 'single' | 'multiple'; required?: boolean; options: string[]; minChoices?: number; maxChoices?: number; allowOther?: boolean; pageNo?: number }
  | { label: string; type: 'matrix'; required?: boolean; options: string[]; rows: string[]; pageNo?: number }
  | { label: string; type: 'rating'; required?: boolean; ratingMax?: number; pageNo?: number }
  | { label: string; type: 'nps' | 'text' | 'date' | 'number'; required?: boolean; pageNo?: number };

function build(specs: Spec[]): QuestionDraft[] {
  return specs.map((spec) => {
    const base = createQuestion(spec.type);
    const common = { label: spec.label, required: spec.required ?? true, pageNo: spec.pageNo ?? 1 };
    if (spec.type === 'matrix') {
      return {
        ...base,
        ...common,
        options: spec.options.map((label) => createOption(label)),
        matrixRows: spec.rows.map((label) => createMatrixRow(label)),
      };
    }
    if (spec.type === 'single' || spec.type === 'multiple') {
      return {
        ...base,
        ...common,
        options: spec.options.map((label) => createOption(label)),
        allowOther: spec.allowOther ?? false,
        minChoices: spec.type === 'single' ? 1 : (spec.minChoices ?? 1),
        maxChoices: spec.type === 'single' ? 1 : (spec.maxChoices ?? spec.options.length),
      };
    }
    if (spec.type === 'rating') {
      return { ...base, ...common, ratingMax: spec.ratingMax ?? 5 };
    }
    return { ...base, ...common, required: spec.required ?? false };
  });
}

export const INTERACTION_TEMPLATES: InteractionTemplate[] = [
  {
    key: 'satisfaction',
    name: '满意度调查',
    kind: 'survey',
    description: '整体满意度 + 分模块矩阵评价 + 开放建议，共 3 题',
    suggestedTitle: '产品满意度调查',
    build: () => build([
      { label: '您对我们的整体满意度？', type: 'single', options: ['非常满意', '满意', '一般', '不满意', '非常不满意'] },
      {
        label: '请对以下模块分别评价',
        type: 'matrix',
        required: false,
        options: ['好用', '一般', '待改进'],
        rows: ['内容浏览', '搜索', '会员中心'],
      },
      { label: '还有哪些建议可以帮助我们做得更好？', type: 'text' },
    ]),
  },
  {
    key: 'nps',
    name: 'NPS 净推荐值',
    kind: 'survey',
    description: '标准 NPS 题 + 打分原因，结果自动算净推荐值，共 2 题',
    suggestedTitle: 'NPS 净推荐值调研',
    build: () => build([
      { label: '您有多大可能把我们推荐给朋友或同事？', type: 'nps' },
      { label: '给出这个分数的主要原因是什么？', type: 'text' },
    ]),
  },
  {
    key: 'signup',
    name: '活动报名',
    kind: 'survey',
    description: '场次 + 参与方式 + 到场日期 + 备注，分两页，共 4 题',
    suggestedTitle: '活动报名登记',
    build: () => build([
      { label: '您希望参加哪个场次？', type: 'single', options: ['上午场（09:30-12:00）', '下午场（14:00-16:30）', '晚间场（19:00-21:00）'] },
      { label: '您计划以何种方式参与？', type: 'single', options: ['线下到场', '线上直播'], allowOther: true },
      { label: '预计到场日期', type: 'date', required: false, pageNo: 2 },
      { label: '其他备注（餐食忌口、随行人数等）', type: 'text', pageNo: 2 },
    ]),
  },
  {
    key: 'experience',
    name: '体验评分',
    kind: 'survey',
    description: '五星评分 + 使用时长 + 建议，共 3 题',
    suggestedTitle: '使用体验评分',
    build: () => build([
      { label: '请为整体使用体验打分', type: 'rating', ratingMax: 5 },
      { label: '您每周大约使用多少小时？', type: 'number', required: false },
      { label: '最希望我们改进的地方', type: 'text' },
    ]),
  },
  {
    key: 'poll',
    name: '单题投票',
    kind: 'poll',
    description: '投票专用：一道单选题，直接改选项即可',
    suggestedTitle: '大家更喜欢哪一个？',
    build: () => build([
      { label: '请选择您支持的选项', type: 'single', options: ['选项一', '选项二', '选项三'] },
    ]),
  },
];
