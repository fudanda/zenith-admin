import { lazy, Suspense, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Banner, Button, Card, Empty, Select, Skeleton, Space, TabPane, Tabs, Tag, Typography } from '@douyinfe/semi-ui';
import { cmsStatContract, CMS_CONTENT_TYPES, CMS_CONTENT_TYPE_LABELS, type CmsStatMetrics } from '@arcbase/shared/cms';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import DateTimeText from '@/components/DateTimeText';
import { DateRangeFilter, FilterSelect } from '@/components/search-filters';
import { ListSearchToolbar } from '@/components/list-page';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { useUrlTabState } from '@/hooks/useUrlTabState';
import { usePermission } from '@/hooks/usePermission';
import { useCmsSiteDetail } from '@/hooks/queries/cms-sites';
import { cmsStatKeys, useCmsStatsOptions, useCmsStatsOverview, useCmsStatsQuality, type CmsStatsQuery } from '@/hooks/queries/cms-stats';
import { contractKey } from '@/lib/contract-query';
import { formatDateRangeForApi } from '@/utils/date';
import { IANA_TIMEZONE_OPTIONS } from '@/utils/timezones';
import { CmsSiteSelect } from './CmsSiteSelect';
import CmsAttributionPanel from './CmsAttributionPanel';
import CmsStatsReport from './stats/CmsStatsReport';
import CmsStatsNameFilter from './stats/CmsStatsNameFilter';
import CmsStatsQuality, { CMS_COLLECTION_STATUS } from './stats/CmsStatsQuality';
import { useCmsTelemetrySettings } from './stats/CmsTelemetrySettings';
import { DIMENSION_LABELS, METRIC_LABELS, cmsStatsDateRange, displayCmsMetric, formatCmsScopeTime, type CmsStatsDimension } from './stats/cms-stats-presentation';

const CmsStatsTrend = lazy(() => import('./CmsDashboardCharts').then(charts => ({ default: charts.CmsStatsTrend })));

/** 页签内容区首屏骨架：按总览布局（指标卡 + 趋势图）占位，避免左上角小 spinner 闪烁。 */
function CmsStatsSkeleton() {
  return (
    <Skeleton
      loading
      active
      placeholder={(
        <>
          <StatGrid minItemWidth={180}>
            {Array.from({ length: 4 }, (_, index) => `cms-stats-sk-${index}`).map((key) => (
              <div key={key}>
                <Skeleton.Title style={{ width: 64, height: 26, marginBottom: 10 }} />
                <Skeleton.Paragraph rows={1} style={{ width: '70%', marginBottom: 0 }} />
              </div>
            ))}
          </StatGrid>
          <Card title="流量与有效参与趋势" style={{ marginTop: 12 }}>
            <Skeleton.Image style={{ width: '100%', height: 230 }} />
          </Card>
        </>
      )}
    >{null}</Skeleton>
  );
}
const TABS = ['overview', 'content', 'sources', 'search', 'conversions', 'quality'] as const;
type Filters = Omit<CmsStatsQuery, 'siteId' | 'startTime' | 'endTime'> & { range: [Date, Date] | null };
const CONTENT_DIMENSIONS = ['content', 'channel', 'author', 'contentType', 'release'] as const;
const SOURCE_DIMENSIONS = ['source', 'entry', 'referrer', 'utmSource', 'utmMedium', 'utmCampaign', 'utmTerm', 'utmContent'] as const;
const AUDIENCE_DIMENSIONS = ['device', 'browser', 'os', 'country'] as const;
const OVERVIEW_METRICS: (keyof CmsStatMetrics)[] = ['pv', 'uv', 'sessions', 'reads', 'readRate', 'avgActiveMs', 'avgScrollDepth', 'engagementRate', 'bounceRate', 'newVisitors', 'returningVisitors'];
const EXPLANATIONS: Partial<Record<keyof CmsStatMetrics, string>> = {
  pv: '可见页面浏览，排除预览与爬虫', uv: '整个区间独立去重，不累加每日 UV', sessions: '同站点 30 分钟无活动开启新会话', reads: '活跃 ≥10 秒且正文深度 ≥50%，短正文需读完', readRate: '有效阅读页次 ÷ 浏览页次',
  avgActiveMs: '可见活跃总时长 ÷ 页面浏览量', engagementRate: '参与会话 ÷ 浏览会话', newVisitors: '区间首次访问的访客', returningVisitors: '区间前已有访问的访客',
  avgScrollDepth: '每次浏览的最高阅读深度平均值', bounceRate: '未参与会话 ÷ 浏览会话',
};

