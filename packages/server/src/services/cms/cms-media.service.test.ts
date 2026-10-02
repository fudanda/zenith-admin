import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { CmsResource } from '@arcbase/shared/cms';
const state = vi.hoisted(() => ({ batches: [] as unknown[][] }));
vi.mock('../../db', () => ({ db: { select: () => ({ from: () => ({ where: () => ({ orderBy: async () => state.batches.shift() ?? [] }) }) }) } }));
vi.mock('../../lib/task-center', () => ({ enqueueAsyncTask: vi.fn(), persistAsyncTask: vi.fn() }));
vi.mock('./cms-sites.service', () => ({ assertSiteAccess: vi.fn() }));
vi.mock('./cms-design-versions.service', () => ({ ensureCmsAssetVersion: vi.fn() }));
vi.mock('../files/file-gc.service', () => ({ releaseManagedFiles: vi.fn() }));
import { addCmsMediaToResources } from './cms-media.service';

const resource = { id: 1, url: '/retained.mp4' } as CmsResource;
const output = { width: 640, height: 360, duration: 12, format: 'mp4', videoCodec: 'h264', audioCodec: null, focalPoint: { x: 0.5, y: 0.5 }, variants: [], poster: null, subtitle: null };
beforeEach(() => { state.batches.length = 0; });

describe('resource media enrichment', () => {
  it('selects the exact retained binary version and leaves failed / unprocessed replacements without old metadata', async () => {
    state.batches.push([{ id: 8, resourceId: 1, url: '/new.mp4' }, { id: 4, resourceId: 1, url: '/retained.mp4' }]);
    state.batches.push([{ id: 9, assetVersionId: 4, status: 'success', result: output }]);
    expect(await addCmsMediaToResources([resource])).toMatchObject([{ assetVersionId: 4, media: { duration: 12, assetVersionId: 4 } }]);
    state.batches.push([{ id: 8, resourceId: 1, url: '/new.mp4' }]);
    state.batches.push([]);
    expect(await addCmsMediaToResources([{ ...resource, url: '/new.mp4' }])).toMatchObject([{ assetVersionId: 8, media: null }]);
  });

  it('keeps the most recent successful result for each version and avoids database work for empty lists', async () => {
    state.batches.push([{ id: 4, resourceId: 1, url: '/retained.mp4' }]);
    state.batches.push([{ id: 10, assetVersionId: 4, status: 'success', result: { ...output, duration: 16 } }, { id: 9, assetVersionId: 4, status: 'success', result: output }]);
    expect((await addCmsMediaToResources([resource]))[0].media?.duration).toBe(16);
    expect(await addCmsMediaToResources([])).toEqual([]);
  });
});
