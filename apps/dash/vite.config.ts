import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

const root = path.resolve(import.meta.dirname);
const packages = path.resolve(root, '../../packages');

export default defineConfig({
  root,
  base: '/dash/',
  plugins: [react()],
  resolve: { alias: {
    '@zenith/admin-client': path.join(packages, 'client/src/index.ts'),
    '@zenith/admin-core': path.join(packages, 'admin-core/src/index.tsx'),
    '@zenith/admin-modules': path.join(packages, 'admin-modules/src/index.ts'),
    '@zenith/admin-pages': path.join(packages, 'admin-pages/src/index.ts'),
    '@zenith/admin-ui': path.join(packages, 'admin-ui/src/index.tsx'),
    '@zenith/admin-app': path.join(packages, 'admin-app/src/index.tsx'),
  } },
  build: { outDir: path.resolve(root, '../../backend/internal/dash/dist'), emptyOutDir: true },
  server: { port: 5173, proxy: { '/api/v1': 'http://127.0.0.1:8080' } },
});
