import { randomUUID } from '@arcbase/shared/core';
import type { CmsAttributionContext, CmsTelemetryConfig, CmsTelemetryEvent } from '@arcbase/shared/cms';
import { CMS_SESSION_IDLE_MS, CmsIdentity, cmsReferrer, cmsStoragePrefix, isCmsUuid, readCmsUtm, type CmsSession } from './cms-identity';
import { CmsTransport, type CmsDeliveryStatus } from './cms-transport';
import { CmsDomTracker } from './cms-tracker-dom';

const ACTIVE_IDLE_MS = 30_000;
const HEARTBEAT_MS = 15_000;
export type CmsTrackerConfig = CmsTelemetryConfig;
export interface CmsTrackerOptions {
  document: Document;
  contextToken: string;
  config: CmsTrackerConfig;
  endpoint?: string;
}

/** CMS adapter shares SDK HTTP conventions, with its own signed context and durable event outbox. */
export class CmsTracker {
  private readonly doc: Document;
  private readonly win: Window;
  private readonly config: CmsTrackerConfig;
  private identity?: CmsIdentity;
  private readonly transport: CmsTransport;
  private readonly controller = new AbortController();
  private dom?: CmsDomTracker;
  private session?: CmsSession;
  private pageViewId?: string;
  private searchId?: string;
  private activeMs = 0;
  private scrollDepth = 0;
  private read = false;
  private lastActivityAt = Date.now();
  private sampledAt = Date.now();
  private heartbeatAt = Date.now();
  private reportedActiveMs = -1;
  private reportedScrollDepth = -1;
  private timer?: ReturnType<typeof setInterval>;
  private disposed = false;
  private visible = false;
  private readThreshold = 50;
  private starting = false;

  constructor(private readonly options: CmsTrackerOptions) {
    this.doc = options.document;
    this.win = this.doc.defaultView!;
    this.config = options.config;
    this.transport = new CmsTransport(this.win, this.config.siteId, options.endpoint ?? '/api/public/cms/telemetry');
  }

