/**
 * 页签标题 / 图标的路径解析回归。
 *
 * 两个曾经出错的点：
 * 1. 图标只做精确查表，而标题有前缀回退 —— `/workflow/designer/new` 有标题却没图标。
 * 2. 前缀回退取「首个匹配」而非「最长匹配」—— `/workflow/forms/designer/5` 会落到
 *    父级菜单「表单库」，而不是「表单设计」。
 */
import { describe, expect, it } from 'vitest';
import { renderHook } from '@testing-library/react';
import type { Menu } from '@arcbase/shared/identity';
import { useMenuMaps } from './useMenuDerived';

function menu(partial: Partial<Menu> & Pick<Menu, 'id' | 'title'>): Menu {
  return {
    parentId: 0, type: 'menu', status: 'enabled', visible: true, sort: 0,
    createdAt: '', updatedAt: '', ...partial,
  } as Menu;
}

const MENU_TREE: Menu[] = [
  menu({
    id: 4000,
    title: '工作流引擎',
    type: 'directory',
    children: [
      menu({
        id: 4020,
        title: '流程定义',
        path: '/workflow/definitions',
        icon: 'Workflow',
        children: [
          // 隐藏设计页：实际访问路径带动态参数（/workflow/designer/1、/workflow/designer/new）
          menu({ id: 4030, parentId: 4020, title: '流程设计', path: '/workflow/designer', icon: 'PencilRuler', visible: false }),
        ],
      }),
      menu({
        id: 4050,
        title: '表单库',
        path: '/workflow/forms',
        icon: 'LayoutList',
        children: [
          menu({ id: 4060, parentId: 4050, title: '表单设计', path: '/workflow/forms/designer', icon: 'PencilRuler', visible: false }),
        ],
      }),
    ],
  }),
];

describe('useMenuMaps 路径解析', () => {
  it('精确匹配菜单路径', () => {
    const { result } = renderHook(() => useMenuMaps(MENU_TREE));
    expect(result.current.resolveTitle('/workflow/definitions')).toBe('流程定义');
    expect(result.current.resolveIcon('/workflow/definitions')).toBe('Workflow');
  });

  it('带动态参数的路径回退到菜单本身，标题与图标一致', () => {
    const { result } = renderHook(() => useMenuMaps(MENU_TREE));
    expect(result.current.resolveTitle('/workflow/designer/new')).toBe('流程设计');
    expect(result.current.resolveIcon('/workflow/designer/new')).toBe('PencilRuler');
  });

  it('多个前缀命中时取最长的那个', () => {
    const { result } = renderHook(() => useMenuMaps(MENU_TREE));
    // /workflow/forms 与 /workflow/forms/designer 都是前缀，必须落在后者
    expect(result.current.resolveTitle('/workflow/forms/designer/5')).toBe('表单设计');
    expect(result.current.resolveIcon('/workflow/forms/designer/5')).toBe('PencilRuler');
  });

  it('无匹配时标题回落为路径本身、图标为空', () => {
    const { result } = renderHook(() => useMenuMaps(MENU_TREE));
    expect(result.current.resolveTitle('/unknown/page')).toBe('/unknown/page');
    expect(result.current.resolveIcon('/unknown/page')).toBeUndefined();
  });
});
