import { describe, expect, it, vi } from 'vitest';
import { positionContract, userContract } from '@zenith/shared/identity';
import { Client, ApiError, call, callRaw, operationURL } from './index';

describe('typed contract calls outside React', () => {
  it('derives versioned paths, filters and response validation from shared', async () => {
    const send = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'ok', data: { list: [], total: 0, page: 1, pageSize: 10 } }))).mockResolvedValueOnce(new Response(JSON.stringify({ code: 0, message: 'ok', data: { broken: true } })));
    const client = new Client({ transport: send });
    const data = await call(client, positionContract.list, { query: { keyword: 'A', page: 1 } });
    expect(data.list).toEqual([]);
    expect(send.mock.calls[0][0]).toBe('/api/v1/positions?keyword=A&page=1');
    await expect(call(client, positionContract.list, { query: {} })).rejects.toThrow();
    expect(operationURL(positionContract.detail, { params: { id: 3 } })).toBe('/api/v1/positions/3');
  });

  it('keeps update omissions and strips read-only entity fields before sending', async () => {
    const send = vi.fn<typeof fetch>().mockImplementation(async () => new Response(JSON.stringify({ code: 409, message: 'conflict', data: null }), { status: 409 }));
    const client = new Client({ transport: send });
    client.setCsrfToken('csrf');
    const response = await callRaw(client, userContract.update, { params: { id: 1 }, body: { nickname: 'Changed', tenantId: 2, id: 1 } as never });
    expect(response.code).toBe(409);
    expect(JSON.parse(send.mock.calls[0][1]!.body as string)).toEqual({ nickname: 'Changed' });
    await expect(call(client, userContract.update, { params: { id: 1 }, body: { nickname: 'Changed' } })).rejects.toBeInstanceOf(ApiError);
  });
});
