/**
 * 权限码注册表与服务端引用的一致性（静态扫描）：
 *  1. 注册表里未标 `uiOnly` 的码，服务端（路由 / 服务 / lib / 中间件）或 shared 设置模块至少引用一次；
 *  2. 标了 `uiOnly` 的码不得再被服务端引用——加了接口检查就必须去掉 `uiOnly`，矩阵审计 Tab 才不会把它算作纯前端权限。
 * 类型系统已保证服务端出现的每个字面量都在注册表（`guard` / `mountCrud` / `hasPermission` 参数为 `Permission`），
 * 这里补的是反方向：注册表里的码是否真的有接口在检查。
 */
import fs from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { ALL_PERMISSIONS } from '@arcbase/shared/permissions';

const SERVER_SRC = path.resolve(__dirname);
const SHARED_SRC = path.resolve(__dirname, '../../shared/src');
const MOUNT_CRUD_SUFFIXES = ['list', 'create', 'update', 'delete'];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.ts$/.test(entry.name) && !/\.(test|typecheck)\.ts$/.test(entry.name)) out.push(full);
  }
  return out;
}

function collectReferencedCodes(): Set<string> {
  const codes = new Set(Object.keys(ALL_PERMISSIONS));
  const referenced = new Set<string>();
  const literal = /['"`]([a-z][a-z0-9-]*(?::[a-zA-Z0-9-]+){1,3})['"`]/g;
  const files = [
    ...walk(SERVER_SRC),
    // shared 里的设置模块用 readPermission / writePermission 声明接口权限；种子与注册表自身不算引用
    ...walk(SHARED_SRC).filter((f) => !f.includes(`${path.sep}seed${path.sep}`) && !/permissions\.ts$/.test(f)),
  ];
  for (const file of files) {
    const text = fs.readFileSync(file, 'utf8');
    for (const match of text.matchAll(literal)) {
      const value = match[1];
      if (codes.has(value)) referenced.add(value);
      // mountCrud({ permission: '<prefix>' }) 按约定后缀派生
      else for (const suffix of MOUNT_CRUD_SUFFIXES) if (codes.has(`${value}:${suffix}`)) referenced.add(`${value}:${suffix}`);
    }
  }
  return referenced;
}

describe('权限码注册表 ⟷ 服务端引用', () => {
  const referenced = collectReferencedCodes();

  it('非 uiOnly 的权限码都有接口在检查', () => {
    const unreferenced = Object.entries(ALL_PERMISSIONS)
      .filter(([code, meta]) => !meta.uiOnly && !referenced.has(code))
      .map(([code]) => code);
    expect(
      unreferenced,
      '以下权限码没有任何服务端接口检查：给对应接口补 guard，或确认为纯前端门控后在注册表标 uiOnly: true',
    ).toEqual([]);
  });

  it('uiOnly 的权限码不再被服务端引用', () => {
    const stale = Object.entries(ALL_PERMISSIONS)
      .filter(([code, meta]) => meta.uiOnly && referenced.has(code))
      .map(([code]) => code);
    expect(stale, '以下权限码已有接口检查，请去掉注册表里的 uiOnly').toEqual([]);
  });
});
