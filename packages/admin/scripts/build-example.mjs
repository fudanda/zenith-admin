import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';

const root = fileURLToPath(new URL('..', import.meta.url));
const dist = resolve(root, 'dist-example');
await build({
  root: resolve(root, 'examples/minimal-host'),
  configFile: false,
  base: '/console/',
  resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query'] },
  build: { outDir: dist, emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
mkdirSync(resolve(dist, 'arcbase-assets'), { recursive: true });
cpSync(resolve(root, 'dist/public'), resolve(dist, 'arcbase-assets'), { recursive: true });
// Local preview engines publish worker/WASM assets alongside the library.
cpSync(resolve(root, 'dist/file-viewer'), resolve(dist, 'file-viewer'), { recursive: true });
