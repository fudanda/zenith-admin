/* eslint-disable react-refresh/only-export-components -- 私有采集状态映射与详情面板共用。 */
import { Banner, Card, Descriptions, Tag, Typography } from '@douyinfe/semi-ui';
import type { CmsStatQuality } from '@arcbase/shared/cms';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import DateTimeText from '@/components/DateTimeText';
import ConfigurableTable from '@/components/ConfigurableTable';

export const CMS_COLLECTION_STATUS = {
  disabled: { label: '未启用采集', description: '请在采集设置中启用并发布站点配置，启用前的浏览不会补采。', color: 'grey' },
  pending_publication: { label: '配置待发布', description: '采集配置与线上版本尚未一致，请在发布中心发布配置后访问线上站点。', color: 'orange' },
  empty: { label: '尚未收到事件', description: '线上已启用采集，所选日期尚无事件。请访问已发布的站点页面后刷新；编辑预览不计入正式指标。', color: 'blue' },
  collecting: { label: '采集正常', description: '正式访问、搜索、阅读和业务成功使用同一套事件事实。', color: 'green' },
  attention: { label: '采集需要关注', description: '检测到拒收或事件上下文异常，请检查下方质量信息与失败原因。', color: 'red' },
} as const;

export default function CmsStatsQuality({ data, refreshing, onRefresh }: Readonly<{ data: CmsStatQuality; refreshing: boolean; onRefresh: () => void }>) {
  const status = CMS_COLLECTION_STATUS[data.status];
  return <>
    <Banner type={data.status === 'attention' ? 'warning' : 'info'} description={status.description} />
    <Typography.Paragraph type="tertiary">质量指标按所选站点与日期统计，不受内容、栏目和来源筛选影响；拒收事件不计入正式运营指标。</Typography.Paragraph>
    <Descriptions data={[
      { key: '采集状态', value: <Tag color={status.color}>{status.label}</Tag> },
      { key: '当前配置', value: data.configuredEnabled ? '已启用' : '已停用' },
      { key: '线上配置', value: data.publishedEnabled ? '已启用' : '未启用' },
      { key: '最后收到事件', value: <DateTimeText value={data.lastReceivedAt} mode="absolute" empty="尚无事件" /> },
      { key: '最后事件发生', value: <DateTimeText value={data.lastEventAt} mode="absolute" empty="尚无事件" /> },
      { key: '收数延迟 P95', value: data.latencyP95Ms === null ? '尚无样本' : `${(data.latencyP95Ms / 1000).toFixed(1)} 秒` },
    ]} />
    <StatGrid minItemWidth={160}>
      <StatCard title="有效接收" value={data.acceptedEvents} />
      <StatCard title="幂等去重" value={data.duplicateEvents} sub={`占收数 ${data.duplicateRate.toFixed(1)}%`} />
      <StatCard title="拒收" value={data.rejectedEvents} sub={`占收数 ${data.rejectionRate.toFixed(1)}%`} />
      <StatCard title="成功转化待入库" value={data.pendingConversions} sub="业务已成功，正在可靠投递" />
      <StatCard title="成功转化投递失败" value={data.failedConversions} sub="需要检查重试状态" />
      <StatCard title="缺少页面上下文" value={data.eventsWithoutPage} />
      <StatCard title="缺少访客身份" value={data.eventsWithoutVisitor} />
    </StatGrid>
    <div className="chart-grid">
      <Card title="事件覆盖" bodyStyle={{ padding: 0 }}><ConfigurableTable columnSettingsKey="cms-stats-event-types" columns={[{ title: '事件', dataIndex: 'event', minWidth: 240 }, { title: '有效次数', dataIndex: 'count', width: 110, align: 'right' }]} dataSource={data.eventTypes} rowKey="event" pagination={false} onRefresh={onRefresh} refreshLoading={refreshing} empty="尚无有效事件" /></Card>
      <Card title="拒收与去重原因" bodyStyle={{ padding: 0 }}><ConfigurableTable columnSettingsKey="cms-stats-reasons" columns={[{ title: '原因', dataIndex: 'reason', minWidth: 240 }, { title: '次数', dataIndex: 'count', width: 110, align: 'right' }]} dataSource={data.reasons} rowKey="reason" pagination={false} onRefresh={onRefresh} refreshLoading={refreshing} empty="暂无异常记录" /></Card>
    </div>
  </>;
}
