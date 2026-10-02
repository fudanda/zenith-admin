<script setup lang="ts">
import { withBase } from 'vitepress'
</script>

<template>
  <section class="qs">
    <div class="zn-section-head">
      <span class="zn-eyebrow">快速开始</span>
      <h2 class="zn-h2">三步启动完整开发环境</h2>
      <p class="zn-sub">
        准备 Node.js 24 与 Go，选择 PostgreSQL 或 SQLite，再安装、初始化、启动。
      </p>
    </div>
    <div class="steps">
      <div class="step">
        <span class="step__n">1</span>
        <h3>克隆并安装</h3>
        <p>npm monorepo，一次安装全部工作区依赖。</p>
        <pre>npm install</pre>
      </div>
      <div class="step">
        <span class="step__n">2</span>
        <h3>配置并初始化数据库</h3>
        <p>复制环境变量模板，执行迁移并写入基础菜单、角色与配置。</p>
        <pre>cp .env.go.example .env.go
npm run db:migrate &amp;&amp; npm run db:seed</pre>
      </div>
      <div class="step">
        <span class="step__n">3</span>
        <h3>启动</h3>
        <p>显式创建管理员，同时启动 Go API 与原 React 管理台。</p>
        <pre>npm run init-admin -- admin
npm run dev
<span class="d"># API :8080/api/v1 · Web :5373/dash/</span></pre>
      </div>
    </div>
    <p class="qs__more">
      更多细节见 <a :href="withBase('/guide/go-foundation')">快速开始</a>、<a :href="withBase('/guide/go-tooling')">项目生成器</a> 与 <a :href="withBase('/guide/arcbase-branding')">更名与升级兼容</a>。
    </p>
  </section>
</template>

<style scoped>
.qs {
  max-width: 1160px;
  margin: 0 auto;
  padding: 88px 24px 0;
}

.steps {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 14px;
  margin-top: 40px;
}

.step {
  display: flex;
  flex-direction: column;
  gap: 10px;
  padding: 22px;
  border: 1px solid var(--zn-line);
  border-radius: 18px;
  background: var(--zn-card);
}

.step__n {
  display: grid;
  place-items: center;
  width: 28px;
  height: 28px;
  border-radius: 8px;
  background: var(--zn-text-1);
  color: var(--zn-card);
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  font-weight: 700;
}

.step h3 {
  margin: 4px 0 0;
  font-size: 16px;
  font-weight: 700;
  color: var(--zn-text-1);
}

.step p {
  margin: 0;
  font-size: 13.5px;
  line-height: 1.6;
  color: var(--zn-text-2);
}

.step pre {
  margin: auto 0 0;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--zn-dark);
  color: var(--zn-dark-text);
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.7;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}

.step pre .d {
  color: var(--zn-dark-text-2);
}

.qs__more {
  margin: 20px 0 0;
  font-size: 13.5px;
  color: var(--zn-text-3);
}

.qs__more a {
  color: var(--vp-c-brand-1);
  font-weight: 500;
  text-decoration: none;
}

.qs__more a:hover {
  text-decoration: underline;
}

@media (max-width: 960px) {
  .steps {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 640px) {
  .qs {
    padding: 64px 16px 0;
  }
}
</style>
