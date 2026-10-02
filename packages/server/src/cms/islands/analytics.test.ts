// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CmsIdentity, CMS_SESSION_IDLE_MS, cmsStoragePrefix } from '@arcbase/analytics-sdk/cms-identity';
import type { CmsTelemetryEvent } from '@arcbase/shared/cms';
import { cmsTelemetryBatchSchema } from '@arcbase/shared/cms';
import { getCmsAttributionContext, runAnalytics, stopCmsAnalytics } from './analytics';

interface Batch { contextToken: string; events: CmsTelemetryEvent[] }
let delivered: Batch[];
let request: ReturnType<typeof vi.fn>;
let beacon: ReturnType<typeof vi.fn>;

function configure(extra: Record<string, unknown> = {}): void {
  document.head.innerHTML = '';
  const values = {
    'cms-telemetry-context': 'signed-page-context',
    'cms-telemetry-config': JSON.stringify({ siteId: 5, environment: 'live', canonicalPath: '/culture/article.html', pageType: 'content', contentId: 9, ...extra }),
  };
  for (const [name, content] of Object.entries(values)) {
    const meta = document.createElement('meta'); meta.name = name; meta.content = content; document.head.append(meta);
  }
}
function visible(value: boolean): void {
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: value ? 'visible' : 'hidden' });
  document.dispatchEvent(new Event('visibilitychange'));
}
function allEvents(): CmsTelemetryEvent[] { return delivered.flatMap((batch) => batch.events); }
function events(name: CmsTelemetryEvent['name']): CmsTelemetryEvent[] { return allEvents().filter((event) => event.name === name); }
async function settled(): Promise<void> { for (let index = 0; index < 8; index += 1) await Promise.resolve(); }
function queued(): string[] { return Object.keys(localStorage).filter((key) => key.startsWith(`${cmsStoragePrefix(5)}event:`)); }

