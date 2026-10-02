import { randomUUID } from '@arcbase/shared/core';

export const CMS_SESSION_IDLE_MS = 30 * 60_000;
const UUID = /^[\da-f]{8}-[\da-f]{4}-[\da-f]{4}-[\da-f]{4}-[\da-f]{12}$/i;
export function isCmsUuid(value: unknown): value is string { return typeof value === 'string' && UUID.test(value); }

export type CmsUtm = Partial<Record<'source' | 'medium' | 'campaign' | 'term' | 'content', string>>;
export interface CmsSession {
  id: string;
  lastActivityAt: number;
  entryPath: string;
  entrySource: string;
  entryUtm: CmsUtm;
  isNewVisitor: boolean;
  lastContentId?: number;
  lastContentAt?: string;
  searchTouches?: Record<string, { searchId: string; clickedAt: number }>;
}

/** Every storage key is scoped to the rendered site, including same-origin preview hosts. */
export function cmsStoragePrefix(siteId: number): string { return `arcbase:cms:${siteId}:`; }
export function cmsLocalStorage(win: Window): Storage | undefined {
  try { return win.localStorage; } catch { return undefined; }
}

export function readCmsUtm(href: string): CmsUtm {
  const query = new URL(href).searchParams;
  return Object.fromEntries((['source', 'medium', 'campaign', 'term', 'content'] as const)
    .flatMap((name) => { const value = query.get(`utm_${name}`)?.trim().slice(0, 128); return value ? [[name, value]] : []; }));
}

export function cmsReferrer(doc: Document): string | undefined {
  try { const url = new URL(doc.referrer); return `${url.origin}${url.pathname}`.slice(0, 1000); } catch { return undefined; }
}

export class CmsIdentity {
  readonly visitorId: string;
  private session?: CmsSession;
  private readonly prefix: string;
  private readonly storage?: Storage;
  private readonly newVisitor: boolean;
  private visitorClaimed = false;

  constructor(private readonly doc: Document, siteId: number) {
    this.prefix = cmsStoragePrefix(siteId);
    this.storage = cmsLocalStorage(doc.defaultView!);
    let existing: string | null = null;
    try { existing = this.storage?.getItem(`${this.prefix}visitor`) ?? null; } catch { /* In-memory identity remains usable. */ }
    this.newVisitor = !isCmsUuid(existing);
    this.visitorId = isCmsUuid(existing) ? existing : randomUUID();
    try { this.storage?.setItem(`${this.prefix}visitor`, this.visitorId); } catch { /* Storage may be disabled or full. */ }
  }

  /** Reread shared storage on every activity so all tabs use the same inactivity window. */
  touch(path: string, contentId?: number): CmsSession {
    const now = Date.now();
    try {
      const saved = JSON.parse(this.storage?.getItem(`${this.prefix}session`) || 'null') as CmsSession | null;
      if (saved && isCmsUuid(saved.id) && Number.isFinite(saved.lastActivityAt)) this.session = saved;
    } catch { /* Preserve the current in-memory session when storage is unavailable. */ }
    if (!this.session || now - this.session.lastActivityAt >= CMS_SESSION_IDLE_MS || this.session.lastActivityAt > now + 60_000) {
      const utm = readCmsUtm(this.doc.location.href);
      const referrer = cmsReferrer(this.doc);
      const host = referrer ? new URL(referrer).host : '';
      this.session = {
        id: randomUUID(), lastActivityAt: now, entryPath: path.slice(0, 500),
        entrySource: (utm.source || (host && host !== this.doc.location.host ? host : 'direct')).slice(0, 128),
        entryUtm: utm, isNewVisitor: this.newVisitor && !this.visitorClaimed,
      };
    }
    this.session.lastActivityAt = now;
    this.visitorClaimed = true;
    if (contentId) { this.session.lastContentId = contentId; this.session.lastContentAt = new Date(now).toISOString(); }
    try { this.storage?.setItem(`${this.prefix}session`, JSON.stringify(this.session)); } catch { /* In-memory fallback. */ }
    return { ...this.session };
  }

  noteSearchClick(path: string, searchId: string, targetContentId: number): CmsSession {
    this.touch(path);
    const session = this.session!;
    const touches = Object.entries(session.searchTouches ?? {}).filter(([, touch]) =>
      isCmsUuid(touch.searchId) && Date.now() - touch.clickedAt < CMS_SESSION_IDLE_MS);
    touches.push([String(targetContentId), { searchId, clickedAt: Date.now() }]);
    session.searchTouches = Object.fromEntries(touches.slice(-20));
    try { this.storage?.setItem(`${this.prefix}session`, JSON.stringify(session)); } catch { /* Same-tab attribution still works. */ }
    return { ...session };
  }
}
