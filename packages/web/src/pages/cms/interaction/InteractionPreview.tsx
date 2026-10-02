import { CMS_INTERACTION_KIND_LABELS, CMS_INTERACTION_NPS_MAX } from '@arcbase/shared/cms';
import type { CmsInteractionKind } from '@arcbase/shared/cms';
import { isChoiceType, type QuestionDraft } from './question-draft';

interface InteractionPreviewProps {
  kind: CmsInteractionKind;
  title: string;
  description?: string;
  questions: QuestionDraft[];
  participantScope: 'anonymous' | 'member';
  thankYouMessage: string;
}

function scalePoints(question: QuestionDraft): number[] {
  const min = question.type === 'nps' ? 0 : 1;
  const max = question.type === 'nps' ? CMS_INTERACTION_NPS_MAX : question.ratingMax;
  return Array.from({ length: max - min + 1 }, (_, index) => min + index);
}

function QuestionBody({ question }: Readonly<{ question: QuestionDraft }>) {
  if (question.type === 'text') return <textarea disabled rows={3} placeholder="请输入…" />;
  if (question.type === 'date') return <input type="date" disabled />;
  if (question.type === 'number') return <input type="number" disabled placeholder="请输入数字" />;

  if (question.type === 'rating' || question.type === 'nps') {
    return (
      <div className="interaction-preview__scale">
        {scalePoints(question).map((point) => (
          <label key={point} className="interaction-preview__option">
            <input type="radio" disabled />
            {point}
          </label>
        ))}
      </div>
    );
  }

  if (question.type === 'matrix') {
    return (
      <div className="interaction-preview__matrix-wrap">
        <table className="interaction-preview__matrix">
          <thead>
            <tr>
              <th aria-label="行标题" />
              {question.options.map((option) => <th key={option.id}>{option.label.trim() || '未填写'}</th>)}
            </tr>
          </thead>
          <tbody>
            {question.matrixRows.map((row) => (
              <tr key={row.id}>
                <th scope="row">{row.label.trim() || '未填写'}</th>
                {question.options.map((option) => (
                  <td key={option.id}><input type="radio" disabled /></td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );
  }

  return (
    <div className="interaction-preview__options">
      {question.options.length === 0 ? (
        <span className="interaction-preview__hint">尚未添加选项</span>
      ) : question.options.map((option) => (
        <label key={option.id} className="interaction-preview__option">
          <input type={question.type === 'multiple' ? 'checkbox' : 'radio'} disabled />
          {option.label.trim() || '未填写选项'}
        </label>
      ))}
      {question.allowOther ? (
        <label className="interaction-preview__option">
          <input type={question.type === 'multiple' ? 'checkbox' : 'radio'} disabled />
          {question.otherLabel.trim() || '其他'}
          <input className="interaction-preview__other" type="text" disabled placeholder="请填写" />
        </label>
      ) : null}
    </div>
  );
}

/**
 * 前台样式仿真预览：结构对齐 default 主题 `InteractionTemplate` 渲染的
 * `.survey-question / .survey-options / .survey-option` 标记，仅用于所见即所得，
 * 所有控件均禁用，不产生任何提交。
 */
export default function InteractionPreview({
  kind,
  title,
  description,
  questions,
  participantScope,
  thankYouMessage,
}: Readonly<InteractionPreviewProps>) {
  const pages = [...new Set(questions.map((question) => question.pageNo))].sort((a, b) => a - b);
  return (
    <div className="interaction-preview">
      <div className="interaction-preview__bar">
        前台预览 · {CMS_INTERACTION_KIND_LABELS[kind]}
        {pages.length > 1 ? ` · 共 ${pages.length} 页` : ''}
      </div>
      <div className="interaction-preview__page">
        <h1>{title.trim() || '未命名互动'}</h1>
        {description?.trim() ? <p className="interaction-preview__desc">{description}</p> : null}
        {participantScope === 'member' ? <p className="interaction-preview__hint">本互动仅限登录会员参与</p> : null}

        {questions.length === 0 ? (
          <p className="interaction-preview__hint">尚未添加题目</p>
        ) : pages.map((page) => (
          <section key={page}>
            {pages.length > 1 ? (
              <p className="interaction-preview__page-label">第 {pages.indexOf(page) + 1} 页</p>
            ) : null}
            {questions.map((question, index) => question.pageNo !== page ? null : (
              <fieldset key={question.key} className="interaction-preview__question">
                <legend>
                  {index + 1}. {question.label.trim() || '未填写题干'}
                  {question.required ? <span className="interaction-preview__req"> *</span> : null}
                </legend>
                <QuestionBody question={question} />
                {question.type === 'multiple' ? (
                  <span className="interaction-preview__limits">
                    可选 {question.minChoices} ~ {question.maxChoices} 项
                  </span>
                ) : null}
                {question.visibleWhen ? (
                  <span className="interaction-preview__limits">
                    仅当第 {question.visibleWhen.questionIndex + 1} 题
                    {question.visibleWhen.op === 'none' ? '未选中' : '选中'}指定选项时显示
                  </span>
                ) : null}
                {isChoiceType(question.type) && question.options.length === 0 ? (
                  <span className="interaction-preview__hint">尚未添加选项</span>
                ) : null}
              </fieldset>
            ))}
          </section>
        ))}

        <button type="button" className="interaction-preview__submit" disabled>提交</button>
        <p className="interaction-preview__thanks">提交后提示：{thankYouMessage.trim() || '感谢您的参与！'}</p>
      </div>
    </div>
  );
}
