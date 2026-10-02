import { Progress, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { CmsDeployment } from '@arcbase/shared/cms';
import { useNavigate } from 'react-router-dom';
import { Button } from '@douyinfe/semi-ui';

const phaseLabels = { pending: '待开始', running: '处理中', completed: '已完成', failed: '失败' };
export default function CmsDeploymentProgress({ deployment, siteId }: Readonly<{ deployment?: CmsDeployment | null; siteId?: number }>) {
  const navigate = useNavigate();
  if (!deployment?.buildPlan.phases.length) return null;
  const metrics = deployment.buildMetrics;
  const failed = deployment.buildPlan.failedTargetKey?.split('|');
  const failedKind = failed?.[0] === '~meta' ? '站点索引文件' : ({ '0': '首页', '1': '栏目', '2': '内容', '3': '标签', '4': '页面' }[failed?.[1] ?? ''] ?? '页面');
  const failedId = Number(failed?.[2]);
  const editPath = failed?.[0] === '~site' && failedId > 0 ? ({ '1': `/cms/channels?site=${siteId}&channel=${failedId}`, '2': `/cms/contents/edit?id=${failedId}&siteId=${siteId}`, '4': `/cms/pages?siteId=${siteId}&page=${failedId}` }[failed[1]]) : undefined;
  return <Space vertical align="start" spacing={10} style={{ width: '100%' }}>
    <Typography.Title heading={6}>本次构建进度</Typography.Title>
    {failed ? <Space wrap><Typography.Text type="danger">未完成：{failedKind}{failedId > 0 ? ` #${failedId}` : ''}。修正后可重新构建并复用已完成产物。</Typography.Text>{editPath ? <Button size="small" onClick={() => navigate(editPath)}>检查编辑对象</Button> : null}</Space> : null}
    {deployment.buildPlan.phases.map((phase) => <div key={phase.key} style={{ width: '100%' }}>
      <Space wrap><Tag color={phase.status === 'completed' ? 'green' : phase.status === 'failed' ? 'red' : phase.status === 'running' ? 'blue' : 'grey'}>{phaseLabels[phase.status]}</Tag>
        <Typography.Text>{phase.label}</Typography.Text>{phase.total > 0 ? <Typography.Text type="tertiary">{phase.processed} / {phase.total}</Typography.Text> : null}
      </Space>
      {phase.status === 'running' && phase.total > 0 ? <Progress percent={Math.min(100, Math.round(phase.processed * 100 / phase.total))} showInfo={false} /> : null}
    </div>)}
    <Typography.Text type="secondary">新生成 {metrics.generatedArtifacts ?? 0} 个文件 · 沿用 {metrics.reusedArtifacts ?? 0} 个文件 · 从断点恢复 {metrics.resumedArtifacts ?? 0} 个文件
      {metrics.elapsedMs != null ? ` · 总耗时 ${(metrics.elapsedMs / 1000).toFixed(1)} 秒` : ''}</Typography.Text>
  </Space>;
}
