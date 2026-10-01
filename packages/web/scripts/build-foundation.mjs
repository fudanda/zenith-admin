import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, readdirSync, rmSync } from 'node:fs';
import { dirname, resolve, relative, isAbsolute } from 'node:path';

const vite = resolve(dirname(createRequire(import.meta.url).resolve('vite/package.json')), 'bin/vite.js');
const result = spawnSync(process.execPath, [vite, 'build', '--mode', 'go-foundation', '--outDir', 'dist-go'], {
  stdio: 'inherit', env: { ...process.env, ZENITH_WEB_ENTRY: 'main' },
});
if (result.status !== 0) process.exit(result.status ?? 1);
const repo = resolve(process.cwd(), '../..');
const target = resolve(repo, 'backend/internal/dashboard/dist');
const allowed = resolve(repo, 'backend/internal/dashboard');
const rel = relative(allowed,target);
if (!rel || rel.startsWith('..') || isAbsolute(rel)) throw new Error('Invalid dashboard destination');
mkdirSync(target,{recursive:true});
for (const item of readdirSync(target)) if (item !== 'README.txt') rmSync(resolve(target,item),{recursive:true,force:true});
cpSync(resolve(process.cwd(),'dist-go'),target,{recursive:true});
