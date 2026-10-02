import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc';
import timezone from 'dayjs/plugin/timezone';
import { cmsStatContract, cmsStatMetricsSchema, cmsTelemetryAdminContract, cmsStatRate, type CmsStatMetrics, type CmsStatReportRow, type CmsStatScope } from '@arcbase/shared/cms';
import type { QueryOf } from '@arcbase/shared/core';
import { mock } from '../utils/contract';
import { matchesFilter } from '../utils/filter';
import { requireItem } from '../utils/crud';
import { mockCmsSites, mockCmsContents, mockCmsChannels } from '../data/cms';
import { getMockCmsPublishedTelemetry, stageMockCmsConfigurationDraft } from './cms-releases';

type StatsQuery = QueryOf<typeof cmsStatContract.overview>;
type ReportQuery = QueryOf<typeof cmsStatContract.report>;
dayjs.extend(utc); dayjs.extend(timezone);
const zero = (): CmsStatMetrics => cmsStatMetricsSchema.parse(Object.fromEntries(Object.keys(cmsStatMetricsSchema.shape).map((key) => [key, 0])));
function scope(query: StatsQuery): CmsStatScope {
  const zone = query.timeZone ?? 'Asia/Shanghai';
  const from = dayjs.tz(query.startTime ?? dayjs().tz(zone).subtract((query.days ?? 30) - 1, 'day').format('YYYY-MM-DD'), zone).startOf('day');
  const until = dayjs.tz(query.endTime ?? dayjs().tz(zone).format('YYYY-MM-DD'), zone).add(1, 'day').startOf('day');
  const span = until.diff(from, 'day');
  return { startTime: from.toISOString(), endTime: until.toISOString(), timeZone: zone, granularity: query.granularity ?? 'day', comparisonStart: query.compare === 'none' ? null : (query.compare === 'previous_year' ? from.subtract(1, 'year') : from.subtract(span, 'day')).toISOString(), comparisonEnd: query.compare === 'none' ? null : (query.compare === 'previous_year' ? until.subtract(1, 'year') : from).toISOString(), watermark: query.watermark ?? new Date().toISOString() };
}
function contentRows(query: StatsQuery): CmsStatReportRow[] {
  requireItem(mockCmsSites, query.siteId, '站点不存在', { status: 404 });
  const today = dayjs().format('YYYY-MM-DD');
  if ((query.startTime && query.startTime.slice(0, 10) > today) || (query.endTime && query.endTime.slice(0, 10) < today)) return [];
  return mockCmsContents.filter((row) => row.siteId === query.siteId && row.status === 'published' && matchesFilter(row.id, query.contentId) && matchesFilter(row.channelId, query.channelId) && matchesFilter(row.contentType, query.contentType) && matchesFilter(row.author, query.author) && matchesFilter('direct', query.source) && matchesFilter('pc', query.device) && matchesFilter(1, query.releaseId)).map((row) => ({ ...zero(), key: String(row.id), label: row.title, pv: 10 + row.id, uv: 5 + row.id, sessions: 6 + row.id, newVisitors: 3 + row.id, returningVisitors: 2, reads: 3, readRate: cmsStatRate(3, 10 + row.id), activeMs: 120_000, avgActiveMs: 120_000 / (10 + row.id), avgScrollDepth: 60, engagedSessions: 4, engagementRate: cmsStatRate(4, 6 + row.id), bounceRate: cmsStatRate(2 + row.id, 6 + row.id), conversions: 1, conversionVisitors: 1, conversionRate: cmsStatRate(1, 5 + row.id), formStarts: 2, formCompletions: 1, downloadClicks: 2, downloads: 1 }));
}
function sum(rows: CmsStatMetrics[]): CmsStatMetrics {
  const output = zero();
  for (const row of rows) for (const key of Object.keys(output) as (keyof CmsStatMetrics)[]) output[key] += row[key];
  output.avgActiveMs = output.pv ? output.activeMs / output.pv : 0;
  output.readRate = cmsStatRate(output.reads, output.pv); output.searchClickRate = cmsStatRate(output.searchClicks, output.searches);
  output.avgScrollDepth = output.pv ? rows.reduce((n, row) => n + row.avgScrollDepth * row.pv, 0) / output.pv : 0;
  output.engagementRate = cmsStatRate(output.engagedSessions, output.sessions); output.bounceRate = cmsStatRate(output.sessions - output.engagedSessions, output.sessions);
  output.conversionRate = cmsStatRate(output.conversionVisitors, output.uv); output.ctr = cmsStatRate(output.clicks, output.impressions);
  return output;
}
function searchRows(query: StatsQuery): CmsStatReportRow[] {
  if (!contentRows(query).length) return [];
  return Array.from({ length: 26 }, (_, index) => ({ ...zero(), key: `文化选题 ${index + 1}`, label: `文化选题 ${index + 1}`, searches: index + 1, uv: 1, uniqueKeywords: 1, noResultKeywords: index < 25 ? 1 : 0, noResultSearches: index < 25 ? index + 1 : 0, searchClicks: index === 25 ? 3 : 0, searchClickRate: index === 25 ? cmsStatRate(3, index + 1) : 0 }));
}
export function hasMockCmsNoResultKeyword(siteId: number, keyword: string): boolean {
  return searchRows({ siteId }).some((row) => row.label === keyword && row.noResultSearches > 0);
}
function metrics(query: StatsQuery) { return sum([...contentRows(query), ...searchRows(query).map((row) => ({ ...row, uv: 0 }))]); }
function status(query: StatsQuery) {
  const site = requireItem(mockCmsSites, query.siteId, '站点不存在', { status: 404 });
  const configured = site.settings.telemetry as { enabled?: boolean; timeZone?: string } | undefined;
  const published = getMockCmsPublishedTelemetry(site.id);
  const state = configured?.enabled !== published?.enabled || configured?.timeZone !== published?.timeZone ? 'pending_publication' : !configured?.enabled ? 'disabled' : contentRows(query).length ? 'collecting' : 'empty';
  return { status: state as 'pending_publication' | 'disabled' | 'collecting' | 'empty', configuredEnabled: configured?.enabled === true, publishedEnabled: published?.enabled === true };
}
function reportRows(query: ReportQuery) {
  const rows = contentRows(query);
  if (query.dimension === 'search') return searchRows(query);
  if (!rows.length) return [];
  if (query.dimension === 'content' || !query.dimension) return rows;
  const groups = new Map<string, { label: string; rows: CmsStatMetrics[] }>();
  for (const row of rows) {
    const content = mockCmsContents.find((item) => String(item.id) === row.key)!;
    const channel = mockCmsChannels.find((item) => item.id === content.channelId);
    const [key, label] = ({ channel: [String(content.channelId), channel?.name ?? '未关联栏目'], author: [content.author ?? 'unknown', content.author ?? '未知作者'], contentType: [content.contentType, content.contentType], release: ['1', '演示发布版本'], source: ['direct', '直接访问'], entry: ['/', '首页'], device: ['pc', '桌面设备'], browser: ['Chrome', 'Chrome'], os: ['Windows', 'Windows'], country: ['unknown', '未知地区'], referrer: ['direct', '直接访问'], utmSource: ['unknown', '未标记来源'], utmMedium: ['unknown', '未标记媒介'], utmCampaign: ['unknown', '未标记活动'], utmTerm: ['unknown', '未标记关键词'], utmContent: ['unknown', '未标记内容'], form: ['contact', '联系表单'], interaction: ['unknown', '未设置互动'], media: ['unknown', '暂无媒体事件'], placement: ['unknown', '暂无版位事件'] } as Record<string, [string, string]>)[query.dimension];
    const group = groups.get(key) ?? { label, rows: [] }; group.rows.push(row); groups.set(key, group);
  }
  if (['media', 'placement', 'interaction'].includes(query.dimension)) return [];
  return [...groups.entries()].map(([key, group]) => ({ key, label: group.label, ...sum(group.rows) }));
}
export const cmsStatsHandlers = [
  mock(cmsStatContract.overview, ({ query, ok }) => {
    const currentScope = scope(query); const totals = metrics(query); const start = dayjs(currentScope.startTime).tz(currentScope.timeZone); const end = dayjs(currentScope.endTime).tz(currentScope.timeZone); const unit = query.granularity === 'hour' ? 'hour' : 'day';
    const trend = Array.from({ length: Math.max(0, end.diff(start, unit)) }, (_, index) => {
      const date = start.add(index, unit); const active = date.isSame(dayjs(), unit); const values = active ? totals : zero();
      return { date: date.format(unit === 'hour' ? 'YYYY-MM-DD HH:00' : 'YYYY-MM-DD'), pv: values.pv, uv: values.uv, sessions: values.sessions, reads: values.reads, conversions: values.conversions, searches: values.searches };
    });
    return ok({ scope: currentScope, status: status(query).status, metrics: totals, previousMetrics: null, collectionAvailableSince: totals.pv ? dayjs().startOf('day').toISOString() : null, comparisonAvailable: false, comparisonUnavailableReason: query.compare === 'none' ? null : '对比周期早于统一采集数据起点，不能将未采集期间视作零流量。', trend });
  }),
  mock(cmsStatContract.report, ({ query, ok }) => {
    const sortBy = query.sortBy ?? 'pv'; const order = query.sortOrder === 'asc' ? 1 : -1;
    const rows = reportRows(query).filter((row) => !query.keyword || row.label.includes(query.keyword)).sort((a, b) => (a[sortBy] - b[sortBy]) * order || a.key.localeCompare(b.key));
    const page = query.page ?? 1; const pageSize = query.pageSize ?? 20;
    return ok({ scope: scope(query), dimension: query.dimension ?? 'content', list: rows.slice((page - 1) * pageSize, page * pageSize), total: rows.length, page, pageSize });
  }),
  mock(cmsStatContract.options, ({ query, ok }) => {
    const rows = contentRows({ ...query, contentId: undefined, channelId: undefined, releaseId: undefined, author: undefined });
    return ok({ content: rows.map((row) => ({ value: row.key, label: row.label })), channel: mockCmsChannels.filter((row) => row.siteId === query.siteId).map((row) => ({ value: String(row.id), label: row.name })), author: [...new Set(mockCmsContents.filter((row) => row.siteId === query.siteId).flatMap((row) => row.author ? [row.author] : []))].map((value) => ({ value, label: value })), release: rows.length ? [{ value: '1', label: '演示发布版本' }] : [] });
  }),
  mock(cmsStatContract.quality, ({ query, ok }) => {
    const totals = metrics({ ...query, contentId: undefined, channelId: undefined, releaseId: undefined, author: undefined, contentType: undefined, source: undefined, device: undefined }); const hasEvents = totals.pv > 0;
    return ok({ scope: scope(query), ...status(query), acceptedEvents: totals.pv + totals.searches + totals.reads, rejectedEvents: 0, duplicateEvents: 0, rejectionRate: 0, duplicateRate: 0, lastReceivedAt: hasEvents ? new Date().toISOString() : null, lastEventAt: hasEvents ? new Date().toISOString() : null, latencyP95Ms: hasEvents ? 1200 : null, eventsWithoutPage: 0, eventsWithoutVisitor: 0, pendingConversions: 0, failedConversions: 0, eventTypes: hasEvents ? [{ event: 'cms.page_view', count: totals.pv }, { event: 'cms.search', count: totals.searches }, { event: 'cms.read', count: totals.reads }] : [], reasons: [] });
  }),
  mock(cmsTelemetryAdminContract.configure, ({ params, body, ok }) => {
    const site = requireItem(mockCmsSites, params.id, '站点不存在', { status: 404 });
    site.settings = { ...site.settings, telemetry: { ...body, schemaVersion: 2 } };
    stageMockCmsConfigurationDraft(site.id);
    return ok({ ...body, siteId: site.id, requiresPublication: true });
  }),
];