  start(): void {
    if (this.config.environment !== 'live' || !this.options.contextToken || this.timer || this.disposed) return;
    const signal = this.controller.signal;
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') { this.sample(); this.visible = false; this.engagement('hidden'); this.transport.flushOnHide(); }
      else { this.visible = true; this.sampledAt = Date.now(); this.activity(); if (!this.pageViewId) this.startPage(); void this.transport.flush(true); }
    }, { signal });
    for (const name of ['pointerdown', 'keydown', 'touchstart', 'scroll'] as const) {
      this.doc.addEventListener(name, () => this.activity(), { passive: true, signal });
    }
    this.win.addEventListener('pagehide', () => { this.sample(); this.engagement('pagehide'); this.transport.flushOnHide(); }, { signal });
    this.win.addEventListener('pageshow', (event) => {
      if (event.persisted) { this.pageViewId = undefined; this.startPage(); }
    }, { signal });
    this.win.addEventListener('online', () => { void this.transport.flush(true); }, { signal });
    this.timer = setInterval(() => this.tick(), 1000);
    if (this.doc.visibilityState !== 'hidden') this.startPage();
    void this.transport.flush(true);
  }

  private path(): string { return (this.config.canonicalPath || this.doc.location.pathname).slice(0, 500); }

  private startPage(): void {
    if (this.config.environment !== 'live' || this.doc.visibilityState === 'hidden' || this.disposed) return;
    // Web Locks prevents simultaneous first tabs from racing the localStorage identity/session write.
    if (!this.identity && this.win.navigator.locks) {
      if (this.starting) return;
      this.starting = true;
      void this.win.navigator.locks.request(`${cmsStoragePrefix(this.config.siteId)}identity`, () => {
        if (this.disposed) return;
        this.identity = new CmsIdentity(this.doc, this.config.siteId); this.startPage();
      }).catch(() => {
        if (this.disposed) return;
        this.identity = new CmsIdentity(this.doc, this.config.siteId); this.startPage();
      }).finally(() => { this.starting = false; });
      return;
    }
    this.identity ??= new CmsIdentity(this.doc, this.config.siteId);
    this.session = this.identity!.touch(this.path(), this.config.contentId ?? undefined);
    this.pageViewId = randomUUID();
    this.visible = true;
    this.activeMs = 0; this.scrollDepth = 0; this.read = false;
    this.sampledAt = Date.now(); this.lastActivityAt = Date.now(); this.heartbeatAt = Date.now();
    this.reportedActiveMs = -1; this.reportedScrollDepth = -1;
    this.measureDepth();
    this.track('cms.page_view');
    this.setupSearch();
    this.dom?.dispose(); this.dom = new CmsDomTracker(this.doc, this);
    this.dom.mount();
    void this.transport.flush();
  }

  activity(): void {
    if (this.doc.visibilityState === 'hidden' || this.disposed || this.config.environment !== 'live' || !this.identity) return;
    this.sample();
    const next = this.identity.touch(this.path(), this.config.contentId ?? undefined);
    if (this.session && this.session.id !== next.id) {
      this.engagement('session_timeout'); this.session = next; this.startPage();
    } else this.session = next;
    this.lastActivityAt = Date.now();
    this.measureDepth();
  }

  private sample(): void {
    const now = Date.now();
    // Cap by last human activity, not by the heartbeat itself. Background and idle time do not count.
    if (this.pageViewId && this.visible) {
      this.activeMs = Math.min(86_400_000, this.activeMs + Math.max(0, Math.min(now, this.lastActivityAt + ACTIVE_IDLE_MS) - this.sampledAt));
    }
    this.sampledAt = now;
  }

  private measureDepth(): void {
    const article = this.doc.querySelector<HTMLElement>('[data-cms-reading]')
      ?? this.doc.querySelector<HTMLElement>('article .body, .article-body')
      ?? this.doc.querySelector<HTMLElement>('article');
    let depth: number;
    if (article && article.getBoundingClientRect().height > 0) {
      const rect = article.getBoundingClientRect();
      this.readThreshold = rect.height <= this.win.innerHeight ? 100 : 50;
      depth = (this.win.innerHeight - rect.top) / rect.height * 100;
    } else {
      const root = this.doc.documentElement;
      depth = root.scrollHeight <= this.win.innerHeight ? 100 : (this.win.scrollY + this.win.innerHeight) / root.scrollHeight * 100;
    }
    this.scrollDepth = Math.max(this.scrollDepth, Math.min(100, Math.max(0, Math.round(depth))));
  }

  private tick(): void {
    if (this.doc.visibilityState === 'hidden' || !this.pageViewId) return;
    this.sample(); this.measureDepth();
    if (Date.now() - this.lastActivityAt < ACTIVE_IDLE_MS) this.session = this.identity!.touch(this.path(), this.config.contentId ?? undefined);
    if (!this.read && this.config.contentId && this.activeMs >= 10_000 && this.scrollDepth >= this.readThreshold) {
      this.read = true; this.track('cms.read', { activeMs: Math.round(this.activeMs), scrollDepth: this.scrollDepth });
    }
    if (Date.now() - this.heartbeatAt >= HEARTBEAT_MS) {
      this.engagement('heartbeat'); this.heartbeatAt = Date.now(); void this.transport.flush();
    }
  }

  private engagement(reason: string): void {
    if (!this.pageViewId) return;
    if (reason === 'heartbeat' && this.reportedActiveMs === this.activeMs && this.reportedScrollDepth === this.scrollDepth) return;
    this.track('cms.engagement', { activeMs: Math.round(this.activeMs), scrollDepth: this.scrollDepth });
    this.reportedActiveMs = this.activeMs; this.reportedScrollDepth = this.scrollDepth;
  }

  private setupSearch(): void {
    const search = this.config.search;
    if (!search?.keyword) return;
    const queryId = new URL(this.doc.location.href).searchParams.get('cmsSearchId');
    this.searchId = isCmsUuid(search.searchId) ? search.searchId : isCmsUuid(queryId) ? queryId : randomUUID();
    // Every results page keeps its query identity; pagination does not become a new search demand.
    const current = new URL(this.doc.location.href);
    current.searchParams.set('cmsSearchId', this.searchId);
    try { this.win.history.replaceState(this.win.history.state, '', current.href); } catch { /* Embedded sandbox. */ }
    for (const link of this.doc.querySelectorAll<HTMLAnchorElement>('.pagination a')) {
      const url = new URL(link.href, current.href); url.searchParams.set('cmsSearchId', this.searchId); link.href = url.href;
    }
    if (search.page > 1) return;
    const marker = `${cmsStoragePrefix(this.config.siteId)}search:${this.searchId}`;
    let recorded = false;
    try { recorded = Boolean(this.win.sessionStorage.getItem(marker)); } catch { /* Per-view fallback. */ }
    if (!recorded) {
      this.track('cms.search', { searchId: this.searchId, keyword: search.keyword, resultCount: search.resultCount });
      try { this.win.sessionStorage.setItem(marker, String(Date.now())); } catch { /* Stable event id still makes network retries idempotent. */ }
    }
  }

  getSearchContext(): { searchId: string; keyword: string; resultCount: number } | undefined {
    return this.searchId && this.config.search ? { searchId: this.searchId, keyword: this.config.search.keyword, resultCount: this.config.search.resultCount } : undefined;
  }

  recordSearchClick(searchId: string, targetContentId: number): void {
    if (this.identity) this.session = this.identity.noteSearchClick(this.path(), searchId, targetContentId);
  }

  track(name: CmsTelemetryEvent['name'], properties: CmsTelemetryEvent['properties'] = {}): void {
    if (!this.pageViewId || !this.session || !this.identity || this.disposed || this.config.environment !== 'live') return;
    const searchTouch = this.config.contentId ? this.session.searchTouches?.[String(this.config.contentId)] : undefined;
    const event: CmsTelemetryEvent = {
      eventId: randomUUID(), name, occurredAt: new Date().toISOString(),
      visitorId: this.identity.visitorId, sessionId: this.session.id, pageViewId: this.pageViewId,
      referrer: cmsReferrer(this.doc), utm: readCmsUtm(this.doc.location.href),
      screenW: Math.max(0, Math.min(20000, this.win.screen.width)), screenH: Math.max(0, Math.min(20000, this.win.screen.height)),
      language: this.win.navigator.language.slice(0, 16),
      properties: {
        entryPath: this.session.entryPath, entrySource: this.session.entrySource,
        isNewVisitor: this.session.isNewVisitor, entryUtm: this.session.entryUtm,
        lastContentId: this.session.lastContentId, lastContentAt: this.session.lastContentAt,
        ...(searchTouch && Date.now() - searchTouch.clickedAt < CMS_SESSION_IDLE_MS ? { searchId: searchTouch.searchId } : {}),
        ...properties,
      },
    };
    this.transport.enqueue(this.options.contextToken, event);
  }

  getAttributionContext(): CmsAttributionContext | undefined {
    if (this.config.environment !== 'live') return undefined;
    this.activity();
    if (!this.session || !this.pageViewId || !this.identity) return undefined;
    return {
      contextToken: this.options.contextToken, visitorId: this.identity.visitorId,
      sessionId: this.session.id, pageViewId: this.pageViewId,
      entryPath: this.session.entryPath, entrySource: this.session.entrySource,
      lastContentId: this.session.lastContentId, lastContentAt: this.session.lastContentAt,
      utm: this.session.entryUtm,
    };
  }

  flush(): Promise<void> { return this.transport.flush(true); }
  status(): CmsDeliveryStatus { return this.transport.getStatus(); }
  dispose(): void {
    if (this.disposed) return;
    this.sample(); this.engagement('dispose');
    this.disposed = true; this.controller.abort(); this.dom?.dispose();
    if (this.timer) clearInterval(this.timer);
  }
}