beforeEach(() => {
  vi.useFakeTimers(); vi.setSystemTime(new Date('2026-09-28T02:00:00.000Z'));
  localStorage.clear(); sessionStorage.clear();
  document.head.innerHTML = ''; document.body.innerHTML = '';
  history.replaceState({}, '', '/culture/article.html');
  Object.defineProperty(document, 'visibilityState', { configurable: true, value: 'visible' });
  Object.defineProperty(window.navigator, 'onLine', { configurable: true, value: true });
  Object.defineProperty(window, 'innerHeight', { configurable: true, value: 800 });
  delivered = [];
  request = vi.fn(async (_url: string, init: RequestInit) => {
    const batch = JSON.parse(String(init.body)) as Batch; delivered.push(batch);
    return { ok: true, status: 200, json: async () => ({ code: 0, data: { acceptedEventIds: batch.events.map((event) => event.eventId), rejectedEventIds: [], duplicates: 0 } }) };
  });
  vi.stubGlobal('fetch', request);
  beacon = vi.fn(() => true);
  Object.defineProperty(navigator, 'sendBeacon', { value: beacon, configurable: true });
});
afterEach(() => { stopCmsAnalytics(); vi.useRealTimers(); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe('CMS visitor and shared session', () => {
  it('shares the site visitor and session across tabs, and isolates another site', () => {
    const first = new CmsIdentity(document, 5);
    const session = first.touch('/entry', 9);
    const second = new CmsIdentity(document, 5);
    expect(second.visitorId).toBe(first.visitorId);
    expect(second.touch('/other')).toMatchObject({ id: session.id, entryPath: '/entry', lastContentId: 9 });
    const anotherSite = new CmsIdentity(document, 6);
    expect(anotherSite.visitorId).not.toBe(first.visitorId);
    expect(anotherSite.touch('/entry').id).not.toBe(session.id);
  });

  it('renews only after 30 minutes of shared inactivity and retains a stable visitor', () => {
    const identity = new CmsIdentity(document, 5);
    const first = identity.touch('/entry');
    vi.setSystemTime(Date.now() + CMS_SESSION_IDLE_MS - 1);
    expect(new CmsIdentity(document, 5).touch('/other-tab').id).toBe(first.id);
    vi.setSystemTime(Date.now() + CMS_SESSION_IDLE_MS);
    expect(identity.touch('/renewed')).toMatchObject({ entryPath: '/renewed', isNewVisitor: false });
    expect(identity.touch('/renewed').id).not.toBe(first.id);
  });

  it('retains first entry UTM while page touches have their own source', async () => {
    history.replaceState({}, '', '/entry?utm_source=newsletter&utm_medium=email&utm_campaign=autumn');
    configure({ canonicalPath: '/entry' });
    const tracker = runAnalytics()!; await settled();
    history.replaceState({}, '', '/content?utm_source=partner');
    expect(getCmsAttributionContext()).toMatchObject({ entrySource: 'newsletter', utm: { source: 'newsletter', medium: 'email', campaign: 'autumn' } });
    tracker.track('cms.download_click'); await tracker.flush();
    expect(events('cms.download_click')[0]).toMatchObject({ utm: { source: 'partner' }, properties: { entrySource: 'newsletter' } });
  });
});

describe('CMS signed page lifecycle', () => {
  it('requires an explicit live signed page and never initializes preview identity', () => {
    expect(runAnalytics()).toBeUndefined();
    configure({ environment: 'preview' });
    expect(runAnalytics()).toBeUndefined();
    expect(localStorage.length).toBe(0); expect(request).not.toHaveBeenCalled();
  });

  it('sends one visible page view, uses the unified contract and ignores repeated bootstrap', async () => {
    configure(); const tracker = runAnalytics(); runAnalytics(); await settled();
    expect(events('cms.page_view')).toHaveLength(1);
    expect(cmsTelemetryBatchSchema.safeParse(delivered[0]).success).toBe(true);
    expect(request.mock.calls[0][0]).toBe('/api/public/cms/telemetry');
    expect(tracker?.status()).toMatchObject({ pending: 0 });
    expect(getCmsAttributionContext()).toMatchObject({ contextToken: 'signed-page-context', pageViewId: events('cms.page_view')[0].pageViewId });
  });

  it('defers background/prerender PV until visible', async () => {
    configure(); visible(false); runAnalytics(); await settled();
    expect(events('cms.page_view')).toHaveLength(0);
    visible(true); await settled();
    expect(events('cms.page_view')).toHaveLength(1);
  });

  it('BFCache restoration gets a new pageViewId within the same session', async () => {
    configure(); runAnalytics(); await settled();
    window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }));
    window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }));
    await settled();
    const views = events('cms.page_view');
    expect(views).toHaveLength(2); expect(views[0].pageViewId).not.toBe(views[1].pageViewId);
    expect(views[0].sessionId).toBe(views[1].sessionId);
  });

  it('counts visible active reading once and excludes background/idle elapsed time', async () => {
    configure(); const tracker = runAnalytics()!; await settled();
    await vi.advanceTimersByTimeAsync(10_000); await tracker.flush();
    expect(events('cms.read')).toHaveLength(1);
    visible(false); await vi.advanceTimersByTimeAsync(60_000);
    visible(true); await vi.advanceTimersByTimeAsync(5000); await tracker.flush();
    expect(events('cms.read')).toHaveLength(1);
    expect(Math.max(...events('cms.engagement').map((event) => event.properties.activeMs ?? 0))).toBeLessThanOrEqual(15_000);
    await vi.advanceTimersByTimeAsync(90_000); await tracker.flush();
    expect(Math.max(...events('cms.engagement').map((event) => event.properties.activeMs ?? 0))).toBe(40_000);
  });

  it('requires full depth on short content instead of labeling a partial viewport as read', async () => {
    document.body.innerHTML = '<article><div class="body">short story</div></article>';
    const rect = vi.fn(() => new DOMRect(0, 500, 600, 600));
    document.querySelector<HTMLElement>('.body')!.getBoundingClientRect = rect;
    configure(); const tracker = runAnalytics()!; await settled();
    await vi.advanceTimersByTimeAsync(15_000); await tracker.flush();
    expect(events('cms.read')).toHaveLength(0);
    rect.mockReturnValue(new DOMRect(0, 0, 600, 600)); document.dispatchEvent(new Event('scroll'));
    await vi.advanceTimersByTimeAsync(1000); await tracker.flush(); expect(events('cms.read')).toHaveLength(1);
  });

  it('opens a fresh page view and session after inactivity resumes in an existing tab', async () => {
    configure(); const tracker = runAnalytics()!; await settled();
    const original = events('cms.page_view')[0];
    vi.setSystemTime(Date.now() + CMS_SESSION_IDLE_MS);
    document.dispatchEvent(new KeyboardEvent('keydown')); await settled(); await tracker.flush();
    const next = events('cms.page_view').at(-1)!;
    expect(next.visitorId).toBe(original.visitorId); expect(next.sessionId).not.toBe(original.sessionId);
    expect(next.pageViewId).not.toBe(original.pageViewId);
  });
});

