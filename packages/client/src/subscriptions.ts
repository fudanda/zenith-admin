import { integrationContract } from '@zenith/shared/integrations';
import { operationURL } from './contracts';
import { ClientError } from './errors';
import type { Client } from './client';

export interface ChangeEvent { resources: string[]; cursor: string; requery: boolean }
export interface SubscriptionOptions {
  signal?: AbortSignal;
  onChange: (event: ChangeEvent) => void;
  onError?: (error: unknown) => void;
  onUnauthorized?: () => void;
  /** Bounded reconnect delay, in milliseconds. */
  reconnectDelay?: number;
}
export interface Subscription { close(): void; done: Promise<void> }

/** Fetch-based SSE works with both Cookie and restricted API Key clients.
 * Cursor stays in memory; ready/reconnect always requests an authorized requery. */
export function subscribe(client: Client, options: SubscriptionOptions): Subscription {
  const controller = new AbortController();
  let activeReader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  const close = () => { controller.abort(); void activeReader?.cancel().catch(() => {}); };
  options.signal?.addEventListener('abort', close, { once: true });
  if (options.signal?.aborted) close();
  let cursor = '';
  const done = (async () => {
    while (!controller.signal.aborted) {
      let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
      try {
        const response = await client.fetchRaw(operationURL(integrationContract.events), { signal: controller.signal, headers: { Accept: 'text/event-stream', ...(cursor ? { 'Last-Event-ID': cursor } : {}) } });
        if (response.status === 401) { options.onUnauthorized?.(); return; }
        if (response.status === 403) throw new ClientError(403, 'subscription_denied', '没有订阅权限');
        if (!response.ok || !response.body || !response.headers.get('content-type')?.startsWith('text/event-stream')) throw new ClientError(response.status, 'subscription_unavailable', '订阅暂不可用');
        reader = response.body.getReader();
        activeReader = reader;
        const decoder = new TextDecoder(); let buffer = '';
        while (!controller.signal.aborted) {
          const part = await reader.read(); if (part.done) break;
          buffer = (buffer + decoder.decode(part.value, { stream: true })).replace(/\r\n/g, '\n');
          if (buffer.length > 65536) throw new Error('SSE frame exceeds size limit');
          let boundary: number;
          while ((boundary = buffer.indexOf('\n\n')) >= 0) {
            const frame = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
            let event = ''; let id = ''; const data: string[] = [];
            for (const line of frame.split('\n')) {
              if (line.startsWith('event:')) event = line.slice(6).trim();
              else if (line.startsWith('id:')) id = line.slice(3).trim();
              else if (line.startsWith('data:')) data.push(line.slice(5).trimStart());
            }
            if (/^\d+$/.test(id)) cursor = id;
            if (event === 'session-expired') { options.onUnauthorized?.(); return; }
            if (event === 'unavailable') throw new Error('Subscription unavailable');
            if (event === 'change' || event === 'ready') {
              const parsed: unknown = JSON.parse(data.join('\n') || '{}');
              const resources = parsed && typeof parsed === 'object' && 'resources' in parsed && Array.isArray(parsed.resources) && parsed.resources.every(value => typeof value === 'string') ? parsed.resources as string[] : [];
              if (!controller.signal.aborted) options.onChange({ resources, cursor, requery: true });
            }
          }
        }
      } catch (error) {
        if (controller.signal.aborted) return;
        options.onError?.(error);
        if (error instanceof ClientError && error.status === 403) return;
      } finally { await reader?.cancel().catch(() => {}); reader?.releaseLock(); activeReader = undefined; }
      if (controller.signal.aborted) return;
      await new Promise<void>(resolve => {
        const finished = () => { clearTimeout(timer); controller.signal.removeEventListener('abort', finished); resolve(); };
        const timer = setTimeout(finished, Math.min(30000, Math.max(250, options.reconnectDelay ?? 1500)));
        controller.signal.addEventListener('abort', finished, { once: true });
      });
    }
  })().finally(() => { options.signal?.removeEventListener('abort', close); });
  return { close, done };
}
