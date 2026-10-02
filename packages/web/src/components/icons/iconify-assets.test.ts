/**
 * Iconify 静态资产守卫：源码引用、生成物、安装的图标集版本三者必须一致。
 *
 * 生成物由 scripts/gen-iconify-assets.mjs 产出并提交入库；任何一环脱节都在这里暴露，而不是线上空白图标：
 * - 新增 / 删除图标字面量但没有重新生成
 * - 升级 @iconify-json/* 但没有重新生成（视觉可能已变，须经 PR 审阅 SVG diff）
 * - 使用了未登记的图标集前缀（此前经 @iconify/react 运行时拉取时会静默失败）
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import { COLLECTIONS, extractIcons, renderManifest, renderMonoModule, scanIconLiterals } from '../../../scripts/iconify-assets/lib.mjs';

const srcDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const fileIconsDir = path.join(srcDir, 'assets', 'file-icons');
const manifestPath = path.join(fileIconsDir, 'manifest.json');
const monoModulePath = path.join(srcDir, 'components', 'icons', 'generated', 'mono-icons.ts');
const REGEN_HINT = '运行 `npm run icons:iconify -w @arcbase/web` 重新生成并提交';

describe('Iconify 静态资产', () => {
  const { ids, unregistered } = scanIconLiterals(srcDir);
  const extracted = extractIcons([...ids.keys()], import.meta.url);

  it('源码只引用已登记集合里存在的图标', () => {
    expect([...unregistered.entries()].map(([prefix, files]) => `${prefix} ← ${[...files].join(', ')}`)).toEqual([]);
    expect(extracted.missing).toEqual([]);
  });

  it('清单与单色图标模块与源码引用一致', () => {
    expect(fs.existsSync(manifestPath), `缺少 manifest.json，${REGEN_HINT}`).toBe(true);
    expect(fs.readFileSync(manifestPath, 'utf8'), `manifest.json 过期，${REGEN_HINT}`).toBe(renderManifest(extracted));
    expect(fs.readFileSync(monoModulePath, 'utf8'), `mono-icons.ts 过期，${REGEN_HINT}`).toBe(renderMonoModule(extracted.monoIcons));
  });

  it('SVG 文件与清单逐一对应（无缺失、无多余、内容一致）', () => {
    const onDisk = fs.readdirSync(fileIconsDir).filter((f) => f.endsWith('.svg')).map((f) => f.slice(0, -'.svg'.length)).sort();
    expect(onDisk, `SVG 文件集合与源码引用不一致，${REGEN_HINT}`).toEqual([...extracted.fileIcons.keys()]);
    for (const [name, svg] of extracted.fileIcons) {
      expect(fs.readFileSync(path.join(fileIconsDir, `${name}.svg`), 'utf8'), `${name}.svg 内容过期，${REGEN_HINT}`).toBe(svg);
    }
  });

  it('清单记录的图标集版本 = 当前安装版本（升级包后必须重新生成）', () => {
    const require = createRequire(import.meta.url);
    const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as { sources: Record<string, string> };
    const installed = Object.fromEntries(Object.values(COLLECTIONS).map((pkg) => [pkg, (require(`${pkg}/package.json`) as { version: string }).version]));
    expect(manifest.sources, `图标集已升级但生成物未更新，${REGEN_HINT}`).toEqual(installed);
  });
});
