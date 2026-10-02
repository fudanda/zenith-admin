import { spawnSync } from 'node:child_process';
import { mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
mkdirSync('backend/bin', { recursive: true });
const executable = process.platform === 'win32' ? 'zenith.exe' : 'zenith';
const sdk=JSON.parse(readFileSync('vendor/zenith-sdk.json','utf8'));const prefix='github.com/fudanda/zenith-admin/backend';
const flags=`-X ${prefix}.Version=${sdk.version} -X ${prefix}.Commit=${sdk.commit} -X ${prefix}.BuildTime=${new Date().toISOString()}`;
const result = spawnSync('go', ['build', '-trimpath', '-ldflags',flags,'-o', resolve('backend/bin', executable), '.'], { cwd: resolve('backend'), stdio: 'inherit', windowsHide: true });
if (result.error) throw result.error; process.exit(result.status ?? 1);
