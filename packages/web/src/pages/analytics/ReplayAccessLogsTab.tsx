/**
 * 回放访问审计 Tab：谁在什么时候查看了谁的操作录像（合规留痕，manage 权限）。
 * 同一用户对同一回放 10 分钟内去重，实时旁观轮询不会刷屏。
 */
import { Tag, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { sessionReplayContract, type ReplayAccessLog } from '@arcbase/shared/analytics';
import { useReplayAccessLogs } from '@/hooks/queries/session-replays';
import { ListSearchToolbar } from '@/components/list-page';
import { EMPTY_PLACEHOLDER } from '@/utils/table-columns';
import { useListPage } from '@/hooks/useListPage';

const { Text } = Typography;

export default function ReplayAccessLogsTab({ onOpenReplay }: Readonly<{ onOpenReplay: (id: string) => void }>) {
  const page = useListPage({
    op: sessionReplayContract.accessLogs,
    useList: useReplayAccessLogs,
    table: { empty: '暂无访问记录（同一用户对同一回放 10 分钟内只留痕一次）' },
  });
  const { tableProps } = page;

  const columns: ColumnProps<ReplayAccessLog>[] = [
    { title: '时间', dataIndex: 'createdAt', width: 170 },
    { title: '操作人', dataIndex: 'username', width: 130, render: (v: string | null, r) => v ?? `用户#${r.userId}` },
    {
      title: '动作', dataIndex: 'action', width: 100,
      render: (v: string) => <Tag size="small" color="blue">{v === 'view' ? '查看回放' : v}</Tag>,
    },
    { title: '录像归属', dataIndex: 'replayOwner', width: 130, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
    {
      title: '回放', dataIndex: 'replayId', width: 300,
      render: (v: string) => (
        <Text link size="small" onClick={() => onOpenReplay(v)} style={{ fontFamily: 'monospace' }}>{v}</Text>
      ),
    },
    { title: 'IP', dataIndex: 'ip', width: 140, render: (v: string | null) => v ?? EMPTY_PLACEHOLDER },
  ];

  return (
    <div>
      <ListSearchToolbar
        page={page}
        filters={['keyword']}
      />
      <ConfigurableTable
        columnSettingsKey="replay-access-logs"
        columns={columns}
        {...tableProps}
      />
    </div>
  );
}
