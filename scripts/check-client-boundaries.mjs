import { readFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import ts from 'typescript';

const root = resolve(import.meta.dirname, '..');
const clientRoot = resolve(root, 'packages/client');
const manifest = JSON.parse(readFileSync(resolve(clientRoot, 'package.json'), 'utf8'));
const errors = [];
if (Object.keys(manifest.dependencies ?? {}).some(name => name !== '@arcbase/shared')) errors.push('client runtime dependencies must only contain shared');
const visit = dir => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = resolve(dir, entry.name);
    if (entry.isDirectory()) { visit(path); continue; }
    if (!entry.name.endsWith('.ts') || entry.name.endsWith('.test.ts')) continue;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true);
    const check = node => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
        const spec = node.moduleSpecifier.text;
        const allowed = spec.startsWith('./') || spec.startsWith('@arcbase/shared/');
        if (!allowed) errors.push(`${relative(root, path)}: forbidden dependency ${spec}`);
      }
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) errors.push(`${relative(root, path)}: dynamic imports are not part of client`);
      if (ts.isIdentifier(node) && ['localStorage', 'sessionStorage', 'dispatchEvent', 'document', 'window'].includes(node.text)) errors.push(`${relative(root, path)}: host state/UI API ${node.text}`);
      ts.forEachChild(node, check);
    };
    check(source);
  }
};
visit(resolve(clientRoot, 'src'));
for (const domain of ['shared', 'server', 'analytics-sdk']) {
  const pkg = JSON.parse(readFileSync(resolve(root, 'packages', domain, 'package.json'), 'utf8'));
  if (pkg.dependencies?.['@arcbase/client']) errors.push(`${domain} must not depend on client`);
}
if (errors.length) { console.error(errors.join('\n')); process.exitCode = 1; }
else console.log('Client boundaries passed: shared -> client -> web; no UI or browser storage dependencies.');
