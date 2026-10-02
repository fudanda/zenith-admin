import { Typography, Tag, Space, Empty } from '@douyinfe/semi-ui';
import type { WorkflowVersionDiff, WorkflowVersionNodeChange, WorkflowVersionEdgeChange } from '@arcbase/shared/workflow';
import { WORKFLOW_DIFF_KIND_META as KIND_META } from '../constants';

function NodeChangeRow({ change }: Readonly<{ change: WorkflowVersionNodeChange }>) {
  const meta = KIND_META[change.kind];
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px dashed var(--semi-color-border)' }}>
      <Space spacing={8} style={{ flexWrap: 'wrap' }}>
        <Tag size="small" color={meta.color}>{meta.text}</Tag>
        <Typography.Text strong>{change.nodeName || change.nodeKey}</Typography.Text>
        <Typography.Text type="tertiary" size="small">{change.nodeType} · {change.nodeKey}</Typography.Text>
      </Space>
      {change.fields.length > 0 && (
        <div style={{ marginTop: 4, paddingLeft: 8 }}>
          {change.fields.map((f) => (
            <div key={f.field} style={{ fontSize: 12, lineHeight: '20px' }}>
              <Typography.Text type="tertiary" size="small">{f.field}：</Typography.Text>
              <Typography.Text delete type="danger" size="small">{f.before || '空'}</Typography.Text>
              <Typography.Text type="tertiary" size="small"> → </Typography.Text>
              <Typography.Text type="success" size="small">{f.after || '空'}</Typography.Text>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function EdgeChangeRow({ change }: Readonly<{ change: WorkflowVersionEdgeChange }>) {
  const meta = KIND_META[change.kind];
  return (
    <div style={{ padding: '8px 0', borderBottom: '1px dashed var(--semi-color-border)' }}>
      <Space spacing={8} style={{ flexWrap: 'wrap' }}>
        <Tag size="small" color={meta.color}>{meta.text}</Tag>
        <Typography.Text strong size="small">{change.from} → {change.to}</Typography.Text>
      </Space>
      {(change.before || change.after) && (
        <div style={{ marginTop: 4, paddingLeft: 8, fontSize: 12, lineHeight: '20px' }}>
          <Typography.Text type="tertiary" size="small">条件：</Typography.Text>
          <Typography.Text delete type="danger" size="small">{change.before || '无'}</Typography.Text>
          <Typography.Text type="tertiary" size="small"> → </Typography.Text>
          <Typography.Text type="success" size="small">{change.after || '无'}</Typography.Text>
        </div>
      )}
    </div>
  );
}

export default function WorkflowVersionDiffView({ diff }: Readonly<{ diff: WorkflowVersionDiff }>) {
  const { left, right, summary, nodeChanges, edgeChanges } = diff;
  const noChanges = nodeChanges.length === 0 && edgeChanges.length === 0;

  return (
    <div>
      <Space spacing={8} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Tag color="blue">{left.label}</Tag>
        <Typography.Text type="tertiary">对比</Typography.Text>
        <Tag color="violet">{right.label}</Tag>
      </Space>

      <Space spacing={6} style={{ marginBottom: 12, flexWrap: 'wrap' }}>
        <Tag color="grey">节点</Tag>
        <Tag size="small" color="green">+{summary.nodesAdded}</Tag>
        <Tag size="small" color="red">-{summary.nodesRemoved}</Tag>
        <Tag size="small" color="amber">~{summary.nodesModified}</Tag>
        <Tag color="grey" style={{ marginLeft: 8 }}>连线</Tag>
        <Tag size="small" color="green">+{summary.edgesAdded}</Tag>
        <Tag size="small" color="red">-{summary.edgesRemoved}</Tag>
        <Tag size="small" color="amber">~{summary.edgesModified}</Tag>
      </Space>

      {noChanges && <Empty description="两个版本之间没有结构差异" style={{ padding: '24px 0' }} />}

      {nodeChanges.length > 0 && (
        <div style={{ marginBottom: 12 }}>
          <Typography.Title heading={6} style={{ marginBottom: 4 }}>节点变更（{nodeChanges.length}）</Typography.Title>
          {nodeChanges.map((c) => <NodeChangeRow key={`${c.kind}-${c.nodeKey}`} change={c} />)}
        </div>
      )}

      {edgeChanges.length > 0 && (
        <div>
          <Typography.Title heading={6} style={{ marginBottom: 4 }}>连线变更（{edgeChanges.length}）</Typography.Title>
          {edgeChanges.map((c, i) => <EdgeChangeRow key={`${c.kind}-${c.from}-${c.to}-${i}`} change={c} />)}
        </div>
      )}
    </div>
  );
}
