#!/usr/bin/env node
/**
 * 生产化 @arcbase/shared 的 package.json:把 exports/main/types 从 TS 源码指向编译产物。
 *
 * 源码 exports 指向 ./src/*.ts(供 tsx dev / Vite 直接消费);纯 Node 运行 dist 时
 * 无法执行 TS,需要把每个入口机械改写为 ./dist/*.js(目录型域入口如
 * "./analytics" → "./dist/analytics/index.js" 由原值 "./src/analytics/index.ts" 自然得出,
 * 无需硬编码域清单)。构建产物中的相对导入扩展名由 tsc-alias 在包构建时处理。
 *
 * 用法:node docker/patch-shared-exports.mjs [shared-pkg-dir]
 * (默认 packages/shared;Docker builder 阶段在构建完成后调用)
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const pkgDir = resolve(process.argv[2] ?? 'packages/shared');
const pkgPath = join(pkgDir, 'package.json');
const pkg = JSON.parse(readFileSync(pkgPath, 'utf8'));

const toDist = (value) => value.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.js');

pkg.main = toDist(pkg.main);
if (pkg.types) pkg.types = pkg.types.replace(/^\.\/src\//, './dist/').replace(/\.ts$/, '.d.ts');
for (const key of Object.keys(pkg.exports)) {
  pkg.exports[key] = toDist(pkg.exports[key]);
}

writeFileSync(pkgPath, `${JSON.stringify(pkg, null, '\t')}\n`);
console.log(`[patch-shared-exports] ${pkgPath}: exports → dist (${Object.keys(pkg.exports).length} entries)`);
