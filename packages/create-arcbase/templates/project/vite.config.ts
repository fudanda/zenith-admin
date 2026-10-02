import { defineConfig } from 'vite';
process.loadEnvFile('.env');
export default defineConfig({ root: 'frontend', base: '/dash/', resolve: { dedupe: ['react', 'react-dom', '@tanstack/react-query', '@arcbase/elements'] }, server: { host: '127.0.0.1', port: 5373, proxy: { '/api/v1': { target: process.env.ARCBASE_API_TARGET ?? `http://${process.env.ARCBASE_ADDR??'127.0.0.1:8080'}`, changeOrigin: false } } } });
