import { afterEach, describe, expect, it, vi } from 'vitest';
import type { CmsMediaProcessing, CmsResource } from '@arcbase/shared/cms';
import { mockCmsResources } from './data/cms';
import { cmsMediaHandlers, mockCmsResourceWithMedia } from './handlers/cms-media';

afterEach(() => { vi.restoreAllMocks(); mockCmsResources.splice(0, mockCmsResources.length, ...mockCmsResources.filter((row) => row.id < 900000)); });
async function call<T>(method: string, path: string, body?: unknown) {
  for (const handler of cmsMediaHandlers) {
    const request = new Request(`${window.location.origin}/api/cms/resources${path}`, { method, headers: { 'content-type': 'application/json' }, body: body ? JSON.stringify(body) : undefined });
    const result = await (handler as unknown as { run(args: unknown): Promise<{ response?: Response } | null> }).run({ request, requestId: 'cms-media-test' });
    if (result?.response) return { status: result.response.status, body: await result.response.json() as { data: T } };
  }
  throw new Error('No matching media handler');
}

describe('CMS media mock contract', () => {
  it('pins the submitted version, rejects concurrent jobs and never moves old output onto a replacement binary', async () => {
    const resource = { id: 900001, siteId: 1, type: 'video', name: 'test.mp4', fileId: crypto.randomUUID(), url: '/first.mp4', width: 640, height: 360,
      thumbUrl: null, mimeType: 'video/mp4', size: 100, createdAt: '2026-09-28 00:00:00', updatedAt: '2026-09-28 00:00:00' } as CmsResource;
    mockCmsResources.push(resource);
    const first = await call<{ assetVersionId: number }>('GET', '/900001/media');
    const now = Date.now();
    expect((await call('POST', '/900001/media/process', { assetVersionId: first.body.data.assetVersionId })).status).toBe(200);
    expect((await call('POST', '/900001/media/process', { assetVersionId: first.body.data.assetVersionId })).status).toBe(409);
    vi.spyOn(Date, 'now').mockReturnValue(now + 5000);
    const completed = await call<{ processing: CmsMediaProcessing }>('GET', '/900001/media');
    expect(completed.body.data.processing.status).toBe('success');
    expect(mockCmsResourceWithMedia(resource).media?.duration).toBe(60);
    resource.url = '/replacement.mp4'; resource.fileId = crypto.randomUUID();
    expect(mockCmsResourceWithMedia(resource).media).toBeNull();
    expect(mockCmsResourceWithMedia(resource).assetVersionId).not.toBe(first.body.data.assetVersionId);
  });
});
