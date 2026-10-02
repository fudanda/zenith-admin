import { randomUUID } from '@arcbase/shared/core';
import type { CmsTelemetryEvent } from '@arcbase/shared/cms';
import type { CmsTracker } from './cms-tracker';

type Properties = CmsTelemetryEvent['properties'];
function id(value: string | undefined): number | undefined { const parsed = Number(value); return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined; }
function path(link: HTMLAnchorElement): string { try { return new URL(link.href).pathname.slice(0, 500); } catch { return ''; } }
function text(value: string | null | undefined): string | undefined { return value?.trim().replace(/\s+/g, ' ').slice(0, 255) || undefined; }

/** DOM hooks stay in the SDK adapter so every built-in theme shares the same definitions. */
export class CmsDomTracker {
  private readonly controller = new AbortController();
  private readonly formStarts = new WeakSet<HTMLFormElement>();
  private readonly validationAt = new WeakMap<HTMLFormElement, number>();
  private readonly observed = new WeakSet<Element>();
  private readonly impressions = new WeakSet<Element>();
  private readonly impressionTimers = new Map<Element, ReturnType<typeof setTimeout>>();
  private readonly media = new WeakSet<HTMLMediaElement>();
  private observer?: IntersectionObserver;
  private mutation?: MutationObserver;

  constructor(private readonly doc: Document, private readonly tracker: CmsTracker) {}

  mount(): void {
    const signal = this.controller.signal;
    this.doc.addEventListener('click', (event) => this.click(event), { capture: true, signal });
    this.doc.addEventListener('focusin', (event) => {
      const form = event.target instanceof Element ? event.target.closest('form') : null;
      if (!form || !this.isBusinessForm(form) || this.formStarts.has(form)) return;
      this.formStarts.add(form); this.tracker.activity(); this.tracker.track('cms.form_start', this.formProperties(form));
    }, { signal });
    this.doc.addEventListener('invalid', (event) => {
      const form = event.target instanceof Element ? event.target.closest('form') : null;
      if (!form || !this.isBusinessForm(form) || Date.now() - (this.validationAt.get(form) ?? 0) < 100) return;
      this.validationAt.set(form, Date.now());
      this.tracker.track('cms.form_error', { ...this.formProperties(form), failureCode: 'validation' });
    }, { capture: true, signal });
    this.doc.addEventListener('submit', (event) => this.submit(event), { capture: true, signal });
    this.doc.addEventListener('visibilitychange', () => {
      if (this.doc.visibilityState === 'hidden') this.clearImpressionTimers();
      else if (this.observer) {
        for (const element of this.doc.querySelectorAll('[data-cms-placement], [data-cms-block-id]')) {
          if (!this.impressions.has(element)) { this.observer.unobserve(element); this.observer.observe(element); }
        }
      }
    }, { signal });
    if (typeof IntersectionObserver !== 'undefined') {
      this.observer = new IntersectionObserver((entries) => {
        for (const entry of entries) {
          if (this.impressions.has(entry.target)) continue;
          const previous = this.impressionTimers.get(entry.target);
          const rect = entry.boundingClientRect;
          // Long sections may be taller than the viewport: measure half their viewable area.
          const viewableArea = rect?.width && rect.height
            ? Math.min(rect.width, this.doc.defaultView!.innerWidth) * Math.min(rect.height, this.doc.defaultView!.innerHeight) / (rect.width * rect.height)
            : 1;
          if (entry.intersectionRatio < viewableArea * 0.5 || !entry.isIntersecting || this.doc.visibilityState === 'hidden') {
            if (previous) clearTimeout(previous); this.impressionTimers.delete(entry.target); continue;
          }
          if (previous) continue;
          this.impressionTimers.set(entry.target, setTimeout(() => {
            this.impressionTimers.delete(entry.target);
            if (this.doc.visibilityState === 'hidden' || !entry.target.isConnected) return;
            this.impressions.add(entry.target);
            this.tracker.track('cms.component_impression', this.componentProperties(entry.target as HTMLElement));
          }, 1000));
        }
      }, { threshold: Array.from({ length: 101 }, (_, index) => index / 100) });
    }
    this.scan();
    // Surveys and dynamically inserted blocks must use the same lifecycle as initial markup.
    this.mutation = new MutationObserver(() => this.scan());
    this.mutation.observe(this.doc.body, { childList: true, subtree: true });
  }

