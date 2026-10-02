import { describe, expect, it, vi } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';
import { createCmsSearchWordSchema } from '@arcbase/shared/cms';
import { SEED_CMS_SEARCH_WORDS } from '@arcbase/shared/seed';
import { loadCmsExtensionWords, normalizeCmsSearchDictionaryWord } from './cms-search-dictionary';
import {
  contentSearchVector,
  contentSearchVectorOnUpdate,
  extendSearchTexts,
  filterCmsSearchTokens,
} from './cms-search.service';

describe('CMS site search governance', () => {
  it('filters stop words and normalizes duplicate query/index tokens', () => {
    expect(filterCmsSearchTokens(
      ['ArcBase', '的', 'CMS', 'arcbase', '，', '平台'],
      new Set(['的']),
    )).toEqual(['arcbase', 'cms', '平台']);
  });

  it('rejects whitespace/control dictionary tokens in shared and service boundaries', () => {
    for (const word of ['ArcBase', 'bad\nword', 'bad word', '***']) {
      expect(normalizeCmsSearchDictionaryWord(word)).toBeNull();
      expect(createCmsSearchWordSchema.safeParse({
        siteId: 1, word, type: 'extension', groupName: '测试', weight: 1000, status: 'enabled',
      }).success).toBe(false);
    }
    expect(SEED_CMS_SEARCH_WORDS[0].word).toBe('ArcBaseAdmin');
  });

  it('isolates a single loadDict failure and continues loading later words', () => {
    const loadDict = vi.fn()
      .mockImplementationOnce(() => { throw new Error('bad token'); })
      .mockImplementationOnce(() => undefined);
    const onError = vi.fn();
    const loaded = loadCmsExtensionWords(
      { loadDict } as Pick<import('@node-rs/jieba').Jieba, 'loadDict'>,
      [
        { id: 1, word: 'BrokenWord', weight: 1000 },
        { id: 2, word: 'GoodWord', weight: 1000 },
      ],
      onError,
    );
    expect(loaded).toBe(1);
    expect(loadDict).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledOnce();
  });
});

describe('contentSearchVector（search_vector 唯一写入口）', () => {
  const dialect = new PgDialect();
  const toQuery = (expr: import('drizzle-orm').SQL) => dialect.sqlToQuery(expr);

  it('builds weighted A/B/C tsvector expression with segmented and HTML-stripped params', () => {
    const { sql: text, params } = toQuery(contentSearchVector(1, {
      title: 'ArcBase平台',
      seoKeywords: '后台',
      summary: '管理系统',
      body: '<p>内容检索</p>',
    }));
    expect(text).toContain("setweight(to_tsvector('simple'::regconfig, $1), 'A')");
    expect(text).toContain("'B'");
    expect(text).toContain("'C'");
    expect(params).toHaveLength(3);
    expect(String(params[0])).toContain('arcbase');
    expect(String(params[2])).not.toContain('<p>');
    expect(String(params[2])).toContain('检索');
  });

  it('appends extendTexts into the weight-C segment', () => {
    const withExtend = toQuery(contentSearchVector(1, { title: '标题' }, ['扩展字段值']));
    expect(String(withExtend.params[2])).toContain('扩展');
  });

  it('contentSearchVectorOnUpdate falls back to current values for fields absent in patch', () => {
    const current = { siteId: 1, title: '原标题', seoKeywords: '原词', summary: '原摘要', body: '原正文' };
    const untouched = toQuery(contentSearchVectorOnUpdate(current, {}));
    const baseline = toQuery(contentSearchVector(1, current));
    expect(untouched.params).toEqual(baseline.params);

    const patched = toQuery(contentSearchVectorOnUpdate(current, { title: '新标题', seoKeywords: null }));
    const expected = toQuery(contentSearchVector(1, { ...current, title: '新标题', seoKeywords: null }));
    expect(patched.params).toEqual(expected.params);
  });

  it('extendSearchTexts keeps only string values', () => {
    expect(extendSearchTexts({ a: '文本', b: 1, c: null, d: ['x'] })).toEqual(['文本']);
    expect(extendSearchTexts(null)).toEqual([]);
  });
});
