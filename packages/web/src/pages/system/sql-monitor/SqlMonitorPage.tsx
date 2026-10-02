import { useMemo, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Banner,
  Button,
  Card,
  Input,
  Select,
  Space,
  TabPane,
  Tabs,
  Tag,
  Toast,
  Typography,
} from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import {
  Activity,
  Archive,
  Database,
  History as HistoryIcon,
  ListFilter,
  RotateCcw,
  Search,
  Settings2,
  ShieldAlert,
  Users,
} from 'lucide-react';
import {
  LineChart,
  chartOptions,
  ChartCard,
  makeLineSpec,
  useChartPalette,
} from '@/components/charts';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import ConfigurableTable from '@/components/ConfigurableTable';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { RefreshButton, SearchButton } from '@/components/toolbar-controls';
import { usePermission } from '@/hooks/usePermission';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import {
  type SqlMonitorQueriesParams,
  type SqlMonitorHistoryParams,
  useResetSqlMonitorStats,
  useSqlMonitorHistory,
  useSqlMonitorLocks,
  useSqlMonitorOverview,
  useSqlMonitorQueries,
  useSqlMonitorSessions,
  useSqlMonitorSessionAction,
} from '@/hooks/queries/sql-monitor';
import { confirmDanger } from '@/utils/confirm';
import { dateTimeColumn, EMPTY_PLACEHOLDER, renderCodeEllipsis } from '@/utils/table-columns';
import DateTimeText from '@/components/DateTimeText';
import { SQL_MONITOR_QUERY_SORT_OPTIONS, type SqlMonitorQuery, type SqlMonitorSession, type SqlMonitorLock, type SqlMonitorHistoryPoint, type MonitorHistoryRange } from '@arcbase/shared/platform';
import './SqlMonitorPage.css';

const { Title, Text } = Typography;

const SQL_MONITOR_TABS = ['queries', 'sessions', 'locks', 'history'] as const;
type SqlMonitorTab = typeof SQL_MONITOR_TABS[number];

type RefreshInterval = number | false;

const REFRESH_OPTIONS = [
  { label: '5 秒', value: 5_000 },
  { label: '15 秒', value: 15_000 },
  { label: '30 秒', value: 30_000 },
  { label: '暂停', value: 0 },
];

const HISTORY_OPTIONS = [
  { label: '近 1 小时', value: '1h' },
  { label: '近 6 小时', value: '6h' },
  { label: '近 24 小时', value: '24h' },
  { label: '近 7 天', value: '7d' },
  { label: '近 30 天', value: '30d' },
];

const numberFormatter = new Intl.NumberFormat('zh-CN');

const defaultQueryParams: SqlMonitorQueriesParams = { sort: 'totalMs', limit: 50 };
const defaultHistoryParams: SqlMonitorHistoryParams = { range: '1h' };

function formatNumber(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? EMPTY_PLACEHOLDER : numberFormatter.format(value);
}

