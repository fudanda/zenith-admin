import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '..');
const packages = {
  'client': [],
  'admin-modules': [],
  'admin-ui': [],
  'admin-core': ['client'],
  'admin-pages': ['client', 'admin-core', 'admin-ui'],
  'admin-app': ['client', 'admin-core', 'admin-modules', 'admin-pages', 'admin-ui'],
  'dash': ['admin-app'],
};
const directory = (name) => name === 'dash' ? path.join(root, 'apps/dash/src') : path.join(root, 'packages', name, 'src');
const failures = [];

function scan(name, dir, base = dir) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    const filename = path.join(dir, item.name);
    if (item.isDirectory()) { scan(name, filename, base); continue; }
    if (!/\.[cm]?[jt]sx?$/.test(item.name)) continue;
    const source = fs.readFileSync(filename, 'utf8');
    const references = [...source.matchAll(/(?:\b(?:import|export)\s+(?:[^'";]*?\s+from\s*)?|\bimport\s*\()\s*['"]([^'"]+)['"]/g)];
    for (const [, specifier] of references) {
      const match = /^@zenith\/(admin-(?:app|core|modules|pages|ui)|client)(?:\/|$)/.exec(specifier);
      const dependency = match?.[1];
      if (dependency && !packages[name].includes(dependency)) failures.push(`${path.relative(root,filename)} imports forbidden ${dependency}`);
      if (specifier.startsWith('@zenith/web') || specifier.startsWith('@zenith/server')) failures.push(`${path.relative(root,filename)} imports legacy runtime ${specifier}`);
      if (specifier.startsWith('.')) {
        const resolved = path.resolve(path.dirname(filename),specifier);
        if (!resolved.startsWith(base + path.sep) && resolved !== base) failures.push(`${path.relative(root,filename)} crosses package boundary: ${specifier}`);
      }
    }
  }
}

for (const name of Object.keys(packages)) scan(name, directory(name));
if (failures.length) { console.error(failures.join('\n')); process.exitCode = 1; }
else console.log('Dashboard package boundaries: OK');
