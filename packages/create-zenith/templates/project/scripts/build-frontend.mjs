import { build } from 'vite';
import { cpSync, mkdirSync, rmSync, realpathSync } from 'node:fs';
import { extname, resolve } from 'node:path';
await build({ configFile: false, root: 'frontend', base: '/dash/', resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query', '@zenith/elements'] }, build: {
  outDir: resolve('dist'), emptyOutDir: true, chunkSizeWarningLimit: 2000,
  rollupOptions: { output: { assetFileNames(asset) {
    // Extensionless assets (including rebundled LICENSE files) must not end
    // with a dot: Go embed rejects that name even when the host OS allows it.
    const extension = extname(asset.names[0] ?? '');
    return extension && extension !== '.' ? 'assets/[name]-[hash][extname]' : 'assets/[name]-[hash].txt';
  } } },
} });
mkdirSync('dist/zenith-assets', { recursive: true });
cpSync('node_modules/@zenith/admin/dist/public', 'dist/zenith-assets', { recursive: true });
cpSync('node_modules/@zenith/admin/dist/file-viewer', 'dist/file-viewer', { recursive: true });
// Copy into the Go source before compiling; production uses only its binary.
const dashboard=resolve('backend/dashboard');
if(realpathSync('backend')!==resolve('backend'))throw new Error('Dashboard parent must be a real project directory');
rmSync(dashboard,{recursive:true,force:true});
cpSync('dist', dashboard, { recursive: true });
