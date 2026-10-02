/**
 * Iconify 图标静态化的公共逻辑：扫描源码里的图标字面量、从本地 @iconify-json 集合抽取数据、
 * 产出 SVG 文件 / 单色图标模块的内容。CLI 入口是同目录上一级的 gen-iconify-assets.mjs，
 * 守卫测试（src/components/icons/iconify-assets.test.ts）复用这里的扫描与抽取，保证生成物与源码引用一致。
 *
 * 分两类输出：
 * - 彩色文件类型图标（vscode-icons）：每个图标一个 SVG 文件，运行时经 <img> 按需下载（169 个全量约 700 KB，
 *   打进 bundle 反而更差），文件名含内容 hash 走 immutable 缓存；
 * - 单色图标（simple-icons / ant-design / icon-park-outline / codicon）：currentColor 需跟随文字颜色，
 *   <img> 不继承颜色，因此内联为数据对象经 MonoIcon 渲染。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { getIconData, iconToHTML, iconToSVG } from '@iconify/utils';

/** 已登记的图标集：前缀 → 数据包。引用未登记前缀的图标会让生成器 / 守卫测试失败 */
export const COLLECTIONS = Object.freeze({
  'vscode-icons': '@iconify-json/vscode-icons',
  'simple-icons': '@iconify-json/simple-icons',
  'ant-design': '@iconify-json/ant-design',
  'icon-park-outline': '@iconify-json/icon-park-outline',
  codicon: '@iconify-json/codicon',
});

/** 彩色文件类型图标集（输出为 SVG 文件） */
export const FILE_ICON_PREFIX = 'vscode-icons';

/** 常见 Iconify 集合前缀：源码里出现这些前缀但未登记到 COLLECTIONS 时报错，避免静默空白 */
const KNOWN_ICONIFY_PREFIXES = new Set([
  ...Object.keys(COLLECTIONS),
  'mdi', 'mdi-light', 'tabler', 'lucide', 'ph', 'carbon', 'fluent', 'material-symbols', 'ri', 'bi', 'heroicons',
  'octicon', 'logos', 'devicon', 'flat-color-icons', 'noto', 'twemoji', 'catppuccin', 'skill-icons', 'fa6-solid',
  'fa6-regular', 'fa6-brands', 'ic', 'uil', 'solar', 'iconoir', 'hugeicons', 'streamline',
]);

const ICON_LITERAL_RE = /(['"`])([a-z][a-z0-9-]*):([a-z0-9][a-z0-9-]*)\1/g;

const DEFAULT_EXCLUDES = [/\.test\.[cm]?[jt]sx?$/, /[\\/]components[\\/]icons[\\/]generated[\\/]/, /[\\/]assets[\\/]/];

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.[cm]?[jt]sx?$/.test(entry.name)) out.push(full);
  }
  return out;
}

/**
 * 扫描 src 下全部 ts/tsx 的 `'prefix:name'` 字面量。
 * 返回已登记集合的图标 id、以及出现了但未登记的 Iconify 前缀（来源文件一并给出，方便定位）。
 */
export function scanIconLiterals(srcDir, excludes = DEFAULT_EXCLUDES) {
  const ids = new Map(); // id -> Set<file>
  const unregistered = new Map(); // prefix -> Set<file>
  for (const file of walk(srcDir)) {
    if (excludes.some((re) => re.test(file))) continue;
    const source = fs.readFileSync(file, 'utf8');
    for (const match of source.matchAll(ICON_LITERAL_RE)) {
      const [, , prefix, name] = match;
      const rel = path.relative(srcDir, file).replaceAll('\\', '/');
      if (prefix in COLLECTIONS) {
        const id = `${prefix}:${name}`;
        if (!ids.has(id)) ids.set(id, new Set());
        ids.get(id).add(rel);
      } else if (KNOWN_ICONIFY_PREFIXES.has(prefix)) {
        if (!unregistered.has(prefix)) unregistered.set(prefix, new Set());
        unregistered.get(prefix).add(rel);
      }
    }
  }
  return { ids, unregistered };
}

