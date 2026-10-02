import type { ReactNode } from 'react';
import { Banner, Button, Empty, Select, Space, Spin, Tag, Typography } from '@douyinfe/semi-ui';
import type { WorkflowBusinessContext, WorkflowBusinessPreview } from '@arcbase/shared/workflow';
import { formatDateTime } from '@/utils/date';
import WorkflowProcessLayout from './WorkflowProcessLayout';
import WorkflowInstanceDetailPanel from './WorkflowInstanceDetailPanel';
import { WorkflowApprovalChain } from './WorkflowApprovalChainPanel';
import WorkflowGraphView from './WorkflowGraphView';
import { INSTANCE_STATUS_MAP } from './workflow-runtime';

interface Props {
  preview?: WorkflowBusinessPreview | null;
  context?: WorkflowBusinessContext | null;
  formContent?: ReactNode;
  loading?: boolean;
  error?: Error | null;
  onRetry?: () => void;
  selectedInstanceId?: number;
  onSelectInstance?: (id: number | undefined) => void;
}

/** 业务域负责授权和取数；预览与实际实例共用普通流程的两栏展示。 */
export default function BusinessWorkflowPanel({
  preview, context, formContent, loading = false, error, onRetry,
  selectedInstanceId, onSelectInstance,
}: Readonly<Props>) {
  const instance = context?.instance;
  const definition = preview?.definition;
  const previous = context?.previousInstances ?? [];
  const rounds = previous.length > 0 && onSelectInstance ? (
    <Space spacing={8} style={{ padding: '8px 20px', flexShrink: 0 }}>
      <Typography.Text type="secondary" size="small">审批轮次</Typography.Text>
      <Select
        aria-label="审批轮次"
        size="small"
        value={selectedInstanceId ?? 0}
        style={{ minWidth: 220 }}
        onChange={(value) => onSelectInstance(Number(value) || undefined)}
        optionList={[
          { value: 0, label: '当前审批 / 本次提审预览' },
          ...previous.map((item) => ({ value: item.id, label: `#${item.id} · ${INSTANCE_STATUS_MAP[item.status]?.text ?? item.status} · ${formatDateTime(item.createdAt)}` })),
        ]}
      />
    </Space>
  ) : null;

  const feedback = error ? (
    <div style={{ padding: 16 }}>
      <Banner type="warning" closeIcon={null} description={`无法加载流程信息：${error.message}`} />
      {onRetry && <Button size="small" style={{ marginTop: 8 }} onClick={onRetry}>重试</Button>}
    </div>
  ) : loading ? (
    <div style={{ padding: 24, textAlign: 'center' }}><Spin /></div>
  ) : !definition ? <Empty description="未启用或未配置可用的审批流程" style={{ padding: 24 }} /> : null;

  return (
    <div style={{ display: 'flex', flexDirection: 'column', flex: 1, minHeight: 0, height: '100%' }}>
      {rounds}
      {selectedInstanceId && (
        <Banner type="info" closeIcon={null} description="正在查看所选轮次的流程记录，表单区域展示当前业务资料。" />
      )}
      <div style={{ flex: 1, minHeight: 0 }}>
        {instance && !error ? (
          <WorkflowInstanceDetailPanel instance={instance} formContent={formContent} loading={loading} readOnly />
        ) : (
          <WorkflowProcessLayout
            persistKey="business-workflow"
            header={definition ? (
              <>
                <Space spacing={8}>
                  <Typography.Text strong>{definition.name}</Typography.Text>
                  <Tag color="blue" size="small">审批链路预览 · 尚未提交</Tag>
                </Space>
                {definition.description && <Typography.Paragraph type="tertiary" size="small" style={{ marginTop: 8, marginBottom: 0 }}>{definition.description}</Typography.Paragraph>}
              </>
            ) : undefined}
            left={formContent}
            chain={feedback ?? (
              <>
                <Typography.Paragraph type="tertiary" size="small">
                  展示流程结构与当前可解析的审批人，实际流转以提交后为准。
                </Typography.Paragraph>
                <WorkflowApprovalChain nodes={preview?.nodes ?? []} />
              </>
            )}
            graph={definition ? <WorkflowGraphView flowData={definition.flowData} /> : feedback}
          />
        )}
      </div>
    </div>
  );
}
