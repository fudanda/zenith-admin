import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { buildCmsChannelCodeLink, buildCmsEntityLink, buildCmsInternalLink, isCmsEntityLink, isCmsSiteLink, isValidCmsLink, parseCmsLink, remapCmsEntityLink } from '@arcbase/shared/cms';

describe('CMS 链接协议', () => {
  it('按 scheme 分层解析实体引用 / 站内路径 / 站外链接', () => {
    expect(parseCmsLink('entity:content/123')).toEqual({ kind: 'entity', entityType: 'content', id: 123, code: null });
    expect(parseCmsLink('entity:channel/45')).toEqual({ kind: 'entity', entityType: 'channel', id: 45, code: null });
    expect(parseCmsLink('internal:/news/')).toEqual({ kind: 'internal', path: '/news/' });
    expect(parseCmsLink('https://example.com')).toEqual({ kind: 'external', url: 'https://example.com' });
  });

  it('按栏目标识引用栏目（站点复制后仍有效的稳定写法）', () => {
    expect(parseCmsLink('entity:channel@news')).toEqual({ kind: 'entity', entityType: 'channel', id: null, code: 'news' });
    expect(parseCmsLink('entity:channel@notice-2')).toEqual({ kind: 'entity', entityType: 'channel', id: null, code: 'notice-2' });
    expect(buildCmsChannelCodeLink('news')).toBe('entity:channel@news');
    expect(isCmsEntityLink('entity:channel@news')).toBe(true);
    expect(isCmsSiteLink('entity:channel@news')).toBe(true);
    // 标识只允许小写字母/数字/中划线；内容不支持 @ 写法
    for (const bad of ['entity:channel@News', 'entity:channel@', 'entity:channel@a_b', 'entity:content@news']) {
      expect(parseCmsLink(bad)).toBeNull();
      expect(isValidCmsLink(bad)).toBe(false);
    }
  });

  it('只接受明确的站内路径或外链协议', () => {
    // 站内路径按站内链接处理
    expect(parseCmsLink('/files/download.zip')).toEqual({ kind: 'internal', path: '/files/download.zip' });
    // 协议相对地址不能按外链放行：浏览器会按当前协议加载任意域名
    expect(parseCmsLink('//cdn.example.com/a.js')).toBeNull();
    expect(parseCmsLink('mailto:hi@example.com')).toEqual({ kind: 'external', url: 'mailto:hi@example.com' });
    expect(parseCmsLink('  ')).toBeNull();
  });

  it.each([
    'javascript:alert(1)',
    'JAVASCRIPT:alert(1)',
    'data:text/html,<script>alert(1)</script>',
    'vbscript:msgbox(1)',
    'ftp://example.com/file',
    'www.example.com/path',
    'internal://evil.example/path',
    'internal:news',
    '/a/../secret',
    '/a/%2e%2e/secret',
    '/a/%2fsecret',
    '/a/%5csecret',
    '/a\\b',
    '/a\u0000b',
    'https://example.com/a b',
    'https://user:pass@example.com/private',
  ])('拒绝危险或含糊的链接 %s', (value) => {
    expect(parseCmsLink(value)).toBeNull();
    expect(isValidCmsLink(value)).toBe(false);
  });

  it('拒绝内部路径中的编码点段和双向控制字符', () => {
    expect(parseCmsLink('/a/%2E%2E/%E7%A7%98%E5%AF%86')).toBeNull();
    expect(parseCmsLink(`/a/\u202Etxt`)).toBeNull();
  });

  it('前缀正确但格式非法时判为非法，不降级成外链', () => {
    for (const bad of ['entity:content/abc', 'entity:foo/1', 'entity:content/0', 'internal:news']) {
      expect(parseCmsLink(bad)).toBeNull();
      expect(isValidCmsLink(bad)).toBe(false);
    }
    // 空值放行（链接字段本就可选）
    expect(isValidCmsLink('')).toBe(true);
    expect(isValidCmsLink(null)).toBe(true);
  });

  it('构造与判定辅助函数互为逆运算', () => {
    expect(buildCmsEntityLink('content', 7)).toBe('entity:content/7');
    expect(buildCmsInternalLink('news/')).toBe('internal:/news/');
    expect(isCmsEntityLink('entity:channel/2')).toBe(true);
    expect(isCmsEntityLink('https://a.com')).toBe(false);
    expect(isCmsSiteLink('/about.html')).toBe(true);
    expect(isCmsSiteLink('https://a.com')).toBe(false);
  });

  it('构造辅助函数不会生成不安全的链接', () => {
    expect(() => buildCmsChannelCodeLink('News')).toThrow();
    expect(() => buildCmsInternalLink('/a/../b')).toThrow();
    expect(() => buildCmsInternalLink('//evil.example')).toThrow();
  });

  it('站点导入时改写实体 id，映射缺失则置空而非错指同 id 记录', () => {
    const remap = remapCmsEntityLink('entity:content/10', (type, id) => (type === 'content' && id === 10 ? 99 : undefined));
    expect(remap).toBe('entity:content/99');
    // 目标未随包导入 → 置空，绝不能保留旧 id 指向本站不相干的记录
    expect(remapCmsEntityLink('entity:channel/10', () => undefined)).toBeNull();
    // 合法非实体链接原样透传
    expect(remapCmsEntityLink('https://a.com', () => 1)).toBe('https://a.com');
    // 按 code 引用无需重映射，这正是 code 相对 id 的价值
    expect(remapCmsEntityLink('entity:channel@news', () => undefined)).toBe('entity:channel@news');
    // 非法值不能借 remap 旁路重新进入持久化
    expect(remapCmsEntityLink('javascript:alert(1)', () => 1)).toBeNull();
  });

  it('渲染层解析链接，而非在写入时固化 URL（保证目标改 slug 后自动跟随）', async () => {
    const service = await readFile(new URL('./cms-link.service.ts', import.meta.url), 'utf8');
    expect(service).toContain('buildCmsLinkResolver');
    expect(service).toContain('MAX_HOPS');

    const render = await readFile(new URL('./cms-render.service.ts', import.meta.url), 'utf8');
    // 列表项 / 详情页 302 / 栏目页 302 / RSS 四个出口都必须走解析
    expect(render).toContain('resolveLink');
    expect(render).toContain('resolveCmsLink(site.id, baseUrl, row.externalLink)');
    expect(render).toContain('resolveCmsLink(site.id, baseUrl, channel.linkUrl)');
  });

  it('站点导入把 entity 链接里的 id 一并重映射', async () => {
    const source = await readFile(new URL('./cms-site-transfer.service.ts', import.meta.url), 'utf8');
    expect(source).toContain('remapCmsEntityLink');
    expect(source).toContain('contentIdMap');
    expect(source).toContain('channelIdMap');
  });
});
