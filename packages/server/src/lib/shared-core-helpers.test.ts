/**
 * @arcbase/shared/core 通用字符串 / 数值 / 树形工具单测（shared 包自身不带测试运行器，由 server 侧覆盖）。
 */
import { describe, expect, it } from 'vitest';
import { buildTree, clamp, escapeHtml, escapeRegExp, formatBytes, mapTree } from '@arcbase/shared/core';

describe('escapeHtml', () => {
  it('转义 HTML 文本与属性中的全部特殊字符', () => {
    expect(escapeHtml(`<a href="x&y" title='t'>`)).toBe('&lt;a href=&quot;x&amp;y&quot; title=&#39;t&#39;&gt;');
  });

  it('普通文本原样返回', () => {
    expect(escapeHtml('张三 & 李四')).toBe('张三 &amp; 李四');
    expect(escapeHtml('plain')).toBe('plain');
  });
});

describe('escapeRegExp', () => {
  it('转义后可作为字面量安全拼入正则', () => {
    const raw = 'a.b*c+d?e^f$g{h}i(j)k|l[m]n\\o';
    expect(new RegExp(`^${escapeRegExp(raw)}$`).test(raw)).toBe(true);
    expect(new RegExp(escapeRegExp('1.5')).test('105')).toBe(false);
  });
});

describe('clamp', () => {
  it('限制在闭区间内', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
  });

  it('非有限数按下界处理', () => {
    expect(clamp(Number.NaN, 0, 10)).toBe(0);
    expect(clamp(Number.POSITIVE_INFINITY, 0, 10)).toBe(0);
  });
});

describe('formatBytes', () => {
  it('按 1024 进位并保留一位小数，B 取整', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1536)).toBe('1.5 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(1.5 * 1024 ** 3)).toBe('1.5 GB');
    expect(formatBytes(2 * 1024 ** 4)).toBe('2.0 TB');
  });

  it('超过 TB 仍以 TB 表示', () => {
    expect(formatBytes(3000 * 1024 ** 4)).toBe('3000.0 TB');
  });

  it('空值、非正数与非有限数返回 0 B', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(-1)).toBe('0 B');
    expect(formatBytes(null)).toBe('0 B');
    expect(formatBytes(undefined)).toBe('0 B');
    expect(formatBytes(Number.NaN)).toBe('0 B');
  });
});

describe('buildTree', () => {
  interface Node { id: number; parentId: number | null; sort: number; children?: Node[] }

  it('按 id / parentId 挂接子节点，叶子不带 children 属性，且不修改入参对象', () => {
    const flat: Node[] = [
      { id: 1, parentId: null, sort: 1 },
      { id: 2, parentId: 1, sort: 1 },
      { id: 3, parentId: 1, sort: 2 },
      { id: 4, parentId: 3, sort: 1 },
    ];
    const tree = buildTree(flat);
    expect(tree).toEqual([{
      id: 1, parentId: null, sort: 1, children: [
        { id: 2, parentId: 1, sort: 1 },
        { id: 3, parentId: 1, sort: 2, children: [{ id: 4, parentId: 3, sort: 1 }] },
      ],
    }]);
    expect(tree[0].children![0]).not.toHaveProperty('children');
    expect(flat[0]).not.toHaveProperty('children');
  });

  it('parentId 为 0 / 空或父节点缺失时提升为根节点', () => {
    const tree = buildTree<Node>([
      { id: 1, parentId: 0, sort: 1 },
      { id: 2, parentId: 99, sort: 1 },
      { id: 3, parentId: undefined as unknown as null, sort: 1 },
    ]);
    expect(tree.map((n) => n.id)).toEqual([1, 2, 3]);
  });

  it('compare 逐层排序；keepEmptyChildren 保留叶子的空数组', () => {
    const tree = buildTree<Node>([
      { id: 1, parentId: null, sort: 2 },
      { id: 2, parentId: null, sort: 1 },
      { id: 3, parentId: 1, sort: 2 },
      { id: 4, parentId: 1, sort: 1 },
    ], { compare: (a, b) => a.sort - b.sort, keepEmptyChildren: true });
    expect(tree.map((n) => n.id)).toEqual([2, 1]);
    expect(tree[1].children!.map((n) => n.id)).toEqual([4, 3]);
    expect(tree[0].children).toEqual([]);
  });

  it('支持自定义键（如 code / parentCode），空字符串父键视为根', () => {
    interface Region { code: string; parentCode: string | null; children?: Region[] }
    const tree = buildTree<Region>([
      { code: '11', parentCode: '' },
      { code: '1101', parentCode: '11' },
      { code: '12', parentCode: null },
    ], { id: (r) => r.code, parentId: (r) => r.parentCode || null });
    expect(tree.map((n) => n.code)).toEqual(['11', '12']);
    expect(tree[0].children!.map((n) => n.code)).toEqual(['1101']);
  });
});

describe('mapTree', () => {
  it('递归映射节点并保留层级；无 children 的节点输出 children: undefined', () => {
    interface Src { id: number; name: string; children?: Src[] }
    interface Out { key: string; label: string; children?: Out[] }
    const out = mapTree<Src, Out>(
      [{ id: 1, name: 'a', children: [{ id: 2, name: 'b' }] }, { id: 3, name: 'c', children: [] }],
      (n) => ({ key: String(n.id), label: n.name }),
    );
    expect(out).toEqual([
      { key: '1', label: 'a', children: [{ key: '2', label: 'b', children: undefined }] },
      { key: '3', label: 'c', children: [] },
    ]);
  });
});
