import type { CmsTelemetryEvent } from '@arcbase/shared/cms';
import { analyticsRequestHeaders } from './http';
import { cmsLocalStorage, cmsStoragePrefix } from './cms-identity';

const QUEUE_TTL_MS = 24 * 60 * 60_000;
const MAX_QUEUE_SIZE = 500;
const MAX_BATCH_SIZE = 20;
const MAX_BATCH_BYTES = 48_000;
interface PendingEvent { contextToken: string; event: CmsTelemetryEvent; queuedAt: number }
export interface CmsDeliveryStatus { pending: number; rejected: number; expired: number; storageAvailable: boolean; lastError?: string; lastSuccessAt?: string }

/** Independent event keys avoid lost updates when several tabs enqueue/acknowledge concurrently. */
export class CmsTransport {
  private readonly storage?: Storage;
  private readonly prefix: string;
  private readonly memory = new Map<string, PendingEvent>();
  private readonly status: CmsDeliveryStatus;
  private flushing = false;
  private failures = 0;
  private retryAt = 0;

  constructor(private readonly win: Window, siteId: number, private readonly endpoint: string) {
    this.storage = cmsLocalStorage(win);
    this.prefix = `${cmsStoragePrefix(siteId)}event:`;
    this.status = { pending: 0, rejected: 0, expired: 0, storageAvailable: Boolean(this.storage) };
  }

  enqueue(contextToken: string, event: CmsTelemetryEvent): void {
    const pending = { contextToken, event, queuedAt: Date.now() };
    this.memory.set(event.eventId, pending);
    try { this.storage?.setItem(`${this.prefix}${event.eventId}`, JSON.stringify(pending)); }
    catch { this.status.storageAvailable = false; this.status.lastError = 'storage_unavailable'; }
    this.readQueue();
  }

  getStatus(): CmsDeliveryStatus { return { ...this.status }; }

  private notify(): void {
    // A bounded, observable diagnostic channel; failure must not break the host page.
    this.win.document.dispatchEvent(new CustomEvent('cms:telemetry-status', { detail: this.getStatus() }));
  }

  private remove(id: string): void {
    this.memory.delete(id);
    try { this.storage?.removeItem(`${this.prefix}${id}`); } catch { this.status.storageAvailable = false; }
  }

  private readQueue(): PendingEvent[] {
    try {
      const keys = this.storage ? Array.from({ length: this.storage.length }, (_, index) => this.storage!.key(index)).filter((key): key is string => Boolean(key?.startsWith(this.prefix))) : [];
      for (const key of keys) {
        try {
          const value = JSON.parse(this.storage!.getItem(key) || 'null') as PendingEvent | null;
          if (value?.event?.eventId && typeof value.contextToken === 'string' && Number.isFinite(value.queuedAt)) this.memory.set(value.event.eventId, value);
          else this.storage!.removeItem(key);
        } catch { this.storage!.removeItem(key); }
      }
    } catch { this.status.storageAvailable = false; }
    const sorted = [...this.memory.values()].sort((a, b) => a.queuedAt - b.queuedAt);
    const fresh = sorted.filter((item) => {
      if (Date.now() - item.queuedAt <= QUEUE_TTL_MS && item.queuedAt <= Date.now() + 60_000) return true;
      this.remove(item.event.eventId); this.status.expired += 1; return false;
    });
    while (fresh.length > MAX_QUEUE_SIZE) { this.remove(fresh.shift()!.event.eventId); this.status.expired += 1; }
    this.status.pending = fresh.length;
    return fresh;
  }

  private batches(): { contextToken: string; events: CmsTelemetryEvent[] }[] {
    const groups = new Map<string, CmsTelemetryEvent[]>();
    for (const item of this.readQueue()) {
      const events = groups.get(item.contextToken) ?? [];
      events.push(item.event); groups.set(item.contextToken, events);
    }
    const batches: { contextToken: string; events: CmsTelemetryEvent[] }[] = [];
    for (const [contextToken, events] of groups) {
      let batch = { contextToken, events: [] as CmsTelemetryEvent[] };
      for (const event of events) {
        if (batch.events.length && (batch.events.length >= MAX_BATCH_SIZE || new TextEncoder().encode(JSON.stringify({ contextToken, events: [...batch.events, event] })).length > MAX_BATCH_BYTES)) {
          batches.push(batch); batch = { contextToken, events: [] };
        }
        batch.events.push(event);
      }
      if (batch.events.length) batches.push(batch);
    }
    return batches;
  }

  async flush(force = false): Promise<void> {
    if (this.flushing || (!force && Date.now() < this.retryAt) || this.win.navigator.onLine === false) return;
    this.flushing = true;
    try {
      // Re-read for the next pass: other tabs may have acknowledged the same ids meanwhile.
      for (const batch of this.batches()) {
        const response = await fetch(this.endpoint, {
          method: 'POST', headers: analyticsRequestHeaders({ token: null }),
          body: JSON.stringify(batch), credentials: 'same-origin', keepalive: true,
        });
        if ([400, 401, 403, 404, 413, 422].includes(response.status)) {
          for (const event of batch.events) this.remove(event.eventId);
          this.status.rejected += batch.events.length;
          this.status.lastError = `rejected_${response.status}`;
          this.notify();
          continue;
        }
        if (!response.ok) throw new Error(`http_${response.status}`);
        const result = await response.json() as { code: number; data?: { acceptedEventIds: string[]; rejectedEventIds: string[]; reason?: string } };
        if (result.code !== 0 || !Array.isArray(result.data?.acceptedEventIds) || !Array.isArray(result.data?.rejectedEventIds)) throw new Error('invalid_acknowledgement');
        const acknowledged = new Set([...result.data.acceptedEventIds, ...result.data.rejectedEventIds]);
        for (const event of batch.events) if (acknowledged.has(event.eventId)) this.remove(event.eventId);
        this.status.rejected += result.data.rejectedEventIds.length;
        this.status.lastSuccessAt = new Date().toISOString();
        this.status.lastError = result.data.reason;
        if (batch.events.some((event) => !acknowledged.has(event.eventId))) throw new Error('partial_acknowledgement');
      }
      this.failures = 0; this.retryAt = 0;
    } catch (error) {
      this.failures += 1;
      this.retryAt = Date.now() + Math.min(60_000, 1000 * 2 ** Math.min(this.failures, 6));
      this.status.lastError = error instanceof Error ? error.message : 'network_error';
    } finally {
      this.flushing = false; this.readQueue(); this.notify();
    }
  }

  flushOnHide(): void {
    // Beacon has no acknowledgement. Keep every id in the outbox for an idempotent retry.
    const batch = this.batches()[0];
    if (!batch) return;
    try {
      if (this.win.navigator.sendBeacon?.(this.endpoint, new Blob([JSON.stringify(batch)], { type: 'application/json' }))) return;
    } catch { this.status.lastError = 'beacon_failed'; }
    void this.flush(true);
  }
}
