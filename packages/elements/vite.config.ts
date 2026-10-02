import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    lib: { entry: 'src/index.ts', formats: ['es'], fileName: 'index', cssFileName: 'styles' },
    rollupOptions: { external: [/^react(?:\/|$)/, /^react-dom(?:\/|$)/, /^@arcbase\/client(?:\/|$)/, /^@arcbase\/shared(?:\/|$)/, /^zod(?:\/|$)/, /^@douyinfe\/semi-ui(?:\/|$)/] },
  },
});
