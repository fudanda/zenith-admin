import { defineConfig } from 'vitest/config';

// 根配置只负责聚合各包的 vitest 项目（`npx vitest run` / `npx vitest -p @arcbase/web`），
// 各包仍以自己的 vitest.config.ts 为准；被引用的配置文件不会继承此处任何选项。
export default defineConfig({
  test: {
    projects: ['packages/*/vitest.config.ts'],
  },
});
