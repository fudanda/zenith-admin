import { eq, asc } from 'drizzle-orm';
import { cmsErrorProneWordContract, cmsErrorProneWordSchema } from '@arcbase/shared/cms';
import { db } from '../../db';
import { cmsErrorProneWords } from '../../db/schema';
import type { CmsErrorProneWordRow } from '../../db/schema';
import { keywordCondition } from '../../lib/where-helpers';
import { AhoCorasick, applyReplacements, createTtlCache, toCodePoints, type AcMatch } from '../../lib/aho-corasick';
import { invalidateWordCheckCache } from './cms-word-check.service';
import { defineCrudService } from '../../lib/crud-service';
import { entityMapper } from '../../lib/entity-map';

// ─── 易错词自动替换（Aho-Corasick 多模式匹配，与敏感词同构）────────────────────
const REPLACE_CACHE_TTL_MS = 60_000;

const automatonCache = createTtlCache(async () => {
  const words = await db.select().from(cmsErrorProneWords).where(eq(cmsErrorProneWords.status, 'enabled'));
  return new AhoCorasick(words.map((w) => ({ word: w.word, payload: w })));
}, REPLACE_CACHE_TTL_MS);

function invalidateErrorProneCaches(): void {
  automatonCache.invalidate();
  invalidateWordCheckCache();
}

/**
 * 易错词批量替换：命中词替换为 correction，单次扫描 O(文本长度)。
 * 与 checkCmsText（只报告）不同，本函数直接改写文本，供内容保存管线按站点开关调用。
 */
export async function replaceErrorProneWords(text: string): Promise<string> {
  if (!text) return text;
  const automaton = await automatonCache.get();
  if (automaton.isEmpty) return text;

  const matches: AcMatch<CmsErrorProneWordRow>[] = [];
  const chars = toCodePoints(text);
  automaton.scan(chars, (w, endIndex) => {
    matches.push({ start: endIndex - toCodePoints(w.word).length + 1, end: endIndex + 1, payload: w });
  });
  if (matches.length === 0) return text;

  return applyReplacements(chars, matches, (w) => w.correction);
}

// ─── 数据映射 ─────────────────────────────────────────────────────────────────
export const mapCmsErrorProneWord = entityMapper(cmsErrorProneWordSchema);

export const cmsErrorProneWordService = defineCrudService(cmsErrorProneWordContract, {
  table: cmsErrorProneWords,
  map: mapCmsErrorProneWord,
  notFound: '易错词不存在',
  unique: '该易错词已存在',
  list: (q) => ({
    where: [
      keywordCondition(q.keyword, [cmsErrorProneWords.word, cmsErrorProneWords.correction]),
      q.status ? eq(cmsErrorProneWords.status, q.status) : undefined,
    ],
    orderBy: [asc(cmsErrorProneWords.id)],
  }),
  create: { after: () => invalidateErrorProneCaches() },
  update: { after: () => invalidateErrorProneCaches() },
  remove: { after: () => invalidateErrorProneCaches() },
});

export const {
  list: listCmsErrorProneWords,
  ensure: ensureCmsErrorProneWordExists,
  create: createCmsErrorProneWord,
  update: updateCmsErrorProneWord,
  remove: deleteCmsErrorProneWord,
} = cmsErrorProneWordService;