describe('CMS durable acknowledgement queue', () => {
  it('retries a network failure with the original stable event id', async () => {
    request.mockRejectedValueOnce(new Error('offline'));
    configure(); const tracker = runAnalytics()!; await settled();
    const firstBody = JSON.parse(String(request.mock.calls[0][1].body)) as Batch;
    expect(queued()).toHaveLength(1); expect(tracker.status().lastError).toBe('offline');
    await tracker.flush();
    expect(events('cms.page_view')[0].eventId).toBe(firstBody.events[0].eventId);
    expect(queued()).toHaveLength(0);
  });

  it('beacon keeps pending ids until an acknowledged retry', async () => {
    configure(); const tracker = runAnalytics()!; await settled();
    tracker.track('cms.download_click'); visible(false);
    expect(beacon).toHaveBeenCalled(); expect(queued().length).toBeGreaterThan(0);
    const ids = queued().map((key) => JSON.parse(localStorage.getItem(key)!).event.eventId);
    await tracker.flush();
    expect(allEvents().filter((event) => ids.includes(event.eventId))).toHaveLength(ids.length);
    expect(queued()).toHaveLength(0);
  });

  it('reports permanent rejection instead of retrying forever', async () => {
    request.mockResolvedValueOnce({ ok: false, status: 422 });
    configure(); const tracker = runAnalytics()!; await settled();
    expect(tracker.status()).toMatchObject({ pending: 0, rejected: 1, lastError: 'rejected_422' });
    await tracker.flush(); expect(request).toHaveBeenCalledTimes(1);
  });

  it('keeps unacknowledged events after a partial acknowledgement', async () => {
    configure(); const tracker = runAnalytics()!; await settled();
    tracker.track('cms.download_click'); tracker.track('cms.form_start', { formId: '5' });
    request.mockImplementationOnce(async (_url: string, init: RequestInit) => {
      const batch = JSON.parse(String(init.body)) as Batch;
      return { ok: true, status: 200, json: async () => ({ code: 0, data: { acceptedEventIds: [batch.events[0].eventId], rejectedEventIds: [], duplicates: 0 } }) };
    });
    await tracker.flush(); expect(queued()).toHaveLength(1); expect(tracker.status().lastError).toBe('partial_acknowledgement');
    await tracker.flush(); expect(events('cms.form_start')).toHaveLength(1); expect(queued()).toHaveLength(0);
  });

  it('caps offline storage by TTL and count, preserving full retryable events', async () => {
    Object.defineProperty(navigator, 'onLine', { configurable: true, value: false });
    configure(); const tracker = runAnalytics()!;
    for (let index = 0; index < 505; index += 1) tracker.track('cms.download_click');
    expect(queued()).toHaveLength(500); expect(tracker.status().expired).toBe(6);
    vi.setSystemTime(Date.now() + 25 * 60 * 60_000);
    tracker.track('cms.download_click'); expect(queued()).toHaveLength(1);
    await settled(); expect(request).not.toHaveBeenCalled();
  });
});

