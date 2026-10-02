import { spawnSync } from 'node:child_process';
import { resolve } from 'node:path';
import { existsSync, readdirSync, mkdirSync } from 'node:fs';
process.loadEnvFile('.env');
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('ZENITH_') && !Object.hasOwn(process.env, `ARCBASE_${name.slice(7)}`)) process.env[`ARCBASE_${name.slice(7)}`] = value;
}
const run = args => { const result = spawnSync('go', args, { cwd: resolve('backend'), env: { ...process.env, GOFLAGS: '-mod=mod' }, stdio: 'inherit', windowsHide: true }); if (result.error) throw result.error; if (result.status) process.exit(result.status); };
const [command, ...args] = process.argv.slice(2);
if (command === 'generate') {
  if (existsSync('backend/ent/schema') && readdirSync('backend/ent/schema').some(file => file.endsWith('.go'))) run(['run', '-mod=mod', 'entgo.io/ent/cmd/ent', 'generate', './ent/schema']);
  const manifest = JSON.parse((await import('node:fs')).readFileSync('arcbase.project.json', 'utf8'));
  for (const module of manifest.modules) { mkdirSync(`backend/modules/${module.id}/models`, { recursive: true }); run(['run', '-mod=mod', 'github.com/oapi-codegen/oapi-codegen/v2/cmd/oapi-codegen@v2.8.0', '-config', `modules/${module.id}/oapi.yaml`, `modules/${module.id}/openapi.gen.json`]); }
  run(['mod', 'tidy']); run(['fmt', './...']);
} else if (command === 'test') run(['test', './...', ...args]);
else run(['run', '.', command ?? 'serve', ...args]);
