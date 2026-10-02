import { spawn } from 'node:child_process';
import { resolve } from 'node:path';
process.loadEnvFile('.env');
for (const [name, value] of Object.entries(process.env)) {
  if (name.startsWith('ZENITH_') && !Object.hasOwn(process.env, `ARCBASE_${name.slice(7)}`)) process.env[`ARCBASE_${name.slice(7)}`] = value;
}
const executable = process.platform === 'win32' ? 'arcbase.exe' : 'arcbase';
const child = spawn(resolve('backend/bin', executable), process.argv.slice(2), { stdio: 'inherit', windowsHide: true });
child.on('error', error => { console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { process.exitCode = code ?? 1; });
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
