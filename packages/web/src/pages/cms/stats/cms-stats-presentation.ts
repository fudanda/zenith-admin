import type { CmsStatMetrics } from '@arcbase/shared/cms';
import { ANALYTICS_DEVICE_TYPE_LABELS, type AnalyticsDeviceType } from '@arcbase/shared/analytics';
import type { CmsStatsReportQuery } from '@/hooks/queries/cms-stats';
import dayjs from 'dayjs';

export type CmsStatsDimension = NonNullable<CmsStatsReportQuery['dimension']>;
export function cmsStatsDimensionLabel(dimension: CmsStatsDimension, key: string, label: string): string {
  return dimension === 'device' ? ANALYTICS_DEVICE_TYPE_LABELS[key as AnalyticsDeviceType] ?? label : label;
}
export const DIMENSION_LABELS: Record<CmsStatsDimension, string> = {
  content: '内容', channel: '栏目', author: '作者', contentType: '内容形态', release: '发布版本',
  source: '来源渠道', entry: '入口页面', referrer: '引荐域名', utmSource: 'UTM 来源', utmMedium: 'UTM 媒介', utmCampaign: 'UTM 活动', utmTerm: 'UTM 关键词', utmContent: 'UTM 内容',
  device: '设备', browser: '浏览器', os: '操作系统', country: '国家或地区', search: '搜索词', media: '媒体素材版本', placement: '页面版位', form: '表单', interaction: '互动目标',
};
export const METRIC_LABELS: Record<keyof CmsStatMetrics, string> = {
  pv: '浏览量 PV', uv: '区间访客 UV', sessions: '会话数', newVisitors: '新访客', returningVisitors: '回访访客', reads: '有效阅读', readRate: '有效阅读率',
  activeMs: '活跃总时长', avgActiveMs: '每次浏览活跃时长', avgScrollDepth: '平均阅读深度', engagedSessions: '参与会话', engagementRate: '会话参与率', bounceRate: '跳出率',
  conversions: '成功转化', conversionVisitors: '转化访客', conversionRate: '访客转化率', searches: '搜索次数', noResultSearches: '无结果次数', uniqueKeywords: '独立搜索词', noResultKeywords: '无结果独立词', searchClicks: '搜索结果点击', searchClickRate: '搜索点击率',
  downloadClicks: '下载点击', downloads: '文件响应成功', formStarts: '表单开始', formErrors: '表单失败', formCompletions: '表单成功', votes: '投票成功', comments: '评论成功', follows: '关注成功',
  impressions: '版位曝光', clicks: '版位点击', ctr: '曝光点击率', mediaStarts: '媒体启播', media25: '播放达到 25%', media50: '播放达到 50%', media75: '播放达到 75%', mediaCompletions: '播放完成', mediaErrors: '播放失败',
};
const RATES = new Set<keyof CmsStatMetrics>(['engagementRate', 'bounceRate', 'conversionRate', 'ctr', 'avgScrollDepth', 'readRate', 'searchClickRate']);
export function formatCmsMetric(key: keyof CmsStatMetrics, value: number): string {
  if (RATES.has(key)) return `${value.toFixed(1)}%`;
  if (key === 'activeMs' || key === 'avgActiveMs') return value < 60_000 ? `${(value / 1000).toFixed(1)} 秒` : `${(value / 60_000).toFixed(1)} 分钟`;
  return value.toLocaleString('zh-CN');
}
export function displayCmsMetric(metrics: CmsStatMetrics, key: keyof CmsStatMetrics): string {
  if ((['engagementRate', 'bounceRate'].includes(key) && metrics.sessions === 0)
    || (['avgActiveMs', 'avgScrollDepth', 'readRate'].includes(key) && metrics.pv === 0)
    || (key === 'searchClickRate' && metrics.searches === 0)
    || (key === 'conversionRate' && metrics.uv === 0) || (key === 'ctr' && metrics.impressions === 0)) return '—';
  return formatCmsMetric(key, metrics[key]);
}
/** CSV quoting also prevents spreadsheet formula execution from reader-controlled keywords. */
export function cmsStatsCsvCell(value: string | number): string {
  const text = String(value);
  return `"${(/^[=+\-@\t\r]/u.test(text) ? `'${text}` : text).replaceAll('"', '""')}"`;
}
export function cmsStatsCsv(rows: readonly (readonly (string | number)[])[]): string {
  return '\uFEFF' + rows.map((row) => row.map(cmsStatsCsvCell).join(',')).join('\r\n');
}

export function cmsStatsDateRange(timeZone: string, now = new Date()): [Date, Date] {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find((item) => item.type === type)?.value;
  const today = dayjs(`${part('year')}-${part('month')}-${part('day')}`);
  return [today.subtract(29, 'day').startOf('day').toDate(), today.endOf('day').toDate()];
}
export function formatCmsScopeTime(value: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('zh-CN', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(value.replace(' ', 'T')));
  const part = (type: Intl.DateTimeFormatPartTypes) => parts.find(item => item.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')} ${part('hour')}:${part('minute')}`;
}
