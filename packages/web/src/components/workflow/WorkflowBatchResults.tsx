import { Button, List, Space, Tag, Typography } from '@douyinfe/semi-ui';
import type { WorkflowBatchActionResponse } from '@arcbase/shared/workflow';

/** 两端都保留逐任务结果，失败原因可以回到对应待办继续处理。 */
export default function WorkflowBatchResults({ result, titles, onOpenTask }: Readonly<{
  result: WorkflowBatchActionResponse;
  titles: Record<number, string>;
  onOpenTask?: (taskId: number) => void;
}>) {
  return (
    <div>
      <Typography.Paragraph>成功 {result.succeeded} 条，失败 {result.failed} 条</Typography.Paragraph>
      <List size="small" dataSource={result.results} renderItem={(item) => (
        <List.Item>
          <div style={{ width: '100%' }}>
            <Space spacing={8} wrap>
              <Tag color={item.success ? 'green' : 'red'}>{item.success ? '已完成' : '未完成'}</Tag>
              <Typography.Text>{titles[item.taskId] ?? `任务 #${item.taskId}`}</Typography.Text>
              {!item.success && onOpenTask && <Button size="small" theme="borderless" onClick={() => onOpenTask(item.taskId)}>查看待办</Button>}
            </Space>
            {!item.success && <Typography.Paragraph type="danger" size="small" style={{ marginTop: 6, marginBottom: 0 }}>{item.message ?? '请进入待办详情重新处理'}</Typography.Paragraph>}
          </div>
        </List.Item>
      )} />
    </div>
  );
}
