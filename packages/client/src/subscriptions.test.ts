import { describe, expect, it, vi } from 'vitest';
import { Client } from './client';
import { subscribe } from './subscriptions';

describe('restricted integrations', () => {
  it('keeps legacy keys usable with the same protected transport', async () => {
    const key = `zen_${'b'.repeat(64)}`;
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const client = new Client({ apiKey: key, transport: send });
    await client.fetchRaw('/api/v1/positions');
    expect(new Headers(send.mock.calls[0][1]?.headers).get('Authorization')).toBe(`Bearer ${key}`);
    expect(send.mock.calls[0][1]?.credentials).toBe('omit');
    expect(() => new Client({ apiKey: `zen_${'z'.repeat(64)}` })).toThrow();
  });
  it('sends a configured key without Cookie or CSRF and never accepts caller identity headers', async () => {
    const key = `arc_${'a'.repeat(64)}`;
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response('{}'));
    const client = new Client({ apiKey: key, transport: send });
    await client.fetchRaw('/api/v1/positions', { method: 'POST', body: '{}', headers: { Authorization: 'Bearer attacker', Cookie: 'fake', 'X-CSRF-Token': 'fake' } });
    const options = send.mock.calls[0][1]!;
    expect(new Headers(options.headers).get('Authorization')).toBe(`Bearer ${key}`);
    expect(new Headers(options.headers).has('Cookie')).toBe(false);
    expect(new Headers(options.headers).has('X-CSRF-Token')).toBe(false);
    expect(options.credentials).toBe('omit');
  });
  it('parses split frames, reconnects with the last cursor and stops on expiry', async () => {
    const encoder = new TextEncoder(); const change = vi.fn(); const expired = vi.fn();
    const send = vi.fn<typeof fetch>().mockImplementationOnce(async () => new Response(new ReadableStream({ start(controller) {
      for (const text of ['id: 12\r', '\nevent: change\r\ndata: {"resources":["pos', 'itions"]}\r\n\r\n']) controller.enqueue(encoder.encode(text)); controller.close();
    } }), { headers: { 'Content-Type': 'text/event-stream' } })).mockImplementationOnce(async () => new Response('event: session-expired\ndata: {}\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
    const stream = subscribe(new Client({ transport: send }), { onChange: change, onUnauthorized: expired, reconnectDelay: 250 });
    await stream.done;
    expect(change).toHaveBeenCalledWith({ resources: ['positions'], cursor: '12', requery: true });
    expect(new Headers(send.mock.calls[1][1]?.headers).get('Last-Event-ID')).toBe('12');
    expect(expired).toHaveBeenCalledTimes(1);
  });
  it('cancels the stream and never reconnects after disposal', async () => {
    let cancelled = false;
    const send = vi.fn<typeof fetch>().mockResolvedValue(new Response(new ReadableStream({ cancel() { cancelled = true; } }), { headers: { 'Content-Type': 'text/event-stream' } }));
    const client = new Client({ transport: send }); const stream = subscribe(client, { onChange: vi.fn() });
    await vi.waitFor(() => expect(send).toHaveBeenCalledTimes(1)); stream.close();
    await stream.done;
    expect((send.mock.calls[0][1]?.signal as AbortSignal).aborted).toBe(true);
    expect(cancelled).toBe(true);
    expect(send).toHaveBeenCalledTimes(1);
  });
});
