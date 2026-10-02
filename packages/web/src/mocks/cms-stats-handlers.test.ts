import { afterEach, describe, expect, it } from 'vitest';
import type { CmsStatOverview, CmsStatQuality, CmsStatReport, CmsStatOptions } from '@arcbase/shared/cms';
import { cmsStatsHandlers } from './handlers/cms-stats';
import { mockCmsSites } from './data/cms';
import { resetMockCmsReleases } from './handlers/cms-releases';

const sites = structuredClone(mockCmsSites);
afterEach(() => { mockCmsSites.splice(0, mockCmsSites.length, ...structuredClone(sites)); resetMockCmsReleases(); });
async function call<T>(path: string, body?: unknown) {
  for (const handler of cmsStatsHandlers) {
    const request = new Request(`${window.location.origin}/api/cms/${path}`, { method: body ? 'PUT' : 'GET', headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await handler.run({ request, requestId: `cms-stats-${Math.random()}` });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { data: T } };
  }
  throw new Error(`No handler for ${path}`);
}
describe('CMS unified statistics demo', () => {
  it('keeps complete keyword totals independent from ranking pagination and supports keyword filtering', async () => {
    const overview = await call<CmsStatOverview>('stats/overview?siteId=1');
    const first = await call<CmsStatReport>('stats/report?siteId=1&dimension=search&page=1&pageSize=20&sortBy=noResultSearches');
    const second = await call<CmsStatReport>('stats/report?siteId=1&dimension=search&page=2&pageSize=20&sortBy=noResultSearches');
    expect(overview.body.data.metrics.noResultKeywords).toBe(25);
    expect(first.body.data.total).toBe(26);
    expect(first.body.data.list).toHaveLength(20);
    expect(second.body.data.list).toHaveLength(6);
    expect(new Set([...first.body.data.list, ...second.body.data.list].map((row) => row.key)).size).toBe(26);
    const filtered = await call<CmsStatReport>(`stats/report?siteId=1&dimension=search&keyword=${encodeURIComponent('文化选题 26')}`);
    expect(filtered.body.data.total).toBe(1);
    expect(filtered.body.data.list[0].noResultSearches).toBe(0);
  });
  it('uses one filtered scope for cards and trends, isolates sites, and accepts an empty date range', async () => {
    const options = await call<CmsStatOptions>('stats/options?siteId=1');
    const id = options.body.data.content[0].value;
    const filtered = await call<CmsStatOverview>(`stats/overview?siteId=1&contentId=${id}&granularity=hour`);
    expect(filtered.body.data.trend.reduce((sum, row) => sum + row.pv, 0)).toBe(filtered.body.data.metrics.pv);
    const content = await call<CmsStatReport>(`stats/report?siteId=1&contentId=${id}&dimension=content`);
    expect(content.body.data.list[0].pv).toBe(filtered.body.data.metrics.pv);
    const all = await call<CmsStatReport>('stats/report?siteId=1&dimension=content');
    expect(all.body.data.list.find((row) => row.key === id)?.pv).toBe(filtered.body.data.metrics.pv);
    const empty = await call<CmsStatReport>(`stats/report?siteId=2&contentId=${id}&dimension=content`);
    expect(empty.body.data.total).toBe(0);
    const oldRange = await call<CmsStatOverview>('stats/overview?siteId=1&startTime=2020-01-01&endTime=2020-01-02&compare=none');
    expect(oldRange.body.data.metrics.pv).toBe(0);
    expect(oldRange.body.data.previousMetrics).toBeNull();
    expect(oldRange.body.data.trend).toHaveLength(2);
  });
  it('reports a saved collection change as pending publication rather than active', async () => {
    const configured = await call<{ requiresPublication: boolean }>('telemetry/1', { enabled: true, timeZone: 'UTC' });
    expect(configured.status).toBe(200);
    expect(configured.body.data.requiresPublication).toBe(true);
    const quality = await call<CmsStatQuality>('stats/quality?siteId=1');
    expect(quality.body.data).toMatchObject({ status: 'pending_publication', configuredEnabled: true, publishedEnabled: false });
    expect((await call('stats/overview?siteId=999999')).status).toBe(404);
  });
});