function formatMs(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_PLACEHOLDER;
  if (value >= 1_000) return `${(value / 1_000).toFixed(2)} s`;
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(2)} ms`;
}

function formatSeconds(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return EMPTY_PLACEHOLDER;
  if (value < 1) return `${Math.round(value * 1_000)} ms`;
  return `${value.toFixed(value >= 10 ? 0 : 1)} s`;
}

function formatRatio(value: number | null | undefined): string {
  return value == null || !Number.isFinite(value) ? EMPTY_PLACEHOLDER : `${value.toFixed(2)}%`;
}

function renderQueryText(value: string | null | undefined) {
  return value ? (
    <Text code className="sql-monitor-query-text" ellipsis={{ showTooltip: true }}>
      {value}
    </Text>
  ) : <Text type="tertiary">{EMPTY_PLACEHOLDER}</Text>;
}

function ErrorState({ error, onRetry }: Readonly<{ error: Error | null; onRetry: () => void }>) {
  return (
    <div className="sql-monitor-error-state">
      <Text type="danger">加载失败：{error?.message ?? '服务暂时不可用'}</Text>
      <Button size="small" type="tertiary" onClick={onRetry}>重试</Button>
    </div>
  );
}

function AvailabilityBanner({ reason }: Readonly<{ reason: string | null | undefined }>) {
  return (
    <Banner
      type="warning"
      closeIcon={null}
      className="sql-monitor-availability"
      title="pg_stat_statements 不可用"
      description={reason ?? '当前数据库未启用 pg_stat_statements，SQL 累计统计与历史采样暂不可用。'}
    />
  );
}

function HealthValue({ label, value, tone }: Readonly<{ label: string; value: ReactNode; tone?: 'normal' | 'warning' | 'danger' }>) {
  return (
    <div className="sql-monitor-health-item">
      <Text type="tertiary" size="small">{label}</Text>
      <Text strong className={`sql-monitor-health-value sql-monitor-health-value--${tone ?? 'normal'}`}>{value}</Text>
    </div>
  );
}

function QueryTable({
  queries,
  loading,
  fetching,
  onRefresh,
  emptyText = '暂无 SQL 统计',
}: Readonly<{
  queries: SqlMonitorQuery[];
  loading: boolean;
  fetching: boolean;
  onRefresh: () => void;
  emptyText?: string;
}>) {
  const columns: ColumnProps<SqlMonitorQuery>[] = [
    {
      key: 'query',
      title: 'SQL 查询',
      dataIndex: 'query',
      minWidth: 360,
      render: (value: string | null) => renderQueryText(value),
    },
    { key: 'databaseName', title: '数据库', dataIndex: 'databaseName', width: 140, ellipsis: true },
    {
      key: 'queryId',
      title: 'Query ID',
      dataIndex: 'queryId',
      width: 190,
      render: (value: string) => renderCodeEllipsis(value),
    },
    { key: 'calls', title: '调用次数', dataIndex: 'calls', width: 110, align: 'right', render: (value: number) => formatNumber(value) },
    { key: 'totalMs', title: '总耗时', dataIndex: 'totalMs', width: 110, align: 'right', render: (value: number) => formatMs(value) },
    { key: 'meanMs', title: '平均耗时', dataIndex: 'meanMs', width: 110, align: 'right', render: (value: number) => formatMs(value) },
    { key: 'rows', title: '返回行数', dataIndex: 'rows', width: 110, align: 'right', render: (value: number) => formatNumber(value) },
    { key: 'cacheHitRatio', title: '缓存命中', dataIndex: 'cacheHitRatio', width: 105, align: 'right', render: (value: number | null) => formatRatio(value) },
  ];

  return (
    <ConfigurableTable<SqlMonitorQuery>
      rowKey="queryId"
      columns={columns}
      dataSource={queries}
      loading={loading}
      pagination={false}
      size="small"
      empty={emptyText}
      onRefresh={onRefresh}
      refreshLoading={fetching}
    />
  );
}

export default function SqlMonitorPage() {
  const navigate = useNavigate();
  const { hasPermission } = usePermission();
  const canTerminate = hasPermission('system:sql-monitor:terminate');
  const canManage = hasPermission('system:sql-monitor:manage');
  const palette = useChartPalette();
  const [activeTab, setActiveTab] = useUrlTabState(SQL_MONITOR_TABS, 'queries');
  const queriesTabRef = useRef<HTMLDivElement>(null);
  const [refreshInterval, setRefreshInterval] = useState<RefreshInterval>(15_000);
  const [queryDraft, setQueryDraft] = useState<SqlMonitorQueriesParams>(defaultQueryParams);
  const [queryParams, setQueryParams] = useState<SqlMonitorQueriesParams>(defaultQueryParams);
  const [historyParams, setHistoryParams] = useState<SqlMonitorHistoryParams>(defaultHistoryParams);

  const overviewQuery = useSqlMonitorOverview(refreshInterval);
  const queriesQuery = useSqlMonitorQueries(queryParams, {
    enabled: activeTab === 'queries',
    refetchInterval: refreshInterval,
  });
  const sessionsQuery = useSqlMonitorSessions({
    enabled: activeTab === 'sessions',
    refetchInterval: refreshInterval,
  });
  const locksQuery = useSqlMonitorLocks({
    enabled: activeTab === 'locks',
    refetchInterval: refreshInterval,
  });
  const historyQuery = useSqlMonitorHistory(historyParams, {
    enabled: activeTab === 'history',
    refetchInterval: refreshInterval === false ? false : 60_000,
  });
  const sessionActionMutation = useSqlMonitorSessionAction();
  const resetMutation = useResetSqlMonitorStats();
  const overview = overviewQuery.data;
  const queryResponse = queriesQuery.data;
  const sessions = sessionsQuery.data?.list ?? [];
  const locks = locksQuery.data?.list ?? [];
  const historyResponse = historyQuery.data;

  const historyChartData = useMemo(
    () => (historyResponse?.points ?? []).map((point) => ({
      time: point.sampledAt.length > 16 ? point.sampledAt.slice(5, 16) : point.sampledAt,
      calls: point.calls,
      totalMs: point.totalMs,
      meanMs: point.meanMs ?? 0,
    })),
    [historyResponse?.points],
  );

  const handleViewAllQueries = () => {
    setActiveTab('queries');
    requestAnimationFrame(() => queriesTabRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }));
  };

  const historySpec = useMemo(() => makeLineSpec({
    data: historyChartData,
    xField: 'time',
    series: [
      { field: 'calls', name: '调用次数', color: palette.dataColors[0] },
      { field: 'totalMs', name: '总耗时(ms)', color: palette.dataColors[1] },
    ],
    palette,
    tooltip: { value: (value, name) => name === '总耗时(ms)' ? formatMs(value) : formatNumber(value) },
  }), [historyChartData, palette]);

  const availability = overview?.stats;
  const queryAvailability = queryResponse?.stats;
  const blockedCount = overview?.blockedSessions ?? 0;
  const refreshAll = () => {
    void Promise.all([
      overviewQuery.refetch(),
      queriesQuery.refetch(),
      sessionsQuery.refetch(),
      locksQuery.refetch(),
      historyQuery.refetch(),
    ]);
  };

  const handleQuery = () => {
    setQueryParams({
      ...queryDraft,
      keyword: queryDraft.keyword?.trim() || undefined,
    });
  };

  const handleSessionAction = (session: SqlMonitorSession, action: 'cancel' | 'terminate') => {
    if (!session.backendStartToken || session.isCurrent) return;
    const label = action === 'cancel' ? '取消查询' : '终止会话';
    confirmDanger({
      title: `确认${label}（PID ${session.pid}）？`,
      content: action === 'cancel'
        ? '取消查询会尝试停止当前 SQL，但会保留数据库会话。'
        : '终止会话会断开客户端连接，未提交事务可能回滚。',
      okText: `确认${label}`,
      cancelText: '取消',
      onOk: async () => {
        const result = await sessionActionMutation.mutateAsync({
          body: { pid: session.pid, backendStartToken: session.backendStartToken!, action },
        });
        Toast.success(result.message);
      },
    });
  };

  const handleReset = () => {
    confirmDanger({
      title: '重置 SQL 统计？',
      content: '将清空 pg_stat_statements 的累计统计，历史采样记录不会删除。该操作会影响当前统计周期。',
      okText: '确认重置',
      cancelText: '取消',
      onOk: async () => {
        const result = await resetMutation.mutateAsync({});
        Toast.success(result.message);
      },
    });
  };

  const sessionColumns: ColumnProps<SqlMonitorSession>[] = [
    { key: 'pid', title: 'PID', dataIndex: 'pid', width: 90, render: (value: number) => <Text code>{value}</Text> },
    {
      key: 'username', title: '用户 / 应用', width: 170,
      render: (_: unknown, row: SqlMonitorSession) => (
        <div className="sql-monitor-session-principal">
          <Text>{row.username ?? EMPTY_PLACEHOLDER}</Text>
          <Text type="tertiary" size="small">{row.applicationName ?? EMPTY_PLACEHOLDER}</Text>
        </div>
      ),
    },
    { key: 'database', title: '数据库', dataIndex: 'database', width: 130, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    {
      key: 'state', title: '状态', dataIndex: 'state', width: 120,
      render: (value: string | null, row: SqlMonitorSession) => (
        <Space spacing={4}>
          <Tag size="small" color={row.isCurrent ? 'blue' : value === 'active' ? 'green' : 'grey'}>{row.isCurrent ? '当前会话' : value ?? '未知'}</Tag>
          {row.blockedBy.length > 0 && <Tag size="small" color="red">被阻塞</Tag>}
        </Space>
      ),
    },
    {
      key: 'wait', title: '等待', width: 130,
      render: (_: unknown, row: SqlMonitorSession) => row.waitEventType || row.waitEvent
        ? <Text type="warning" size="small">{[row.waitEventType, row.waitEvent].filter(Boolean).join(' / ')}</Text>
        : <Text type="tertiary">{EMPTY_PLACEHOLDER}</Text>,
    },
    { key: 'querySeconds', title: '查询耗时', dataIndex: 'querySeconds', width: 110, align: 'right', render: (value: number | null) => formatSeconds(value) },
    { key: 'queryStart', ...dateTimeColumn<SqlMonitorSession>('开始时间', 'queryStart') },
    {
      key: 'query', title: '当前 SQL', dataIndex: 'query', minWidth: 360,
      render: (value: string | null) => renderQueryText(value),
    },
    {
      key: 'blockedBy', title: '阻塞者', width: 100, align: 'right',
      render: (_: unknown, row: SqlMonitorSession) => row.blockedBy.length ? row.blockedBy.join(', ') : EMPTY_PLACEHOLDER,
    },
    ...(canTerminate ? [createOperationColumn<SqlMonitorSession>({
      width: 150,
      desktopInlineKeys: ['cancel'],
      actions: (row) => {
        const loading = sessionActionMutation.isPending && sessionActionMutation.variables?.body?.pid === row.pid;
        return [
          {
            key: 'cancel', label: '取消查询', hidden: row.isCurrent,
            loading, disabled: !row.backendStartToken,
            disabledReason: '缺少会话校验标识，无法安全操作',
            onClick: () => handleSessionAction(row, 'cancel'),
          },
          {
            key: 'terminate', label: '终止会话', danger: true, hidden: row.isCurrent,
            loading, disabled: !row.backendStartToken,
            disabledReason: '缺少会话校验标识，无法安全操作',
            onClick: () => handleSessionAction(row, 'terminate'),
          },
        ];
      },
    })] : []),
  ];

  const lockColumns: ColumnProps<SqlMonitorLock>[] = [
    { key: 'pid', title: '进程 PID', dataIndex: 'pid', width: 100, render: (value: number) => <Text code>{value}</Text> },
    { key: 'blockedBy', title: '阻塞者', width: 120, render: (_: unknown, row: SqlMonitorLock) => row.blockedBy.length ? row.blockedBy.join(', ') : EMPTY_PLACEHOLDER },
    { key: 'relation', title: '关系对象', dataIndex: 'relation', minWidth: 180, render: (value: string | null) => value ?? EMPTY_PLACEHOLDER },
    { key: 'lockType', title: '锁类型', dataIndex: 'lockType', width: 130 },
    { key: 'mode', title: '模式', dataIndex: 'mode', width: 180, ellipsis: true },
    { key: 'granted', title: '状态', dataIndex: 'granted', width: 100, render: (value: boolean) => <Tag size="small" color={value ? 'green' : 'red'}>{value ? '已获得' : '等待中'}</Tag> },
    { key: 'waitSeconds', title: '等待时长', dataIndex: 'waitSeconds', width: 110, align: 'right', render: (value: number | null) => formatSeconds(value) },
    { key: 'query', title: '相关 SQL', dataIndex: 'query', minWidth: 320, render: (value: string | null) => renderQueryText(value) },
  ];

  const historyColumns: ColumnProps<SqlMonitorHistoryPoint>[] = [
    { key: 'sampledAt', title: '采样时间', dataIndex: 'sampledAt', width: 180, render: (value: string) => <DateTimeText value={value} empty={EMPTY_PLACEHOLDER} /> },
    { key: 'queryCount', title: 'Query 数', dataIndex: 'queryCount', width: 110, align: 'right', render: (value: number) => formatNumber(value) },
    { key: 'calls', title: '调用次数', dataIndex: 'calls', width: 120, align: 'right', render: (value: number) => formatNumber(value) },
    { key: 'totalMs', title: '总耗时', dataIndex: 'totalMs', width: 120, align: 'right', render: (value: number) => formatMs(value) },
    { key: 'meanMs', title: '平均耗时', dataIndex: 'meanMs', width: 120, align: 'right', render: (value: number | null) => formatMs(value) },
  ];

  const overviewError = overviewQuery.error as Error | null;
  const queryError = queriesQuery.error as Error | null;
  const sessionsError = sessionsQuery.error as Error | null;
  const locksError = locksQuery.error as Error | null;
  const historyError = historyQuery.error as Error | null;

  return (
    <div className="page-container page-tabs-page zx-flat-panels sql-monitor-page">
      <div className="sql-monitor-header">
        <div className="sql-monitor-heading">
          <Title heading={5} style={{ margin: 0 }}>
            <Database size={18} /> SQL 监控
          </Title>
          <Text type="tertiary" size="small">查看 PostgreSQL 查询统计、活动会话、锁等待与历史采样。</Text>
        </div>
        <Space wrap spacing={8}>
          <Select
            value={refreshInterval === false ? 0 : refreshInterval}
            optionList={REFRESH_OPTIONS}
            onChange={(value) => setRefreshInterval(Number(value) === 0 ? false : Number(value))}
            insetLabel="刷新"
            insetLabelId="sql-monitor-refresh-label"
            aria-labelledby="sql-monitor-refresh-label"
            style={{ width: 140 }}
          />
          <RefreshButton onClick={refreshAll} loading={overviewQuery.isFetching} />
          {canManage && <Button type="danger" theme="light" icon={<RotateCcw size={14} />} onClick={handleReset} loading={resetMutation.isPending}>重置统计</Button>}
          <Button theme="borderless" icon={<Settings2 size={14} />} onClick={() => navigate('/system/settings')}>采样设置</Button>
          <Button theme="borderless" icon={<Archive size={14} />} onClick={() => navigate('/system/retention')}>数据保留</Button>
        </Space>
      </div>

      {overviewError && !overview && <ErrorState error={overviewError} onRetry={() => void overviewQuery.refetch()} />}
      {availability && !availability.available && <AvailabilityBanner reason={availability.reason} />}

      <section aria-label="SQL 监控概览">
        <StatGrid minItemWidth={160}>
          <StatCard title="统计查询" value={overview ? formatNumber(overview.queryCount) : '—'} icon={<ListFilter size={17} />} accent="var(--semi-color-primary)" sub={overview?.databaseName ?? '数据库未连接'} />
          <StatCard title="调用次数" value={overview ? formatNumber(overview.calls) : '—'} icon={<Activity size={17} />} accent="#2563eb" />
          <StatCard title="总耗时" value={overview ? formatMs(overview.totalMs) : '—'} icon={<HistoryIcon size={17} />} accent="#7c3aed" />
          <StatCard title="平均耗时" value={overview ? formatMs(overview.meanMs) : '—'} icon={<Activity size={17} />} accent="#0891b2" />
          <StatCard title="活动会话" value={overview ? formatNumber(overview.activeSessions) : '—'} icon={<Users size={17} />} accent="#16a34a" />
          <StatCard title="阻塞会话" value={overview ? formatNumber(overview.blockedSessions) : '—'} icon={<ShieldAlert size={17} />} accent={blockedCount > 0 ? '#dc2626' : '#16a34a'} sub={overview ? `${overview.waitingSessions} 个会话等待中` : undefined} />
        </StatGrid>
      </section>

      <div className="sql-monitor-overview-panels">
        <Card title="数据库健康" headerExtraContent={overview?.sampledAt ? <Text type="tertiary" size="small">更新于 <DateTimeText value={overview.sampledAt} /></Text> : null}>
          <div className="sql-monitor-health-grid">
            <HealthValue label="数据库" value={overview?.databaseName ?? EMPTY_PLACEHOLDER} />
            <HealthValue label="缓存命中率" value={formatRatio(overview?.cacheHitRatio)} tone={(overview?.cacheHitRatio ?? 100) < 90 ? 'warning' : 'normal'} />
            <HealthValue label="死锁次数" value={formatNumber(overview?.deadlocks)} tone={(overview?.deadlocks ?? 0) > 0 ? 'danger' : 'normal'} />
            <HealthValue label="阻塞会话" value={formatNumber(overview?.blockedSessions)} tone={blockedCount > 0 ? 'danger' : 'normal'} />
            <HealthValue label="采样间隔" value={overview ? `${overview.sampleIntervalMinutes} 分钟` : EMPTY_PLACEHOLDER} />
            <HealthValue label="历史保留" value={overview ? `${overview.sampleRetentionDays} 天` : EMPTY_PLACEHOLDER} />
          </div>
          <div className="sql-monitor-health-footer">
            <Text type="tertiary" size="small">历史数据由后台采样任务写入。</Text>
            <Button size="small" theme="borderless" icon={<Archive size={14} />} onClick={() => navigate('/system/retention')}>管理保留策略</Button>
          </div>
        </Card>
        <Card title="Top SQL" headerExtraContent={<Button size="small" theme="borderless" onClick={handleViewAllQueries}>查看全部</Button>}>
          <QueryTable
            queries={overview?.topQueries ?? []}
            loading={overviewQuery.isPending && !overview}
            fetching={overviewQuery.isFetching}
            onRefresh={() => void overviewQuery.refetch()}
            emptyText={availability?.available === false ? '统计不可用' : '暂无 Top SQL'}
          />
        </Card>
      </div>

      <Tabs
        activeKey={activeTab}
        onChange={(key) => setActiveTab(key as SqlMonitorTab)}
        collapsible="auto"
        tabBarStyle={{ marginBottom: 12 }}
      >
        <TabPane tab="查询统计" itemKey="queries">
          <div ref={queriesTabRef} className="sql-monitor-tab-panel">
            {queryAvailability && !queryAvailability.available && <AvailabilityBanner reason={queryAvailability.reason} />}
            <div className="sql-monitor-toolbar">
              <Space wrap spacing={8}>
                <Input
                  prefix={<Search size={14} />}
                  value={queryDraft.keyword ?? ''}
                  placeholder="搜索 SQL 或 Query ID"
                  onChange={(value) => setQueryDraft((current) => ({ ...current, keyword: value || undefined }))}
                  onEnterPress={handleQuery}
                  showClear
                  aria-label="搜索 SQL 或 Query ID"
                  style={{ width: 260 }}
                />
                <Select
                  value={queryDraft.sort}
                  optionList={SQL_MONITOR_QUERY_SORT_OPTIONS}
                  onChange={(value) => setQueryDraft((current) => ({ ...current, sort: value as SqlMonitorQueriesParams['sort'] }))}
                  insetLabel="排序"
                  insetLabelId="sql-monitor-sort-label"
                  aria-labelledby="sql-monitor-sort-label"
                  style={{ width: 180 }}
                />
                <SearchButton onClick={handleQuery}>查询</SearchButton>
              </Space>
              {queryParams.keyword || queryParams.sort !== defaultQueryParams.sort ? <Button type="tertiary" onClick={() => { setQueryDraft(defaultQueryParams); setQueryParams(defaultQueryParams); }}>重置筛选</Button> : null}
            </div>
            {queryError && !queryResponse ? <ErrorState error={queryError} onRetry={() => void queriesQuery.refetch()} /> : (
              <QueryTable
                queries={queryResponse?.list ?? []}
                loading={queriesQuery.isPending && !queryResponse}
                fetching={queriesQuery.isFetching}
                onRefresh={() => void queriesQuery.refetch()}
                emptyText={queryAvailability?.available === false ? '统计不可用' : '暂无匹配的 SQL'}
              />
            )}
          </div>
        </TabPane>

        <TabPane tab="活动会话" itemKey="sessions">
          <div className="sql-monitor-tab-panel">
            <div className="sql-monitor-tab-heading">
              <Text type="tertiary" size="small">活动会话会按当前刷新周期自动更新；当前管理会话不可被自身终止。</Text>
              {!canTerminate && <Tag size="small" color="grey">无会话操作权限</Tag>}
            </div>
            {sessionsError && !sessionsQuery.data ? <ErrorState error={sessionsError} onRetry={() => void sessionsQuery.refetch()} /> : (
              <ConfigurableTable<SqlMonitorSession>
                rowKey="pid"
                columns={sessionColumns}
                dataSource={sessions}
                loading={sessionsQuery.isPending && !sessionsQuery.data}
                refreshLoading={sessionsQuery.isFetching}
                onRefresh={() => void sessionsQuery.refetch()}
                pagination={false}
                empty="暂无活动会话"
              />
            )}
          </div>
        </TabPane>

        <TabPane tab="锁与阻塞" itemKey="locks">
          <div className="sql-monitor-tab-panel">
            <div className="sql-monitor-tab-heading">
              <Text type="tertiary" size="small">未获得的锁表示当前正在等待，阻塞者 PID 可在活动会话中进一步处理。</Text>
              {locks.some((lock) => !lock.granted) && <Tag size="small" color="red">存在等待中的锁</Tag>}
            </div>
            {locksError && !locksQuery.data ? <ErrorState error={locksError} onRetry={() => void locksQuery.refetch()} /> : (
              <ConfigurableTable<SqlMonitorLock>
                rowKey={(row) => row ? `${row.pid}-${row.lockType}-${row.mode}-${row.relation ?? ''}` : ''}
                columns={lockColumns}
                dataSource={locks}
                loading={locksQuery.isPending && !locksQuery.data}
                refreshLoading={locksQuery.isFetching}
                onRefresh={() => void locksQuery.refetch()}
                pagination={false}
                empty="暂无锁等待或阻塞"
              />
            )}
          </div>
        </TabPane>

        <TabPane tab="历史趋势" itemKey="history">
          <div className="sql-monitor-tab-panel">
            <div className="sql-monitor-toolbar">
              <Text type="tertiary" size="small">历史采样用于回溯查询量与耗时趋势，不会包含 SQL 文本明细。</Text>
              <Space spacing={8}>
                <Select
                  value={historyParams.range}
                  optionList={HISTORY_OPTIONS}
                  onChange={(value) => setHistoryParams({ range: value as MonitorHistoryRange })}
                  insetLabel="范围"
                  insetLabelId="sql-monitor-range-label"
                  aria-labelledby="sql-monitor-range-label"
                  style={{ width: 180 }}
                />
                <RefreshButton onClick={() => void historyQuery.refetch()} loading={historyQuery.isFetching} />
              </Space>
            </div>
            {historyResponse?.stats && !historyResponse.stats.available && <AvailabilityBanner reason={historyResponse.stats.reason} />}
            {historyError && !historyResponse ? <ErrorState error={historyError} onRetry={() => void historyQuery.refetch()} /> : (
              <>
                <ChartCard
                  title="查询趋势"
                  extra={<Text type="tertiary" size="small">{historyResponse?.points.length ?? 0} 个采样点</Text>}
                  loading={historyQuery.isPending && !historyResponse}
                  empty={historyResponse?.stats.available === false ? '统计不可用' : historyChartData.length === 0 ? '暂无历史采样' : null}
                  height={250}
                >
                  <LineChart {...historySpec} options={chartOptions} height={250} />
                </ChartCard>
                <ConfigurableTable<SqlMonitorHistoryPoint>
                  rowKey="sampledAt"
                  columns={historyColumns}
                  dataSource={historyResponse?.points ?? []}
                  loading={historyQuery.isPending && !historyResponse}
                  refreshLoading={historyQuery.isFetching}
                  onRefresh={() => void historyQuery.refetch()}
                  pagination={false}
                  empty={historyResponse?.stats.available === false ? '统计不可用' : '暂无历史采样'}
                />
              </>
            )}
          </div>
        </TabPane>
      </Tabs>
    </div>
  );
}
