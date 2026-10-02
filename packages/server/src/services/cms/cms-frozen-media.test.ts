import { describe, expect, it } from 'vitest';
import type { CmsFrozenMedia } from '@arcbase/shared/cms';
import { cmsDurationLabel, frozenCmsImageAttributes, renderCmsFrozenBody } from './cms-frozen-media';

const frozen: CmsFrozenMedia = { processingId: 1, assetVersionId: 2, sourceUrl: '/original.png', width: 100, height: 80, duration: null, format: 'png', videoCodec: null, audioCodec: null, focalPoint: { x: 0.2, y: 0.8 }, poster: null, subtitle: null,
  variants: [{ fileId: '11111111-1111-4111-8111-111111111111', targetWidth: 320, width: 100, height: 80, url: '/small.webp' }, { fileId: '22222222-2222-4222-8222-222222222222', targetWidth: 768, width: 100, height: 80, url: '/small.webp' }] };
describe('frozen content media rendering', () => {
  it('uses the pinned binary and deduplicates non-upscaled responsive widths', () => {
    expect(frozenCmsImageAttributes('/original.png', { '12': frozen })).toEqual({ srcSet: '/small.webp 100w', objectPosition: '20% 80%' });
    expect(frozenCmsImageAttributes('/replaced.png', { '12': frozen })).toEqual({});
    expect(renderCmsFrozenBody('<p>Text</p><img src="/original.png"><img src="/elsewhere.png">', { '12': frozen })).toContain('srcset="/small.webp 100w"');
  });
  it('formats persistent duration and leaves unprocessed original HTML intact', () => {
    expect(cmsDurationLabel(121.2)).toBe('2:01'); expect(cmsDurationLabel(null)).toBeNull();
    expect(renderCmsFrozenBody('<p>原文</p>', {})).toBe('<p>原文</p>');
  });
});
