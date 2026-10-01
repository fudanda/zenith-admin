import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const errors = [];
const packages = ['shared', 'client', 'elements', 'web', 'admin'];
for (const name of packages) {
  const manifest = JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'));
  if (name !== 'admin' && [...Object.keys(manifest.dependencies ?? {}), ...Object.keys(manifest.devDependencies ?? {})].includes('@zenith/admin')) errors.push(`${name} must not depend on admin`);
}
function visit(dir, owner) {
  for (const item of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, item.name);
    if (item.isDirectory()) { visit(path, owner); continue; }
    if (!/\.[cm]?tsx?$/.test(item.name) || item.name.includes('.test.')) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (owner !== 'admin' && /^@zenith\/admin(?:\/|$)/.test(spec)) errors.push(`${relative(root, path)}: reverse admin dependency`);
        if (owner === 'admin' && spec.startsWith('@zenith/') && !['@zenith/web/admin', '@zenith/client'].includes(spec)) errors.push(`${relative(root, path)}: forbidden admin dependency ${spec}`);
      }
      ts.forEachChild(node, check);
    };
    check(source);
  }
}
for (const name of packages) visit(resolve(root, 'packages', name, 'src'), name);
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Admin boundaries passed: shared -> client -> elements -> web -> admin; original pages stay in web.');
