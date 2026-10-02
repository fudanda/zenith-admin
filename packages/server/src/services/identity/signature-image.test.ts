import { describe, expect, it } from 'vitest';
import sharp from 'sharp';
import { SIGNATURE_MAX_WIDTH } from '@arcbase/shared/core';
import { normalizeSignatureImage } from './signature-image';

const url = (buffer: Buffer) => 'data:image/png;base64,' + buffer.toString('base64');
async function ink() {
  return sharp(Buffer.from('<svg width="240" height="90"><path d="M20 65 Q50 10 80 60 T130 50 L205 35" fill="none" stroke="black" stroke-width="4"/></svg>')).png().toBuffer();
}
describe('signature image normalization', () => {
  it('normalizes real handwriting PNG and strips metadata', async () => {
    const result = await normalizeSignatureImage(url(await ink()));
    const meta = await sharp(result.buffer).metadata();
    expect(meta.format).toBe('png');
    expect(meta.exif).toBeUndefined();
    expect(result.dataUrl).toBe(url(result.buffer));
  });
  it.each(['https://example.com/signature.png', 'data:image/svg+xml;base64,PHN2Zy8+', 'data:image/png;base64,AA=='])('rejects URLs, other formats and invalid image bytes: %s', async (data) => {
    await expect(normalizeSignatureImage(data)).rejects.toThrow();
  });
  it.each([0, 1])('rejects an empty white or transparent canvas (alpha %s)', async (alpha) => {
    const data = await sharp({ create: { width: 200, height: 80, channels: 4, background: { r: 255, g: 255, b: 255, alpha } } }).png().toBuffer();
    await expect(normalizeSignatureImage(url(data))).rejects.toThrow('画布为空');
  });
  it('rejects non-PNG bytes even if the data URL claims PNG', async () => {
    const data = await sharp(await ink()).flatten({ background: 'white' }).jpeg().toBuffer();
    await expect(normalizeSignatureImage(url(data))).rejects.toThrow('单帧 PNG');
  });
  it('rejects oversized dimensions before decoding the raw pixels', async () => {
    const data = await sharp({ create: { width: SIGNATURE_MAX_WIDTH + 1, height: 10, channels: 3, background: 'black' } }).png().toBuffer();
    await expect(normalizeSignatureImage(url(data))).rejects.toThrow('尺寸不得超过');
  });
});
