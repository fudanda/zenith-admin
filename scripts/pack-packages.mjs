import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const directory = resolve(root, 'release_artifacts/packages');
mkdirSync(directory, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Use npm run pack:packages');
// A TS project check can re-emit extensionless imports. Normalize the ESM
// outputs immediately before packing so plain Node can consume every archive.
execFileSync(process.execPath, [npm, 'run', 'build:packages:core'], { cwd: root, stdio: 'inherit' });
const packages = [];
for (const name of ['shared', 'client', 'elements', 'admin']) {
  const output = execFileSync(process.execPath, [npm, 'pack', '--json', '--ignore-scripts', '--pack-destination', directory], { cwd: resolve(root, 'packages', name), encoding: 'utf8' });
  const [metadata] = JSON.parse(output);
  if (metadata.files.some(file => /(?:^|\/)(?:\.env|node_modules|\.tsbuildinfo)|\.test\.[jt]sx?$/.test(file.path))) throw new Error(`Unexpected private/test content in ${name}`);
  for (const path of ['dist/index.js', 'dist/index.d.ts']) if (!metadata.files.some(file => file.path === path)) throw new Error(`Missing ${name} ${path}`);
  const archive = resolve(directory, metadata.filename);
  packages.push({ name: metadata.name, version: metadata.version, filename: metadata.filename, sha256: createHash('sha256').update(readFileSync(archive)).digest('hex'), files: metadata.files.length, bytes: metadata.size });
}
writeFileSync(resolve(directory, 'index.json'), JSON.stringify({ createdAt: new Date().toISOString(), packages }, null, 2));
console.log(JSON.stringify({ directory, packages }, null, 2));
