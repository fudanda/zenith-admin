import type { ReactNode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { cmsStatMetricsSchema, type CmsStatOverview, type CmsStatQuality } from '@arcbase/shared/cms';
import type { CmsStatsQuery } from '@/hooks/queries/cms-stats';
import StatsPage from './StatsPage';

const state = vi.hoisted(() => ({ overview: undefined as CmsStatOverview | undefined, quality: undefined as CmsStatQuality | undefined, failure: false, queries: [] as CmsStatsQuery[] }));
vi.mock('@/hooks/queries/cms-stats', () => ({
  cmsStatKeys: { report: ['report'], quality: ['quality'], options: ['options'] },
  useCmsStatsOverview: (query: CmsStatsQuery) => { state.queries.push(query); return { data: state.overview, isError: state.failure, error: state.failure ? new Error('断开连接') : null, isLoading: false }; },
  useCmsStatsQuality: () => ({ data: state.quality, isError: false, isLoading: false, isFetching: false, refetch: vi.fn() }),
  useCmsStatsOptions: () => ({ data: { content: [{ value: '42', label: '文化观察' }], channel: [], release: [], author: [] } }),
}));
vi.mock('@/hooks/queries/cms-sites', () => ({ useCmsSiteDetail: () => ({ data: { id: 1, name: '测试站', settings: { telemetry: { enabled: true, timeZone: 'Asia/Shanghai' } } }, isLoading: false }) }));
vi.mock('@/hooks/usePermission', () => ({ usePermission: () => ({ hasPermission: () => false }) }));
vi.mock('@/hooks/usePreferences', () => ({ useOptionalPreferences: () => undefined, usePreferences: () => ({ preferences: { tablePageSize: 10 } }) }));
vi.mock('./CmsSiteSelect', () => ({ CmsSiteSelect: ({ onChange }: { onChange: (id: number) => void }) => <button onClick={() => onChange(1)}>选择测试站点</button> }));
vi.mock('./stats/CmsTelemetrySettings', () => ({ useCmsTelemetrySettings: () => ({ editor: null, open: vi.fn() }) }));
vi.mock('./stats/CmsStatsNameFilter', () => ({ default: () => null }));
vi.mock('./CmsDashboardCharts', () => ({ CmsStatsTrend: () => <div>趋势图</div> }));
vi.mock('./stats/CmsStatsReport', () => ({ default: ({ onDrill, query }: { onDrill?: (dimension: 'content', key: string) => void; query: CmsStatsQuery }) => <div><span data-testid="report-scope">{query.contentId ?? 'all'}</span>{onDrill ? <button onClick={() => onDrill('content', '42')}>筛选文化观察</button> : null}</div> }));

function wrapper({ children }: { children: ReactNode }) { return <QueryClientProvider client={new QueryClient()}><MemoryRouter>{children}</MemoryRouter></QueryClientProvider>; }
beforeEach(() => {
  const metrics = cmsStatMetricsSchema.parse(Object.fromEntries(Object.keys(cmsStatMetricsSchema.shape).map((key) => [key, 0])));
  const scope = { startTime: '2026-09-01T00:00:00Z', endTime: '2026-09-28T00:00:00Z', watermark: '2026-09-28T00:00:00Z', comparisonStart: null, comparisonEnd: null, timeZone: 'Asia/Shanghai', granularity: 'day' as const };
  state.overview = { scope, status: 'collecting', metrics: { ...metrics, pv: 15, uv: 3, noResultKeywords: 25, searches: 40, noResultSearches: 30 }, previousMetrics: null, collectionAvailableSince: null, comparisonAvailable: false, comparisonUnavailableReason: null, trend: [] };
  state.quality = { scope, status: 'collecting', configuredEnabled: true, publishedEnabled: true, acceptedEvents: 55, rejectedEvents: 0, duplicateEvents: 0, rejectionRate: 0, duplicateRate: 0, lastReceivedAt: scope.watermark, lastEventAt: scope.watermark, latencyP95Ms: 100, eventsWithoutPage: 0, eventsWithoutVisitor: 0, pendingConversions: 0, failedConversions: 0, eventTypes: [], reasons: [] };
  state.failure = false; state.queries.length = 0;
});
describe('CMS statistics workspace', () => {
  it('shows query failure without replacing unavailable metrics with business zeros', () => {
    state.overview = undefined; state.failure = true;
    const view = render(<StatsPage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '选择测试站点' }));
    expect(screen.getByText(/指标尚未取得，不能视作零访问/)).toBeInTheDocument();
    expect(view.container.querySelector('.zx-stat')).toBeNull();
    expect(screen.getAllByRole('tab')).toHaveLength(6);
  });
  it('uses full keyword total and propagates report drill-down to the shared scope', () => {
    const view = render(<StatsPage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '选择测试站点' }));
    fireEvent.click(screen.getByRole('button', { name: '筛选文化观察' }));
    expect(state.queries.at(-1)?.contentId).toBe(42);
    expect(screen.getByTestId('report-scope')).toHaveTextContent('42');
    fireEvent.click(screen.getByRole('tab', { name: '搜索' }));
    const card = Array.from(view.container.querySelectorAll('.zx-stat')).find((node) => node.textContent?.includes('无结果独立词'));
    expect(card?.querySelector('.zx-stat__value')).toHaveTextContent('25');
  });
  it('keeps publication status distinct from an empty traffic interval', () => {
    state.quality = { ...state.quality!, status: 'pending_publication', publishedEnabled: false };
    render(<StatsPage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '选择测试站点' }));
    expect(screen.getByText('配置待发布')).toBeInTheDocument();
    expect(screen.getByText(/采集配置与线上版本尚未一致/)).toBeInTheDocument();
  });
  it('explains missing comparison coverage instead of showing a fabricated improvement over zero', () => {
    state.overview = { ...state.overview!, comparisonUnavailableReason: '对比期间尚未开启采集，无法计算同比。', collectionAvailableSince: '2026-09-28T00:00:00Z' };
    const view = render(<StatsPage />, { wrapper });
    fireEvent.click(screen.getByRole('button', { name: '选择测试站点' }));
    expect(screen.getByText('对比期间尚未开启采集，无法计算同比。')).toBeInTheDocument();
    expect(view.container.querySelector('.zx-stat__delta')).toBeNull();
  });
});