export function loadIconSet(prefix, requireFrom = import.meta.url) {
  const require = createRequire(requireFrom);
  const pkg = COLLECTIONS[prefix];
  const iconSet = require(`${pkg}/icons.json`);
  const { version } = require(`${pkg}/package.json`);
  return { iconSet, version, pkg };
}

/**
 * 文件夹图标的展开态：getFolderIcon(name, true) 在运行时拼出 `${base}-opened`，
 * 源码里没有该字面量，这里按规则补齐（集合里存在才加）。
 */
export function folderOpenedVariant(id) {
  const [prefix, name] = id.split(':');
  if (prefix !== FILE_ICON_PREFIX) return null;
  if (name !== 'default-folder' && !name.startsWith('folder-type-')) return null;
  if (name.endsWith('-opened')) return null;
  return `${prefix}:${name}-opened`;
}

/**
 * 按扫描结果从本地集合抽取图标。返回：
 * - fileIcons：Map<name, svg>（vscode-icons，含 -opened 变体）
 * - monoIcons：Map<id, { body, width, height }>
 * - sources：Record<pkg, version>
 * - missing：集合里不存在的 id 列表
 */
export function extractIcons(ids, requireFrom = import.meta.url) {
  const sets = new Map();
  const sources = {};
  const setFor = (prefix) => {
    if (!sets.has(prefix)) {
      const loaded = loadIconSet(prefix, requireFrom);
      sets.set(prefix, loaded.iconSet);
      sources[loaded.pkg] = loaded.version;
    }
    return sets.get(prefix);
  };

  const wanted = new Set(ids);
  for (const id of ids) {
    const variant = folderOpenedVariant(id);
    if (variant && getIconData(setFor(FILE_ICON_PREFIX), variant.split(':')[1])) wanted.add(variant);
  }

  const fileIcons = new Map();
  const monoIcons = new Map();
  const missing = [];
  for (const id of [...wanted].sort()) {
    const [prefix, name] = id.split(':');
    const data = getIconData(setFor(prefix), name);
    if (!data) {
      missing.push(id);
      continue;
    }
    const rendered = iconToSVG(data, { height: 'auto' });
    if (prefix === FILE_ICON_PREFIX) {
      fileIcons.set(name, `${iconToHTML(rendered.body, rendered.attributes)}\n`);
    } else {
      monoIcons.set(id, {
        body: rendered.body,
        width: Number(rendered.attributes.width),
        height: Number(rendered.attributes.height),
      });
    }
  }
  // 登记了但本轮未用到的集合也记录版本，守卫测试按 COLLECTIONS 全量对齐
  for (const prefix of Object.keys(COLLECTIONS)) setFor(prefix);
  return { fileIcons, monoIcons, sources, missing };
}

export function renderMonoModule(monoIcons) {
  const entries = [...monoIcons.entries()].map(([id, icon]) =>
    `  ${JSON.stringify(id)}: { body: ${JSON.stringify(icon.body)}, width: ${icon.width}, height: ${icon.height} },`);
  return [
    '// 由 scripts/gen-iconify-assets.mjs 生成，勿手改；新增图标字面量后运行 `npm run icons:iconify -w @arcbase/web`。',
    '// 单色图标内联为数据（currentColor 需跟随文字颜色，<img> 不继承），经 components/icons/MonoIcon 渲染。',
    "import type { MonoIconData } from '../MonoIcon';",
    '',
    'export const MONO_ICONS = {',
    ...entries,
    '} as const satisfies Record<string, MonoIconData>;',
    '',
    'export type MonoIconId = keyof typeof MONO_ICONS;',
    '',
  ].join('\n');
}

export function renderManifest({ fileIcons, monoIcons, sources }) {
  return `${JSON.stringify({
    $comment: '由 scripts/gen-iconify-assets.mjs 生成：图标来源包版本与产出清单，守卫测试据此校验生成物与源码引用 / 安装版本一致。',
    sources,
    fileIcons: [...fileIcons.keys()],
    monoIcons: [...monoIcons.keys()],
  }, null, 2)}\n`;
}
