import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile } from 'node:fs/promises';
import { isAbsolute } from 'node:path';
import { CMS_MEDIA_VARIANT_WIDTHS } from '@arcbase/shared/cms';
import { sharp } from '../../lib/sharp-loader';
import { IMAGE_MAX_INPUT_PIXELS } from './cms-image.service';
import { TaskNonRetryableError } from '../../lib/task-center/types';

const executeFile = promisify(execFile);
const LOCAL_MEDIA_INPUT = ['-protocol_whitelist', 'file,pipe', '-format_whitelist', 'mov,matroska,webm,avi,mp3,wav,ogg,flac,aac,mpeg,mpegts'];

function localInput(path: string) {
  if (!isAbsolute(path) || path.includes('\0')) throw new Error('媒体处理只接受本地临时文件');
  return path;
}
export function cmsFfprobeArguments(path: string) {
  return ['-v', 'error', ...LOCAL_MEDIA_INPUT, '-show_format', '-show_streams', '-of', 'json', localInput(path)];
}
export function cmsFfmpegPosterArguments(path: string, seconds: number, outputPath: string) {
  if (!Number.isFinite(seconds) || seconds < 0) throw new Error('无效的视频海报时间');
  return ['-nostdin', '-hide_banner', '-v', 'error', '-y', ...LOCAL_MEDIA_INPUT, '-ss', String(seconds), '-i', localInput(path),
    '-map', '0:v:0', '-frames:v', '1', '-vf', 'scale=1440:1440:force_original_aspect_ratio=decrease', localInput(outputPath)];
}

async function executeMediaTool(tool: 'ffmpeg' | 'ffprobe', args: string[], timeout: number) {
  try {
    return await executeFile(tool, args, { timeout, maxBuffer: 2 * 1024 * 1024, windowsHide: true, shell: false });
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      throw new TaskNonRetryableError(`媒体处理失败：服务器未配置 ${tool} 可执行程序，请由管理员配置后重试`);
    }
    throw new TaskNonRetryableError(`媒体处理失败：${tool} 无法读取此文件或已超时，请检查文件格式和完整性`, { cause: error });
  }
}

const numberOrNull = (value: unknown) => {
  const number = typeof value === 'number' || typeof value === 'string' ? Number(value) : NaN;
  return Number.isFinite(number) && number >= 0 ? number : null;
};
const stringOrNull = (value: unknown) => typeof value === 'string' && value.length ? value : null;

export function parseCmsProbeMetadata(value: unknown) {
  if (!value || typeof value !== 'object') throw new Error('媒体信息无效');
  const probe = value as { streams?: Array<Record<string, unknown>>; format?: Record<string, unknown> };
  const streams = Array.isArray(probe.streams) ? probe.streams : [];
  const video = streams.find((stream) => stream.codec_type === 'video' && !(stream.disposition as { attached_pic?: number } | undefined)?.attached_pic);
  const audio = streams.find((stream) => stream.codec_type === 'audio');
  if (!video && !audio) throw new TaskNonRetryableError('媒体文件中没有有效音视频轨道');
  const duration = numberOrNull(probe.format?.duration) ?? numberOrNull(video?.duration) ?? numberOrNull(audio?.duration);
  return { width: numberOrNull(video?.width), height: numberOrNull(video?.height), duration,
    format: stringOrNull(probe.format?.format_name), videoCodec: stringOrNull(video?.codec_name), audioCodec: stringOrNull(audio?.codec_name) };
}

export function validateCmsWebVtt(input: Buffer): void {
  if (input.length > 5 * 1024 * 1024) throw new TaskNonRetryableError('字幕文件不能超过 5 MB');
  let text: string;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(input).replace(/^\uFEFF/, '').replace(/\r\n?/g, '\n'); }
  catch { throw new TaskNonRetryableError('字幕必须是 UTF-8 编码的 WebVTT 文件'); }
  if (!/^WEBVTT(?:[ \t][^\r\n]*)?(?:\r?\n|$)/.test(text) || text.includes('\0')) {
    throw new TaskNonRetryableError('字幕必须是 UTF-8 编码的 WebVTT 文件（以 WEBVTT 开头）');
  }
  const timingLines = text.split('\n').filter((line) => line.includes('-->'));
  const cues = timingLines.map((line) => line.match(/^(?:(\d+):)?(\d{2}):(\d{2}\.\d{3})[ \t]+-->[ \t]+(?:(\d+):)?(\d{2}):(\d{2}\.\d{3})(?:[ \t].*)?$/));
  if (!cues.length) throw new TaskNonRetryableError('字幕中没有有效的 WebVTT 时间轴');
  for (const cue of cues) {
    if (!cue) throw new TaskNonRetryableError('字幕中包含无效的 WebVTT 时间轴');
    const start = Number(cue[1] ?? 0) * 3600 + Number(cue[2]) * 60 + Number(cue[3]);
    const end = Number(cue[4] ?? 0) * 3600 + Number(cue[5]) * 60 + Number(cue[6]);
    if (end <= start || Number(cue[2]) > 59 || Number(cue[5]) > 59 || Number(cue[3]) >= 60 || Number(cue[6]) >= 60) {
      throw new TaskNonRetryableError('字幕时间轴无效：结束时间必须晚于开始时间');
    }
  }
}

export async function readCmsImageMetadata(path: string) {
  const metadata = await sharp(localInput(path), { limitInputPixels: IMAGE_MAX_INPUT_PIXELS }).metadata();
  // Dimensions follow EXIF orientation, like the auto-oriented derivative outputs.
  const rotated = metadata.orientation !== undefined && metadata.orientation >= 5;
  return { width: (rotated ? metadata.height : metadata.width) ?? null, height: (rotated ? metadata.width : metadata.height) ?? null,
    animated: (metadata.pages ?? 1) > 1,
    duration: metadata.delay?.length ? metadata.delay.reduce((sum, value) => sum + value, 0) / 1000 : null,
    format: metadata.format ?? null, videoCodec: null, audioCodec: null };
}

export async function makeCmsImageVariant(path: string, targetWidth: typeof CMS_MEDIA_VARIANT_WIDTHS[number]) {
  return sharp(localInput(path), { limitInputPixels: IMAGE_MAX_INPUT_PIXELS }).rotate()
    .resize({ width: targetWidth, withoutEnlargement: true }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
}

export async function readCmsAvMetadata(path: string) {
  const output = await executeMediaTool('ffprobe', cmsFfprobeArguments(path), 20_000);
  return parseCmsProbeMetadata(JSON.parse(output.stdout));
}

export async function makeCmsVideoPoster(path: string, seconds: number, outputPath: string) {
  await executeMediaTool('ffmpeg', cmsFfmpegPosterArguments(path, seconds, outputPath), 60_000);
  const bytes = await readFile(outputPath);
  return sharp(bytes, { limitInputPixels: IMAGE_MAX_INPUT_PIXELS }).webp({ quality: 82 }).toBuffer({ resolveWithObject: true });
}
