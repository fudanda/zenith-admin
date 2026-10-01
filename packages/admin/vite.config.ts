import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ConfigEnv } from 'vite';
import { esmExternalRequirePlugin } from 'rolldown/plugins';
import webConfig from '../web/vite.config.ts';

const root = fileURLToPath(new URL('.', import.meta.url));
export default defineConfig(async (env: ConfigEnv) => {
  const config = await (typeof webConfig === 'function' ? webConfig({ ...env, mode: 'go-foundation' }) : webConfig);
  return {
    ...config,
    base: './',
    publicDir: false,
    plugins: [...(config.plugins ?? []), esmExternalRequirePlugin({ external: [/^(?:react(?:\/.*)?|react-dom(?:\/.*)?|@tanstack\/react-query|@zenith\/(?:client|elements))$/] })],
    build: {
      ...config.build,
      outDir: resolve(root, 'dist'),
      emptyOutDir: true,
      copyPublicDir: false,
      cssCodeSplit: false,
      // A consuming bundler rewrites chunks; do not bake original preload names.
      modulePreload: false,
      assetsInlineLimit: () => false,
      // Keep WASM/fonts as files. Vite's lib preset always inlines these assets.
      lib: false,
      rollupOptions: {
        ...config.build?.rollupOptions,
        preserveEntrySignatures: 'allow-extension',
        input: resolve(root, 'src/index.tsx'),
        output: {
          ...config.build?.rollupOptions?.output,
          // This output is bundled a second time by the host. Preserve source
          // initialization order without the standalone app's chunk grouping.
          codeSplitting: undefined,
          strictExecutionOrder: true,
          entryFileNames: 'index.js',
          chunkFileNames: 'chunks/[name]-[hash].js',
          assetFileNames: (asset: { names: string[] }) => asset.names.some(name => name.endsWith('.css')) ? 'styles.css' : 'assets/[name]-[hash][extname]',
        },
      },
    },
  };
});
