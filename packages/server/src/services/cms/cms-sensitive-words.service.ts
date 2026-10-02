import { eq, asc } from 'drizzle-orm';
import { HTTPException } from 'hono/http-exception';
import { cmsSensitiveWordContract, cmsSensitiveWordSchema } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsSensitiveWords } from '../../db/schema';
import type { CmsSensitiveWordRow } from '../../db/schema';
import { keywordCondition } from '../../lib/where-helpers';
import { AhoCorasick, applyReplacements, createTtlCache, toCodePoints, type AcMatch } from '../../lib/aho-corasick';
import { invalidateWordCheckCache } from './cms-word-check.service';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';

// ─── 内存缓存 + Aho-Corasick 自动机 ────────────────────────────────────────────
const CACHE_TTL_MS = 60_000;

const automatonCache = createTtlCache(async () => {
  const words = await db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.status, 'enabled'));
  return new AhoCorasick(words.map((w) => ({ word: w.word, payload: w })));
}, CACHE_TTL_MS);

function invalidateSensitiveWordCache() {
  automatonCache.invalidate();
  invalidateWordCheckCache();
}

/**
 * 敏感词过滤（Aho-Corasick 多模式匹配，O(文本长度)）：
 * 拦截词（replaceWith 为空）命中直接抛 400；替换词命中则替换为指定文本。
 */
export async function sanitizeUserText(text: string): Promise<string> {
  const automaton = await automatonCache.get();
  if (automaton.isEmpty) return text;
  // 单次扫描收集所有命中区间；拦截词命中立即抛出，不再继续扫描
  const matches: AcMatch<CmsSensitiveWordRow>[] = [];
  const chars = toCodePoints(text);
  automaton.scan(chars, (w, endIndex) => {
    if (w.replaceWith == null || w.replaceWith === '') {
      throw new HTTPException(400, { message: '内容包含敏感词，提交被拒绝' });
    }
    matches.push({ start: endIndex - toCodePoints(w.word).length + 1, end: endIndex + 1, payload: w });
  });
  if (matches.length === 0) return text;
  return applyReplacements(chars, matches, (w) => w.replaceWith ?? '');
}

// ─── 数据映射 / CRUD ──────────────────────────────────────────────────────────
export const mapCmsSensitiveWord = entityMapper(cmsSensitiveWordSchema);

export const cmsSensitiveWordService = defineCrudService(cmsSensitiveWordContract, {
  table: cmsSensitiveWords,
  map: mapCmsSensitiveWord,
  notFound: '敏感词不存在',
  unique: '该敏感词已存在',
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [cmsSensitiveWords.word]),
      q.status ? eq(cmsSensitiveWords.status, q.status) : undefined,
    ],
    orderBy: [asc(cmsSensitiveWords.id)],
  }),
  create: { after: () => invalidateSensitiveWordCache() },
  update: { after: () => invalidateSensitiveWordCache() },
  remove: { after: () => invalidateSensitiveWordCache() },
});

export const {
  list: listCmsSensitiveWords,
  ensure: ensureCmsSensitiveWordExists,
  create: createCmsSensitiveWord,
  update: updateCmsSensitiveWord,
  remove: deleteCmsSensitiveWord,
} = cmsSensitiveWordService;
