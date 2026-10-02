import { HTTPException } from 'hono/http-exception';
import { SIGNATURE_MAX_HEIGHT, SIGNATURE_MAX_IMAGE_BYTES, SIGNATURE_MAX_WIDTH, signatureDataUrlSchema } from '@arcbase/shared/core';

/** 将输入规整为不含元数据的单帧 PNG，限制解码体积并拒绝空白画布。 */
export async function normalizeSignatureImage(dataUrl: string): Promise<{ buffer: Buffer; dataUrl: string }> {
  const parsed = signatureDataUrlSchema.safeParse(dataUrl);
  if (!parsed.success) throw new HTTPException(400, { message: '签名必须为大小不超过 512 KiB 的 PNG 图片' });
  const encoded = dataUrl.slice('data:image/png;base64,'.length);
  const input = Buffer.from(encoded, 'base64');
  if (!input.length || input.length > SIGNATURE_MAX_IMAGE_BYTES || input.toString('base64') !== encoded) {
    throw new HTTPException(400, { message: '签名图片编码无效或体积超限' });
  }
  try {
    const { default: sharp } = await import('sharp');
    const options = { limitInputPixels: SIGNATURE_MAX_WIDTH * SIGNATURE_MAX_HEIGHT, failOn: 'warning' as const };
    const metadata = await sharp(input, options).metadata();
    if (metadata.format !== 'png' || (metadata.pages ?? 1) !== 1 || !metadata.width || !metadata.height
      || metadata.width > SIGNATURE_MAX_WIDTH || metadata.height > SIGNATURE_MAX_HEIGHT) {
      throw new HTTPException(400, { message: '签名须为单帧 PNG，尺寸不得超过 2048 × 1024' });
    }
    const { data, info } = await sharp(input, options).flatten({ background: '#ffffff' }).greyscale().raw().toBuffer({ resolveWithObject: true });
    let ink = 0;
    let minX = info.width; let maxX = -1; let minY = info.height; let maxY = -1;
    for (let y = 0; y < info.height; y++) {
      for (let x = 0; x < info.width; x++) {
        if (data[(y * info.width + x) * info.channels] < 240) {
          ink++; minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y);
        }
      }
    }
    if (ink < 16 || maxX - minX < 3 || maxY - minY < 3) throw new HTTPException(400, { message: '签名画布为空，请先完成手写签名' });
    const buffer = await sharp(input, options).png({ compressionLevel: 9 }).toBuffer();
    if (buffer.length > SIGNATURE_MAX_IMAGE_BYTES) throw new HTTPException(400, { message: '签名图片体积超限' });
    return { buffer, dataUrl: 'data:image/png;base64,' + buffer.toString('base64') };
  } catch (error) {
    if (error instanceof HTTPException) throw error;
    throw new HTTPException(400, { message: '签名图片无法解码，请重新手写签名' });
  }
}
