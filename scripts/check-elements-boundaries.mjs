import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const errors = [];
function visit(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!/\.tsx?$/.test(entry.name) || entry.name.includes('.test.')) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    function check(node) {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        if (spec.startsWith('@zenith/') && spec !== '@zenith/client' && !spec.startsWith('@zenith/shared/')) errors.push(`${relative(root, path)}: forbidden dependency ${spec}`);
        if (spec.startsWith('@/') || /(?:^|\/)packages\/(?:web|server|admin)\//.test(spec)) errors.push(`${relative(root, path)}: application source dependency ${spec}`);
      }
      if (ts.isIdentifier(node) && ['localStorage', 'sessionStorage', 'BroadcastChannel'].includes(node.text)) errors.push(`${relative(root, path)}: host persistence belongs to the session adapter`);
      ts.forEachChild(node, check);
    }
    check(source);
  }
}
visit(resolve(root, 'packages/elements/src'));
for (const name of ['shared', 'client', 'server', 'analytics-sdk']) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'packages', name, 'package.json'), 'utf8'));
  if (pkg.dependencies?.['@zenith/elements']) errors.push(`${name}: reverse elements dependency`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Elements boundaries passed: shared -> client -> elements -> web -> admin.');
