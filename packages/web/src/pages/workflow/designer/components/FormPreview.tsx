/**
 * 表单预览组件 — 在 Modal 中渲染真实表单控件预览（复用 WorkflowFormRenderer）
 */
import { Button } from '@douyinfe/semi-ui';
import AppModal from '@/components/AppModal';
import type { WorkflowFormField } from '@arcbase/shared/workflow';
import WorkflowFormRenderer from './WorkflowFormRenderer';

interface FormPreviewProps {
  visible: boolean;
  fields: WorkflowFormField[];
  onClose: () => void;
}

export default function FormPreview({ visible, fields, onClose }: Readonly<FormPreviewProps>) {
  return (
    <AppModal
      title="表单预览"
      visible={visible}
      onCancel={onClose}
      footer={<Button type="primary" onClick={onClose}>关闭</Button>}
      width={560}
      bodyStyle={{ maxHeight: '65vh', overflowY: 'auto' }}
    >
      {fields.length === 0 ? (
        <div style={{ textAlign: 'center', color: 'var(--semi-color-text-2)', padding: '40px 0' }}>
          暂无表单字段
        </div>
      ) : (
        <WorkflowFormRenderer fields={fields} style={{ padding: '0 8px' }} />
      )}
    </AppModal>
  );
}