describe('CMS operational event semantics', () => {
  it('counts a component only after half its area is visible for a continuous second', async () => {
    let intersect: (entries: Partial<IntersectionObserverEntry>[]) => void = () => {};
    vi.stubGlobal('IntersectionObserver', class {
      constructor(callback: typeof intersect) { intersect = callback; }
      observe() {} unobserve() {} disconnect() {}
    });
    document.body.innerHTML = '<section data-cms-placement="home.main" data-cms-block-id="culture"><a href="/culture/">Culture</a></section>';
    configure(); const tracker = runAnalytics()!; await settled(); const target = document.querySelector('section')!;
    intersect([{ target, isIntersecting: true, intersectionRatio: 0.6 }]); await vi.advanceTimersByTimeAsync(500);
    intersect([{ target, isIntersecting: false, intersectionRatio: 0 }]); await vi.advanceTimersByTimeAsync(1000); await tracker.flush();
    expect(events('cms.component_impression')).toHaveLength(0);
    intersect([{ target, isIntersecting: true, intersectionRatio: 0.6 }]); await vi.advanceTimersByTimeAsync(1000); await tracker.flush();
    expect(events('cms.component_impression')).toHaveLength(1);
    expect(events('cms.component_impression')[0].properties).toMatchObject({ componentId: 'culture', componentSlot: 'home.main' });
  });

  it('keeps one search identity through result clicks and pagination without a second search demand', async () => {
    const searchId = '6cfb4a0a-3a26-4d84-aef0-44517f18eb11';
    history.replaceState({}, '', `/search?q=culture&cmsSearchId=${searchId}`);
    document.body.innerHTML = '<div data-cms-search-result="15" data-cms-search-position="1"><a href="/culture/a.html">Culture</a></div><nav class="pagination"><a href="/search?q=culture&page=2">Next</a></nav>';
    configure({ search: { keyword: 'culture', resultCount: 25, page: 1 }, contentId: undefined, canonicalPath: '/search', pageType: 'search' });
    const tracker = runAnalytics()!; await settled();
    expect(events('cms.search')).toHaveLength(1); expect(events('cms.search')[0].properties.searchId).toBe(searchId);
    expect(document.querySelector<HTMLAnchorElement>('.pagination a')!.href).toContain(`cmsSearchId=${searchId}`);
    document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settled(); await tracker.flush();
    expect(events('cms.search_click')[0].properties).toMatchObject({ searchId, targetContentId: 15, position: 1 });
    stopCmsAnalytics(); configure({ search: { keyword: 'culture', resultCount: 25, page: 2 }, contentId: undefined, canonicalPath: '/search', pageType: 'search' });
    runAnalytics(); await settled(); expect(events('cms.search')).toHaveLength(1);
  });

  it('propagates attribution and records form starts/errors without submitted field values', async () => {
    document.body.innerHTML = '<form data-cms-form-id="5" action="/api/public/cms/forms/contact"><input name="secret" value="never collect this"></form>';
    configure(); const tracker = runAnalytics()!; await settled();
    const input = document.querySelector('input')!; const form = document.querySelector('form')!;
    input.dispatchEvent(new FocusEvent('focusin', { bubbles: true })); input.dispatchEvent(new FocusEvent('focusin', { bubbles: true }));
    input.dispatchEvent(new Event('invalid')); form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settled(); await tracker.flush();
    expect(events('cms.form_start')).toHaveLength(1); expect(events('cms.form_error')).toHaveLength(1);
    expect(form.querySelector<HTMLInputElement>('input[name="_cmsAttribution"]')!.value).toContain('contextToken');
    expect(JSON.stringify(allEvents())).not.toContain('never collect this');
  });

  it('carries a search click to the matching content reading within the shared session', async () => {
    const searchId = '7ba7e19c-1465-4191-a9e4-9082c0d227ed';
    history.replaceState({}, '', `/search?q=culture&cmsSearchId=${searchId}`);
    document.body.innerHTML = '<a data-cms-search-result="15" data-cms-search-position="1" href="/culture/a.html">Culture</a>';
    configure({ search: { keyword: 'culture', resultCount: 1, page: 1 }, contentId: undefined, canonicalPath: '/search', pageType: 'search' });
    runAnalytics(); await settled(); document.querySelector('a')!.dispatchEvent(new MouseEvent('click', { bubbles: true })); await settled();
    stopCmsAnalytics(); document.body.innerHTML = ''; history.replaceState({}, '', '/culture/a.html');
    configure({ contentId: 15 }); const next = runAnalytics()!; await settled();
    await vi.advanceTimersByTimeAsync(10_000); await next.flush();
    expect(events('cms.read').at(-1)?.properties.searchId).toBe(searchId);
    stopCmsAnalytics(); configure({ contentId: 16 }); const unrelated = runAnalytics()!; await settled();
    await vi.advanceTimersByTimeAsync(10_000); await unrelated.flush();
    expect(events('cms.read').at(-1)?.properties.searchId).toBeUndefined();
  });

  it('attaches a signed, idempotent request context only to same-origin managed downloads', async () => {
    const fileId = '8123e19c-1465-4191-a9e4-9082c0d227ed';
    document.body.innerHTML = `<a download href="/api/files/${fileId}/content?download=1">Guide.pdf</a><a download href="https://other.test/api/files/${fileId}/content">External</a>`;
    configure(); const tracker = runAnalytics()!; await settled();
    const [managed, external] = [...document.querySelectorAll('a')];
    managed.dispatchEvent(new MouseEvent('click', { bubbles: true })); external.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await settled(); await tracker.flush();
    const target = new URL(managed.href);
    expect(target.pathname).toBe(`/api/files/${fileId}/content`); expect(target.searchParams.get('download')).toBe('1');
    expect(JSON.parse(target.searchParams.get('cmsTelemetry')!)).toMatchObject({ contextToken: 'signed-page-context', pageViewId: events('cms.page_view')[0].pageViewId, requestId: expect.stringMatching(/^[\da-f-]{36}$/) });
    expect(new URL(external.href).searchParams.has('cmsTelemetry')).toBe(false);
    expect(events('cms.download_click')).toHaveLength(2);
    expect(request.mock.calls.every(([url]) => url === '/api/public/cms/telemetry')).toBe(true);
  });

  it('carries the same attribution context through native guest comment submission', async () => {
    document.body.innerHTML = '<section data-island="comments"><form id="comment-form" action="/comments"><input name="contentId" value="9"><textarea name="content">Private comment text</textarea></form></section>';
    configure(); const tracker = runAnalytics()!; await settled();
    const form = document.querySelector('form')!; form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await settled(); await tracker.flush();
    expect(JSON.parse(form.querySelector<HTMLInputElement>('[name="_cmsAttribution"]')!.value)).toMatchObject({ contextToken: 'signed-page-context', sessionId: events('cms.page_view')[0].sessionId });
    expect(events('cms.form_start').at(-1)?.properties).toMatchObject({ targetId: 'comment:9' });
    expect(JSON.stringify(allEvents())).not.toContain('Private comment text');
  });

  it('emits real media progress with consumed duration', async () => {
    document.body.innerHTML = '<video data-cms-resource-id="6" data-cms-asset-version-id="11"></video>';
    const video = document.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    configure(); const tracker = runAnalytics()!; await settled(); video.dispatchEvent(new Event('playing'));
    for (const position of [5, 10, 15, 20]) {
      await vi.advanceTimersByTimeAsync(5000); video.currentTime = position; video.dispatchEvent(new Event('timeupdate'));
    }
    video.dispatchEvent(new Event('ended')); await settled(); await tracker.flush();
    expect(events('cms.media_start')).toHaveLength(1);
    expect(events('cms.media_progress').map((event) => event.properties.mediaProgress)).toEqual([25, 50, 75, 100]);
    expect(events('cms.media_progress').at(-1)?.properties).toMatchObject({ resourceId: 6, assetVersionId: 11, playedMs: 20_000 });
  });

  it('does not treat seeking to the end as media consumption', async () => {
    document.body.innerHTML = '<video></video>'; const video = document.querySelector('video')!;
    Object.defineProperty(video, 'duration', { configurable: true, value: 20 });
    Object.defineProperty(video, 'currentTime', { configurable: true, writable: true, value: 0 });
    configure(); const tracker = runAnalytics()!; await settled(); video.dispatchEvent(new Event('playing'));
    await vi.advanceTimersByTimeAsync(1000); video.currentTime = 19; video.dispatchEvent(new Event('seeking')); video.dispatchEvent(new Event('seeked'));
    await vi.advanceTimersByTimeAsync(1000); video.currentTime = 20; video.dispatchEvent(new Event('ended')); await settled(); await tracker.flush();
    expect(events('cms.media_start')).toHaveLength(1); expect(events('cms.media_progress')).toHaveLength(0);
  });
});
