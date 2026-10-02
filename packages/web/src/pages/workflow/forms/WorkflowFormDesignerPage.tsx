/**
 * 表单库 · 独立表单设计器页面
 * 薄壳：复用 WorkflowFormInlineEditor，提供整页编辑体验。
 * 路由：/workflow/forms/designer（新建） 或 /workflow/forms/designer?id=123（编辑）
 */
import { useNavigate, useSearchParams } from 'react-router-dom';
import type { WorkflowForm } from '@arcbase/shared/workflow';
import WorkflowFormInlineEditor from './WorkflowFormInlineEditor';

export default function WorkflowFormDesignerPage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const idParam = searchParams.get('id');
  const id = idParam && Number.isFinite(Number(idParam)) ? Number(idParam) : null;

  const handleSaved = (form: WorkflowForm) => {
    if (id == null) setSearchParams({ id: String(form.id) }, { replace: true });
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <WorkflowFormInlineEditor
        formId={id}
        backLabel="返回"
        onBack={() => navigate('/workflow/forms')}
        onSaved={handleSaved}
      />
    </div>
  );
}
