import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync, realpathSync } from 'node:fs';
import { resolve, dirname, basename, relative, isAbsolute } from 'node:path';
import { createHash, randomBytes } from 'node:crypto';

export const toolRoot = resolve(import.meta.dirname, '..');
function freshDirectory(path) {
  if (existsSync(path)) throw new Error('Target already exists; choose a new directory');
  let parent = dirname(path); while (!existsSync(parent)) parent = dirname(parent);
  if (realpathSync(parent).toLowerCase() !== resolve(parent).toLowerCase()) throw new Error('Target parent must not traverse a symbolic link');
}
export function createProject(target, { database, brand = 'Zenith Admin' } = {}) {
  if (!['sqlite', 'postgres'].includes(database)) throw new Error('Choose --database sqlite or postgres explicitly');
  if (typeof brand !== 'string' || !brand.trim() || brand.length > 64) throw new Error('Brand must contain 1-64 characters');
  freshDirectory(target);
  const runtime = resolve(toolRoot, '.runtime');
  if (!existsSync(resolve(runtime, 'npm/index.json'))) throw new Error('Tool delivery is not built; run npm run pack:packages in the Zenith repository');
  const packages = JSON.parse(readFileSync(resolve(runtime, 'npm/index.json'), 'utf8')).packages;
  const sdk=JSON.parse(readFileSync(resolve(runtime,'sdk.json'),'utf8'));
  for(const file of sdk.files){const path=resolve(runtime,'backend',file.path);const rel=relative(resolve(runtime,'backend'),path);if(isAbsolute(rel)||rel.startsWith('..')||lstatSync(path).isSymbolicLink()||createHash('sha256').update(readFileSync(path)).digest('hex')!==file.sha256)throw new Error('Go SDK delivery checksum failed');}
  for (const pkg of packages) {
    if (!/^zenith-[a-z]+-[0-9.]+\.tgz$/.test(pkg.filename)) throw new Error('Invalid package manifest');
    const digest = createHash('sha256').update(readFileSync(resolve(runtime, 'npm', pkg.filename))).digest('hex');
    if (digest !== pkg.sha256) throw new Error('Package delivery checksum failed');
  }
  mkdirSync(target, { recursive: true });
  cpSync(resolve(toolRoot, 'templates/project'), target, { recursive: true });
  cpSync(resolve(runtime, 'backend'), resolve(target, 'vendor/zenith'), { recursive: true });
  cpSync(resolve(runtime,'sdk.json'),resolve(target,'vendor/zenith-sdk.json'));
  mkdirSync(resolve(target, 'vendor/npm'), { recursive: true });
  for (const pkg of packages) cpSync(resolve(runtime, 'npm', pkg.filename), resolve(target, 'vendor/npm', pkg.filename));
  const manifest = JSON.parse(readFileSync(resolve(target, 'package.json'), 'utf8'));
  manifest.name = basename(target).toLowerCase().replace(/[^a-z0-9-]/g, '-') || 'zenith-host';
  for (const pkg of packages) manifest.dependencies[pkg.name] = `file:./vendor/npm/${pkg.filename}`;
  writeFileSync(resolve(target, 'package.json'), JSON.stringify(manifest, null, 2) + '\n');
  const backendModule = `example.org/${manifest.name}/backend`;
  writeFileSync(resolve(target, 'backend/go.mod'), `module ${backendModule}\n\ngo 1.27.1\n\nrequire github.com/fudanda/zenith-admin/backend v0.0.0\n\nreplace github.com/fudanda/zenith-admin/backend => ../vendor/zenith\n`);
  writeFileSync(resolve(target, 'zenith.project.json'), JSON.stringify({ format: 1, backendModule, database, brand, sdk:{version:sdk.version,commit:sdk.commit,sha256:sdk.sha256}, modules: [] }, null, 2) + '\n');
  writeFileSync(resolve(target, 'frontend/brand.json'), JSON.stringify({ name: brand }) + '\n');
  mkdirSync(resolve(target, 'storage/uploads'), { recursive: true });
  const dsn = database === 'sqlite' ? 'sqlite:' + resolve(target, 'storage/zenith.db').replaceAll('\\', '/') : 'postgres://USER:CHANGE_ME@127.0.0.1:5432/zenith?sslmode=disable';
  const env = `ZENITH_DATABASE_URL=${JSON.stringify(dsn)}\nZENITH_ADDR=127.0.0.1:8080\nZENITH_INSECURE_COOKIES=true\nZENITH_STORAGE_KEY=${randomBytes(32).toString('hex')}\nZENITH_FILE_STAGING_PATH=${JSON.stringify(resolve(target, 'storage/uploads').replaceAll('\\', '/'))}\n`;
  writeFileSync(resolve(target, '.env'), env, { mode: 0o600 });
  writeFileSync(resolve(target,'.env.example'),`ZENITH_DATABASE_URL=${database==='sqlite'?'sqlite:./storage/zenith.db':'postgres://USER:CHANGE_ME@127.0.0.1:5432/zenith?sslmode=disable'}\nZENITH_ADDR=127.0.0.1:8080\nZENITH_INSECURE_COOKIES=true\nZENITH_FILE_STAGING_PATH=./storage/uploads\n# Set 64 random hex characters before configuring S3.\nZENITH_STORAGE_KEY=\n`);
  writeFileSync(resolve(target, '.gitignore'), 'node_modules/\ndist/\nbackend/dashboard/*\n!backend/dashboard/README.txt\nbackend/bin/\n.env\n.env.*\n!.env.example\nstorage/\nbackups/\n*.db*\n');
  return { project: target, database, next: ['npm install', 'npm run build', 'npm run db:migrate', 'npm run db:seed', 'npm run init-admin -- admin', 'npm start'] };
}

export function checkedProject(path) {
  const root = realpathSync(path);
  const marker = resolve(root, 'zenith.project.json');
  if (!existsSync(marker) || lstatSync(marker).isSymbolicLink()) throw new Error('Select a generated Zenith project');
  const manifest = JSON.parse(readFileSync(marker, 'utf8'));
  if (manifest.format !== 1 || !/^example\.org\/[a-z0-9-]+\/backend$/.test(manifest.backendModule) || !Array.isArray(manifest.modules)) throw new Error('Invalid project manifest');
  return { root, manifest };
}
export function writeNew(root, name, value) {
  const target = resolve(root, name); const rel = relative(root, target);
  if (rel === '..' || rel.startsWith('..\\') || rel.startsWith('../') || isAbsolute(rel)) throw new Error('Generated path escapes project');
  if (existsSync(target)) throw new Error(`Refusing to overwrite ${name}`);
  let parent = dirname(target); while (!existsSync(parent)) parent = dirname(parent);
  const parentRelative = relative(root, realpathSync(parent));
  if (parentRelative === '..' || parentRelative.startsWith('..\\') || parentRelative.startsWith('../') || isAbsolute(parentRelative)) throw new Error('Generated parent escapes project');
  mkdirSync(dirname(target), { recursive: true }); writeFileSync(target, value);
}