function StatsWorkspace({ siteId, timeZone }: Readonly<{ siteId: number; timeZone: string }>) {
  const navigate = useNavigate();
  const [activeTab, setActiveTab] = useUrlTabState(TABS, 'overview');
  const site = useCmsSiteDetail(siteId);
  const settings = useCmsTelemetrySettings();
  const { hasPermission } = usePermission();
  const filters = useListSearch<Filters>({ defaults: () => ({ range: cmsStatsDateRange(timeZone), timeZone, granularity: 'day', compare: 'previous_period' }), listKey: contractKey(cmsStatContract.overview), extraKeys: [cmsStatKeys.report, cmsStatKeys.quality, cmsStatKeys.options] });
  const { range, ...submitted } = filters.submittedParams;
  const filterQuery = useFilterQuery({ ...submitted, ...formatDateRangeForApi(range) });
  const query = useMemo(() => ({ ...filterQuery, siteId }), [filterQuery, siteId]);
  const optionsQuery = useFilterQuery({ siteId, timeZone: query.timeZone, days: query.days, startTime: query.startTime, endTime: query.endTime });
  const options = useCmsStatsOptions({ ...optionsQuery, siteId });
  const overview = useCmsStatsOverview(query);
  const snapshotQuery = useMemo(() => ({ ...query, watermark: overview.data?.scope.watermark }), [query, overview.data?.scope.watermark]);
  const quality = useCmsStatsQuality(query);
  const [contentDimension, setContentDimension] = useState<CmsStatsDimension>('content');
  const [sourceDimension, setSourceDimension] = useState<CmsStatsDimension>('source');
  const [audienceDimension, setAudienceDimension] = useState<CmsStatsDimension>('device');
  const numberOptions = useMemo(() => ({ content: options.data?.content.map((item) => ({ ...item, value: Number(item.value) })) ?? [], channel: options.data?.channel.map((item) => ({ ...item, value: Number(item.value) })) ?? [], release: options.data?.release.map((item) => ({ ...item, value: Number(item.value) })) ?? [] }), [options.data]);
  const status = quality.data ? CMS_COLLECTION_STATUS[quality.data.status] : undefined;
  const metrics = overview.data?.metrics;
  const filtered = Boolean(query.contentId || query.channelId || query.releaseId || query.author || query.contentType || query.source || query.device);
  function drill(dimension: CmsStatsDimension, key: string) {
    const field = ({ content: 'contentId', channel: 'channelId', release: 'releaseId' } as const)[dimension as 'content' | 'channel' | 'release'];
    if (field && /^\d+$/u.test(key)) filters.applySearch({ ...filters.submittedParams, [field]: Number(key) });
    else if (['author', 'contentType', 'source', 'device'].includes(dimension)) filters.applySearch({ ...filters.submittedParams, [dimension]: key });
    setActiveTab('overview');
  }
  const dimensionSelect = (dimensions: readonly CmsStatsDimension[], value: CmsStatsDimension, onChange: (value: CmsStatsDimension) => void, label: string) => <Select aria-label={label} value={value} onChange={(next) => onChange(next as CmsStatsDimension)} optionList={dimensions.map((dimension) => ({ value: dimension, label: DIMENSION_LABELS[dimension] }))} />;
  return <>
    <ListSearchToolbar onSearch={filters.handleSearch} onReset={filters.handleReset} filters={<>
      <DateRangeFilter type="dateRange" {...filters.bind('range')} />
      <Select aria-label="统计时区" {...filters.bind('timeZone', (value: unknown) => value as Filters['timeZone'])} optionList={IANA_TIMEZONE_OPTIONS} filter style={{ width: 180 }} />
      <Select aria-label="时间粒度" {...filters.bind('granularity', (value: unknown) => value as Filters['granularity'])} optionList={[{ value: 'day', label: '按天统计' }, { value: 'hour', label: '按小时统计' }]} />
      <Select aria-label="对比周期" {...filters.bind('compare', (value: unknown) => value as Filters['compare'])} optionList={[{ value: 'previous_period', label: '对比上一周期' }, { value: 'previous_year', label: '对比去年同期' }, { value: 'none', label: '不对比' }]} />
      <CmsStatsNameFilter query={query} dimension="content" placeholder="全部内容" width={220} initialOptions={numberOptions.content} {...filters.bind('contentId')} />
      <CmsStatsNameFilter query={query} dimension="channel" placeholder="全部栏目" initialOptions={numberOptions.channel} {...filters.bind('channelId')} />
      <CmsStatsNameFilter query={query} dimension="release" placeholder="全部发布版本" initialOptions={numberOptions.release} {...filters.bind('releaseId')} />
      <CmsStatsNameFilter query={query} dimension="author" placeholder="全部作者" initialOptions={options.data?.author ?? []} {...filters.bind('author')} />
      <FilterSelect placeholder="全部内容形态" width={140} items={CMS_CONTENT_TYPES.map((value) => ({ value, label: CMS_CONTENT_TYPE_LABELS[value] }))} {...filters.bind('contentType')} />
    </>} actions={<>
      {hasPermission('cms:site:update') ? <Button disabled={!site.data} onClick={() => site.data && settings.open(site.data)}>采集设置</Button> : null}
      <Button onClick={() => navigate(`/cms/publishing?siteId=${siteId}`)}>发布配置</Button>
    </>} />
    <Space wrap style={{ marginBottom: 12 }}>
      <Tag color="blue">正式用户流量</Tag>{status ? <Tag color={status.color}>{status.label}</Tag> : null}
      <Typography.Text type="tertiary">预览、内部测试、爬虫和技术请求不混入用户 PV</Typography.Text>
      {query.source ? <Tag closable onClose={() => filters.applySearch({ ...filters.submittedParams, source: undefined })}>来源：{query.source}</Tag> : null}
      {query.device ? <Tag closable onClose={() => filters.applySearch({ ...filters.submittedParams, device: undefined })}>设备：{query.device}</Tag> : null}
    </Space>
    {overview.isError ? <Banner type="danger" description={`统计查询失败：${overview.error.message}${overview.data ? '。下方保留上次成功数据，请刷新重试。' : '。指标尚未取得，不能视作零访问。'}`} /> : null}
    {quality.isError ? <Banner type="warning" description={`采集状态查询失败：${quality.error.message}`} /> : null}
    {options.isError ? <Banner type="warning" description="筛选名称加载失败，请刷新后重试。" /> : null}
    {quality.data && ['disabled', 'pending_publication', 'attention'].includes(quality.data.status) ? <Banner type={quality.data.status === 'attention' ? 'warning' : 'info'} description={status?.description} /> : null}
    {overview.data ? <Typography.Paragraph type="tertiary">
      {formatCmsScopeTime(overview.data.scope.startTime, overview.data.scope.timeZone)} 至 {formatCmsScopeTime(overview.data.scope.endTime, overview.data.scope.timeZone)}（{overview.data.scope.timeZone}，结束边界不含） · 统计截至 <DateTimeText value={overview.data.scope.watermark} mode="absolute" />
      {overview.data.scope.comparisonStart && overview.data.scope.comparisonEnd ? ` · 对比 ${formatCmsScopeTime(overview.data.scope.comparisonStart, overview.data.scope.timeZone)} 至 ${formatCmsScopeTime(overview.data.scope.comparisonEnd, overview.data.scope.timeZone)}` : ''}
    </Typography.Paragraph> : null}
    {overview.data?.comparisonUnavailableReason ? <Banner type="info" description={overview.data.comparisonUnavailableReason} /> : null}
    {overview.data?.collectionAvailableSince ? <Typography.Paragraph type="tertiary">统一采集数据起点：<DateTimeText value={overview.data.collectionAvailableSince} mode="absolute" />。早于此时点的期间未采集，不作为零流量对比。</Typography.Paragraph> : null}
    <Tabs collapsible="auto" type="line" activeKey={activeTab} onChange={(value) => setActiveTab(value as typeof activeTab)}>
      {TABS.map((tab, index) => <TabPane key={tab} itemKey={tab} tab={['总览', '内容', '来源与入口', '搜索', '互动与转化', '采集质量'][index]} />)}
    </Tabs>
    {activeTab === 'quality' ? quality.data ? <CmsStatsQuality data={quality.data} refreshing={quality.isFetching} onRefresh={() => void quality.refetch()} /> : <Skeleton active loading placeholder={<Skeleton.Paragraph rows={6} />} /> : !metrics || !overview.data ? overview.isLoading ? <CmsStatsSkeleton /> : <Empty description="尚未取得统计数据，请刷新重试" /> : <>
      {metrics.pv === 0 && !overview.isError ? <Banner type="info" description={filtered ? '当前筛选下暂无页面浏览；可以重置内容、栏目或版本条件查看全站数据。行为事件仍单独展示。' : (status?.description ?? '当前区间暂无正式访问事件。')} /> : null}
      {activeTab === 'overview' ? <>
        <StatGrid minItemWidth={180}>{OVERVIEW_METRICS.map((field) => <StatCard key={field} title={METRIC_LABELS[field]} value={displayCmsMetric(metrics, field)} sub={EXPLANATIONS[field]} delta={overview.data?.previousMetrics && ['pv', 'uv', 'sessions', 'reads', 'newVisitors', 'returningVisitors'].includes(field) ? metrics[field] - overview.data.previousMetrics[field] : null} deltaLabel={query.compare === 'previous_year' ? '较去年同期' : '较上一周期'} />)}</StatGrid>
        <Card title="流量与有效参与趋势"><Suspense fallback={<Skeleton active loading placeholder={<Skeleton.Image style={{ width: '100%', height: 230 }} />} />}><CmsStatsTrend data={overview.data.trend} /></Suspense><Typography.Text type="tertiary">每日 UV 独立去重，不能相加替代区间 UV。参与会话满足活跃 10 秒、有效阅读、成功转化或至少浏览两页之一。</Typography.Text></Card>
        <Card title="受众分布" style={{ marginTop: 12 }} headerExtraContent={dimensionSelect(AUDIENCE_DIMENSIONS, audienceDimension, setAudienceDimension, '受众维度')}><CmsStatsReport key={audienceDimension} query={snapshotQuery} dimension={audienceDimension} onDrill={drill} /></Card>
      </> : null}
      {activeTab === 'content' ? <Card title="内容效果" headerExtraContent={dimensionSelect(CONTENT_DIMENSIONS, contentDimension, setContentDimension, '内容分析维度')}><CmsStatsReport key={contentDimension} query={snapshotQuery} dimension={contentDimension} onDrill={drill} /></Card> : null}
      {activeTab === 'sources' ? <Card title="会话来源与入口" headerExtraContent={dimensionSelect(SOURCE_DIMENSIONS, sourceDimension, setSourceDimension, '来源分析维度')}><Typography.Paragraph type="tertiary">来源固定为会话首次入口，后续内容跳转不会覆盖；转化率分母为对应来源的区间浏览访客。</Typography.Paragraph><CmsStatsReport key={sourceDimension} query={snapshotQuery} dimension={sourceDimension} onDrill={drill} /></Card> : null}
      {activeTab === 'search' ? <><StatGrid><StatCard title="搜索次数" value={metrics.searches} /><StatCard title="独立搜索词" value={metrics.uniqueKeywords} /><StatCard title="无结果独立词" value={metrics.noResultKeywords} sub="全量去重，不受分页或排行截断影响" /><StatCard title="无结果次数 / 搜索次数" value={`${metrics.noResultSearches} / ${metrics.searches}`} sub={metrics.searches ? `无结果率 ${(metrics.noResultSearches / metrics.searches * 100).toFixed(1)}%` : '暂无搜索分母'} /><StatCard title="搜索结果点击" value={metrics.searchClicks} /><StatCard title="搜索点击率" value={displayCmsMetric(metrics, 'searchClickRate')} sub="发生点击的搜索次数 ÷ 搜索次数" /></StatGrid><Card title="搜索需求与后续阅读"><Typography.Paragraph type="tertiary">后续阅读与成功转化关联同一访客、同一会话、点击后 30 分钟内的目标内容，按最近一次搜索点击归因。</Typography.Paragraph><CmsStatsReport query={snapshotQuery} dimension="search" /></Card></> : null}
      {activeTab === 'conversions' ? <CmsAttributionPanel query={snapshotQuery} overview={overview.data} /> : null}
    </>}
    {settings.editor}
  </>;
}

export default function StatsPage() {
  const [siteId, setSiteId] = useState<number>();
  const site = useCmsSiteDetail(siteId);
  return <div className="page-container page-tabs-page zx-flat-panels">
    <Space wrap style={{ marginBottom: 12 }}><CmsSiteSelect value={siteId} onChange={setSiteId} /><Typography.Text type="tertiary">访问统计</Typography.Text></Space>
    {siteId && site.data ? <StatsWorkspace key={siteId} siteId={siteId} timeZone={(site.data.settings.telemetry as { timeZone?: string } | undefined)?.timeZone ?? 'Asia/Shanghai'} /> : siteId && site.isLoading ? <CmsStatsSkeleton /> : <Empty description={site.isError ? '站点信息加载失败，请刷新重试' : '请选择站点查看统计'} />}
  </div>;
}
