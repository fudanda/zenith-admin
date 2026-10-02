import { build } from 'vite';
import { cpSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { resolve } from 'node:path';
await build({ configFile: false, root: 'frontend', base: '/dash/', resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query', '@zenith/elements'] }, build: { outDir: resolve('dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000 } });
mkdirSync('dist/zenith-assets', { recursive: true });
cpSync('node_modules/@zenith/admin/dist/public', 'dist/zenith-assets', { recursive: true });
cpSync('node_modules/@zenith/admin/dist/file-viewer', 'dist/file-viewer', { recursive: true });
// Copy into the Go source before compiling; production uses only its binary.
const dashboard=resolve('backend/dashboard');
if(realpathSync('backend')!==resolve('backend'))throw new Error('Dashboard parent must be a real project directory');
rmSync(dashboard,{recursive:true,force:true});
cpSync('dist', dashboard, { recursive: true });