  private scan(): void {
    for (const element of this.doc.querySelectorAll('[data-cms-placement], [data-cms-block-id]')) {
      if (!this.observed.has(element)) { this.observed.add(element); this.observer?.observe(element); }
    }
    for (const element of this.doc.querySelectorAll<HTMLMediaElement>('video, audio')) {
      if (!this.media.has(element)) { this.media.add(element); this.mountMedia(element); }
    }
  }

  private componentProperties(element: HTMLElement): Properties {
    return {
      componentId: (element.dataset.cmsBlockId || element.dataset.cmsPlacement || 'unknown').slice(0, 128),
      componentSlot: (element.dataset.cmsPlacement || element.closest<HTMLElement>('[data-cms-placement]')?.dataset.cmsPlacement)?.slice(0, 64),
      componentName: text(element.dataset.cmsComponentName || element.dataset.cmsBlockTitle || element.querySelector('h1,h2,h3')?.textContent),
    };
  }

  private formProperties(form: HTMLFormElement): Properties {
    const survey = form.closest<HTMLElement>('[data-island="survey"]');
    if (form.id === 'comment-form' && form.closest('[data-island="comments"]')) {
      const contentId = id(form.querySelector<HTMLInputElement>('[name="contentId"]')?.value);
      return { targetId: contentId ? `comment:${contentId}` : 'comment', targetName: '内容评论' };
    }
    const interactionId = id(form.dataset.cmsInteractionId);
    if (interactionId) return { interactionId, interactionName: text(form.dataset.cmsInteractionName), targetId: `interaction:${interactionId}` };
    return {
      formId: (form.dataset.cmsFormId || form.id || new URL(form.action, this.doc.location.href).pathname).slice(0, 128),
      formName: text(form.dataset.cmsFormName),
      targetId: (form.dataset.cmsTargetId || (form.dataset.cmsFormId ? `form:${form.dataset.cmsFormId}` : survey?.dataset.code))?.slice(0, 128),
    };
  }

  private isBusinessForm(form: HTMLFormElement): boolean {
    return Boolean(form.dataset.cmsFormId || form.action.includes('/api/public/cms/forms/') || form.closest('[data-island="survey"], [data-island="comments"]'));
  }

  private submit(event: Event): void {
    if (!(event.target instanceof HTMLFormElement)) return;
    const form = event.target;
    // Carry one query id from submission through results and pagination; never collect field values.
    if (form.querySelector('input[type="search"]') && new URL(form.action, this.doc.location.href).pathname.endsWith('/search')) {
      let input = form.querySelector<HTMLInputElement>('input[name="cmsSearchId"]');
      if (!input) { input = this.doc.createElement('input'); input.type = 'hidden'; input.name = 'cmsSearchId'; form.append(input); }
      input.value = randomUUID();
      return;
    }
    if (!this.isBusinessForm(form)) return;
    if (!this.formStarts.has(form)) { this.formStarts.add(form); this.tracker.track('cms.form_start', this.formProperties(form)); }
    const context = this.tracker.getAttributionContext();
    if (!context || (!form.action.includes('/api/public/cms/forms/') && !form.closest('[data-island="comments"]'))) return;
    let input = form.querySelector<HTMLInputElement>('input[name="_cmsAttribution"]');
    if (!input) { input = this.doc.createElement('input'); input.type = 'hidden'; input.name = '_cmsAttribution'; form.append(input); }
    input.value = JSON.stringify(context);
    void this.tracker.flush();
  }

