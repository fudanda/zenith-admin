#!/usr/bin/env node
/**
 * 把源码里引用的 Iconify 图标静态化为仓库内资产（替代 @iconify/react 运行时从公网 API 拉取图标数据）：
 *
 *   npm run icons:iconify -w @arcbase/web            # 重新生成
 *   npm run icons:iconify -w @arcbase/web -- --check # 只校验，生成物过期则 exit 1（CI / 守卫测试同一口径）
 *
 * 产出：
 * - src/assets/file-icons/<name>.svg           彩色文件类型图标（vscode-icons，含文件夹 -opened 变体），<img> 按需加载
 * - src/assets/file-icons/manifest.json        来源包版本 + 图标清单
 * - src/components/icons/generated/mono-icons.ts 单色图标数据（内联渲染，跟随 currentColor）
 *
 * 升级 @iconify-json/* 后重新运行；引用了集合里不存在的图标、或使用了未登记的图标集前缀时直接失败。
 * 输出确定性（按名排序、无时间戳）：同一输入的 diff 为零。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { extractIcons, renderManifest, renderMonoModule, scanIconLiterals } from './iconify-assets/lib.mjs';

const webRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const srcDir = path.join(webRoot, 'src');
const fileIconsDir = path.join(srcDir, 'assets', 'file-icons');
const manifestPath = path.join(fileIconsDir, 'manifest.json');
const monoModulePath = path.join(srcDir, 'components', 'icons', 'generated', 'mono-icons.ts');
const checkOnly = process.argv.includes('--check');

const { ids, unregistered } = scanIconLiterals(srcDir);
if (unregistered.size > 0) {
  for (const [prefix, files] of unregistered) {
    console.error(`✖ 图标集 "${prefix}" 未登记：${[...files].join(', ')}`);
  }
  console.error('  在 scripts/iconify-assets/lib.mjs 的 COLLECTIONS 增加对应 @iconify-json 包，或改用 lucide-react。');
  process.exit(1);
}

const { fileIcons, monoIcons, sources, missing } = extractIcons([...ids.keys()]);
if (missing.length > 0) {
  for (const id of missing) console.error(`✖ 图标不存在：${id}（${[...(ids.get(id) ?? [])].join(', ')}）`);
  process.exit(1);
}

const expected = new Map();
for (const [name, svg] of fileIcons) expected.set(path.join(fileIconsDir, `${name}.svg`), svg);
expected.set(manifestPath, renderManifest({ fileIcons, monoIcons, sources }));
expected.set(monoModulePath, renderMonoModule(monoIcons));

const stale = fs.existsSync(fileIconsDir)
  ? fs.readdirSync(fileIconsDir).filter((f) => f.endsWith('.svg')).map((f) => path.join(fileIconsDir, f)).filter((p) => !expected.has(p))
  : [];
const changed = [...expected].filter(([file, content]) => !fs.existsSync(file) || fs.readFileSync(file, 'utf8') !== content);

if (checkOnly) {
  if (changed.length === 0 && stale.length === 0) {
    console.log(`✔ Iconify 资产与源码一致：${fileIcons.size} 个文件图标、${monoIcons.size} 个单色图标`);
    process.exit(0);
  }
  for (const [file] of changed) console.error(`✖ 过期 / 缺失：${path.relative(webRoot, file)}`);
  for (const file of stale) console.error(`✖ 多余：${path.relative(webRoot, file)}`);
  console.error('  运行 `npm run icons:iconify -w @arcbase/web` 重新生成。');
  process.exit(1);
}

fs.mkdirSync(fileIconsDir, { recursive: true });
fs.mkdirSync(path.dirname(monoModulePath), { recursive: true });
for (const [file, content] of changed) fs.writeFileSync(file, content, 'utf8');
for (const file of stale) fs.unlinkSync(file);
console.log(`✔ 生成 ${fileIcons.size} 个文件图标、${monoIcons.size} 个单色图标（更新 ${changed.length} 个文件，删除 ${stale.length} 个）`);
