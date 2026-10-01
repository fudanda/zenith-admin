import { cpSync, readFileSync, writeFileSync, mkdtempSync, lstatSync, realpathSync } from 'node:fs';
import { resolve, relative, isAbsolute } from 'node:path';
import { tmpdir } from 'node:os';
import { execFileSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const artifacts = resolve(root, 'release_artifacts/packages');
const manifest = JSON.parse(readFileSync(resolve(artifacts, 'index.json'), 'utf8'));
const host = process.env.ZENITH_PACKAGE_HOST_DIR ?? mkdtempSync(resolve(tmpdir(), 'zenith-independent-host-'));
if (process.env.ZENITH_PACKAGE_HOST_DIR && !realpathSync(host).startsWith(realpathSync(tmpdir()) + '/zenith-independent-host-') && !realpathSync(host).startsWith(realpathSync(tmpdir()) + '\\zenith-independent-host-')) throw new Error('Reuse only an acceptance directory under the OS temp directory');
const hostRelative = relative(root, host);
if (!hostRelative.startsWith('..') && !isAbsolute(hostRelative)) throw new Error('Host acceptance must run outside this repository');
cpSync(resolve(root, 'examples/host-application'), host, { recursive: true });
const npm = process.env.npm_execpath;
if (!npm) throw new Error('Use npm run test:packages:external');
const args = [npm, 'install', '--ignore-scripts', '--no-audit', '--no-fund', ...manifest.packages.map(pkg => resolve(artifacts, pkg.filename))];
execFileSync(process.execPath, args, { cwd: host, stdio: 'inherit', timeout: 300000 });
for (const pkg of manifest.packages) {
  const path = resolve(host, 'node_modules', pkg.name);
  if (lstatSync(path).isSymbolicLink() || !realpathSync(path).startsWith(realpathSync(host))) throw new Error(`${pkg.name} is linked to a workspace`);
}
execFileSync(process.execPath, [npm, 'run', 'build'], { cwd: host, stdio: 'inherit', timeout: 300000 });
// Import the compiled SDK in plain Node, without tsx or TypeScript loaders.
execFileSync(process.execPath, ['--input-type=module', '-e', 'import { Client } from "@zenith/client"; import { positionContract } from "@zenith/shared/identity"; if (!new Client() || !positionContract.list) throw new Error("Package import failed");'], { cwd: host, stdio: 'inherit' });
writeFileSync(resolve(root, 'backend/bin/external-host-path.txt'), host);
writeFileSync(resolve(artifacts, 'external-acceptance.json'), JSON.stringify({ host, installedWithoutWorkspaceLinks: true, typecheck: true, productionBuild: true, compiledNodeImport: true }, null, 2));
console.log(`Independent host installed and built: ${host}`);
