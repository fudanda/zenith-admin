import { defineConfig } from 'vite';
import { fileURLToPath } from 'node:url';
export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)), base: '/elements/',
  resolve: { dedupe: ['react', 'react-dom'] },
  build: { outDir: '../dist-example', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
});
