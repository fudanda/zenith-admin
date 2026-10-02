import { cpSync, mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { build } from 'vite';

// No alias, monorepo path or workspace source is configured in this host.
await build({ configFile: false, base: process.env.ARCBASE_HOST_BASE_PATH ?? '/console/', resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query', '@arcbase/elements'] }, build: { chunkSizeWarningLimit: 2000 } });
mkdirSync('dist/arcbase-assets', { recursive: true });
cpSync(resolve('node_modules/@arcbase/admin/dist/public'), 'dist/arcbase-assets', { recursive: true });
cpSync(resolve('node_modules/@arcbase/admin/dist/file-viewer'), 'dist/file-viewer', { recursive: true });