  private click(event: MouseEvent): void {
    if (!(event.target instanceof Element)) return;
    const link = event.target.closest<HTMLAnchorElement>('a[href]');
    if (!link) return;
    this.tracker.activity();
    const result = link.closest<HTMLElement>('[data-cms-search-result]');
    const search = this.tracker.getSearchContext();
    if (result && search) {
      const targetContentId = id(result.dataset.cmsSearchResult || link.dataset.cmsContentId);
      if (targetContentId) this.tracker.recordSearchClick(search.searchId, targetContentId);
      this.tracker.track('cms.search_click', { ...search,
        targetContentId,
        position: id(result.dataset.cmsSearchPosition || result.closest<HTMLElement>('[data-cms-search-position]')?.dataset.cmsSearchPosition), targetPath: path(link), targetName: text(link.dataset.cmsContentTitle || link.textContent),
      });
    }
    const component = link.closest<HTMLElement>('[data-cms-placement], [data-cms-block-id]');
    if (component) this.tracker.track('cms.component_click', { ...this.componentProperties(component), targetPath: path(link), targetContentId: id(link.dataset.cmsContentId), targetName: text(link.dataset.cmsContentTitle || link.textContent) });
    const isDownload = link.hasAttribute('download') || Boolean(link.closest('.attachments,.model-display-download'));
    if (isDownload) {
      this.tracker.track('cms.download_click', { targetPath: path(link), resourceId: id(link.dataset.cmsResourceId), assetVersionId: id(link.dataset.cmsAssetVersionId), resourceName: text(link.dataset.cmsResourceName || link.textContent) });
      const url = new URL(link.href, this.doc.location.href);
      if (url.origin === this.doc.location.origin && /^\/api\/files\/[\da-f-]{36}\/content$/i.test(url.pathname)) {
        const context = this.tracker.getAttributionContext();
        if (context) {
          url.searchParams.set('cmsTelemetry', JSON.stringify({ ...context, requestId: randomUUID() }));
          link.href = url.href;
        }
      }
    }
    // Send while the document is alive; pagehide's beacon is only a fallback.
    if (result || component || isDownload) void this.tracker.flush();
  }

  private mountMedia(element: HTMLMediaElement): void {
    const signal = this.controller.signal;
    let started = false;
    let playedMs = 0;
    let playedSeconds = 0;
    let lastWall = Date.now();
    let lastPosition = element.currentTime;
    const thresholds = new Set<number>();
    const properties = (): Properties => ({
      resourceId: id(element.dataset.cmsResourceId), assetVersionId: id(element.dataset.cmsAssetVersionId),
      resourceName: text(element.dataset.cmsResourceName || element.title || element.getAttribute('aria-label')),
      mediaDuration: Number.isFinite(element.duration) ? Math.min(86_400, element.duration) : undefined,
      playedMs: Math.min(86_400_000, Math.round(playedMs)),
    });
    const sample = () => {
      const now = Date.now();
      const delta = element.currentTime - lastPosition;
      const wallSeconds = Math.max(0, (now - lastWall) / 1000);
      // Seeking and stalls are not consumed media. Rates above 1x still finish at 100%.
      if (started && !element.seeking && delta > 0 && delta <= wallSeconds * Math.max(1, element.playbackRate) + 0.5) {
        playedSeconds += delta;
        playedMs += Math.min(wallSeconds, delta / Math.max(0.1, element.playbackRate)) * 1000;
        if (this.doc.visibilityState !== 'hidden') this.tracker.activity();
      }
      lastWall = now; lastPosition = element.currentTime;
      if (!Number.isFinite(element.duration) || element.duration <= 0) return;
      for (const progress of [25, 50, 75, 100]) {
        if (!thresholds.has(progress) && playedSeconds + 0.1 >= element.duration * progress / 100) {
          thresholds.add(progress); this.tracker.track('cms.media_progress', { ...properties(), mediaProgress: progress });
        }
      }
    };
    const playing = () => {
      lastWall = Date.now(); lastPosition = element.currentTime;
      if (!started) { started = true; this.tracker.activity(); this.tracker.track('cms.media_start', properties()); }
    };
    element.addEventListener('playing', playing, { signal });
    element.addEventListener('timeupdate', sample, { signal });
    element.addEventListener('ended', () => { sample(); void this.tracker.flush(); }, { signal });
    element.addEventListener('pause', sample, { signal });
    element.addEventListener('seeking', () => { lastPosition = element.currentTime; lastWall = Date.now(); }, { signal });
    element.addEventListener('seeked', () => { lastPosition = element.currentTime; lastWall = Date.now(); }, { signal });
    element.addEventListener('error', () => {
      this.tracker.track('cms.media_error', { ...properties(), failureCode: String(element.error?.code ?? 'unknown') });
      void this.tracker.flush();
    }, { signal });
    if (!element.paused && element.readyState >= 2) playing();
  }

  private clearImpressionTimers(): void { for (const timer of this.impressionTimers.values()) clearTimeout(timer); this.impressionTimers.clear(); }
  dispose(): void { this.controller.abort(); this.clearImpressionTimers(); this.observer?.disconnect(); this.mutation?.disconnect(); }
}
