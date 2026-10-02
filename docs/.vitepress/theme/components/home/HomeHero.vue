<script setup lang="ts">
import { withBase } from 'vitepress'

declare const __ARCBASE_VERSION__: string

const version = __ARCBASE_VERSION__
const deploymentUrl = withBase('/guide/go-foundation')
</script>

<template>
  <header class="hero">
    <a class="hero__tag" :href="withBase('/changelog/')">
      <i></i>v{{ version }} · MIT 开源
    </a>
    <h1 class="hero__title">一套底座，覆盖后台<br />全部高频场景</h1>
    <p class="hero__lead">
      GoFr + Ent 构建的单组织后台，支持 PostgreSQL 与 SQLite。保留原 React 管理台，提供账号、组织、权限、配置、文件和审计能力。
    </p>
    <div class="hero__actions">
      <a class="zn-btn zn-btn--primary" :href="withBase('/guide/go-foundation')">快速开始 →</a>
      <a class="zn-btn zn-btn--ghost" :href="deploymentUrl">部署指南</a>
    </div>
  </header>
</template>

<style scoped>
.hero {
  display: flex;
  flex-direction: column;
  align-items: center;
  max-width: 900px;
  margin: 0 auto;
  padding: 72px 24px 48px;
  text-align: center;
}

.hero__tag {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 9px;
  border-radius: 999px;
  background: var(--zn-brand-soft);
  color: var(--vp-c-brand-1);
  font-size: 12.5px;
  font-weight: 600;
  text-decoration: none;
  transition: background 0.2s;
}

.hero__tag:hover {
  background: var(--vp-c-brand-soft);
}

.hero__tag i {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  background: var(--zn-success);
}

.hero__title {
  margin: 22px 0 16px;
  font-size: 54px;
  font-weight: 800;
  line-height: 1.12;
  letter-spacing: -1.6px;
  color: var(--zn-text-1);
}

.hero__lead {
  max-width: 640px;
  margin: 0;
  font-size: 17px;
  line-height: 1.75;
  color: var(--zn-text-2);
}

.hero__actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 30px;
}

@media (max-width: 640px) {
  .hero {
    padding: 44px 16px 36px;
  }

  .hero__title {
    font-size: 34px;
    letter-spacing: -1px;
  }

  .hero__lead {
    font-size: 15.5px;
  }
}
</style>
