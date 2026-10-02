import { eq } from 'drizzle-orm';
import { db } from '../../db';
import { cmsSensitiveWords, cmsErrorProneWords } from '../../db/schema';
import { AhoCorasick, createTtlCache, toCodePoints } from '../../lib/aho-corasick';
import type { CmsTextCheckResult } from '@arcbase/shared/cms';

/**
 * 内容编辑词库检查：一次扫描同时命中敏感词与易错词（Aho-Corasick 多模式匹配）。
 * 与提交拦截用的 sanitizeUserText（cms-sensitive-words.service）不同，
 * 本服务只报告命中情况（含次数），不拦截、不改写，供编辑页“内容检查”按钮使用。
 */

interface CheckWord {
  kind: 'sensitive' | 'errorProne';
  word: string;
  /** 敏感词=replaceWith（可空），易错词=correction */
  extra: string | null;
}

const CACHE_TTL_MS = 60_000;

const automatonCache = createTtlCache(async () => {
  const [sensitive, errorProne] = await Promise.all([
    db.select().from(cmsSensitiveWords).where(eq(cmsSensitiveWords.status, 'enabled')),
    db.select().from(cmsErrorProneWords).where(eq(cmsErrorProneWords.status, 'enabled')),
  ]);
  return new AhoCorasick<CheckWord>([
    ...sensitive.map((w) => ({
      word: w.word,
      payload: { kind: 'sensitive' as const, word: w.word, extra: w.replaceWith ?? null },
    })),
    ...errorProne.map((w) => ({
      word: w.word,
      payload: { kind: 'errorProne' as const, word: w.word, extra: w.correction },
    })),
  ]);
}, CACHE_TTL_MS);

/** 词库变更（敏感词/易错词增删改）后调用，即时失效检查缓存 */
export function invalidateWordCheckCache(): void {
  automatonCache.invalidate();
}

const MAX_CHECK_LENGTH = 200_000;

/** 扫描文本，返回敏感词与易错词命中清单（含命中次数），单次扫描 O(文本长度) */
export async function checkCmsText(text: string): Promise<CmsTextCheckResult> {
  const automaton = await automatonCache.get();
  const result: CmsTextCheckResult = { sensitive: [], errorProne: [] };
  if (automaton.isEmpty || !text) return result;

  const sensitiveHits = new Map<string, { word: string; replaceWith: string | null; count: number }>();
  const errorProneHits = new Map<string, { word: string; correction: string; count: number }>();
  automaton.scan(toCodePoints(text.slice(0, MAX_CHECK_LENGTH)), (w) => {
    if (w.kind === 'sensitive') {
      const hit = sensitiveHits.get(w.word) ?? { word: w.word, replaceWith: w.extra, count: 0 };
      hit.count += 1;
      sensitiveHits.set(w.word, hit);
    } else {
      const hit = errorProneHits.get(w.word) ?? { word: w.word, correction: w.extra ?? '', count: 0 };
      hit.count += 1;
      errorProneHits.set(w.word, hit);
    }
  });
  result.sensitive = [...sensitiveHits.values()].sort((a, b) => b.count - a.count);
  result.errorProne = [...errorProneHits.values()].sort((a, b) => b.count - a.count);
  return result;
}
