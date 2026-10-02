/**
 * 行为中心阶段 1（Task E 报表中心复用）：验证种子数据里新增的 3 个只读参数化数据集
 * （行为事件趋势 / 行为事件来源分布 / 埋点质量趋势）与绑定看板均已就位，且满足：
 *  - id 不与既有数据集（1/2）冲突，彼此互不冲突
 *  - 全部复用内置主库 datasourceId=1（不新增数据源/执行器）
 *  - SQL 均引用系统参数 `${__tenantId}` 且带 `(${__tenantId}::int IS NULL OR tenant_id = ...)` 平台视角/租户双兼容写法
 *  - 看板 widgets 绑定的 datasetId 均能在 SEED_REPORT_DATASETS 中找到
 */
import { describe, expect, it } from 'vitest';
import { SEED_REPORT_DATASETS, SEED_REPORT_DASHBOARDS } from '@arcbase/shared/seed';

describe('SEED_REPORT_DATASETS — 行为中心报表数据集接入', () => {
  const behaviorDatasets = SEED_REPORT_DATASETS.filter((d) => d.id === 3 || d.id === 4 || d.id === 5);

  it('adds exactly 3 new datasets (ids 3/4/5) without colliding with the pre-existing seed ids (1/2)', () => {
    expect(behaviorDatasets).toHaveLength(3);
    const ids = SEED_REPORT_DATASETS.map((d) => d.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('all reuse the built-in primary datasource (datasourceId=1) — no new datasource/executor introduced', () => {
    for (const d of behaviorDatasets) expect(d.datasourceId).toBe(1);
  });

  it('all reference the server-side system parameter ${__tenantId} with the platform/tenant dual-view guard', () => {
    for (const d of behaviorDatasets) {
      const sqlText = (d.content as { sql: string }).sql;
      expect(sqlText).toContain('__tenantId');
      expect(sqlText).toMatch(/\(\$\{__tenantId\}::int IS NULL OR tenant_id\s*=\s*\$\{__tenantId\}\)/);
    }
  });

  it('each dataset declares matching name/value fields for chart binding', () => {
    for (const d of behaviorDatasets) {
      const fieldNames = d.fields.map((f) => f.name);
      expect(fieldNames).toContain('name');
      expect(fieldNames).toContain('value');
    }
  });
});

describe('SEED_REPORT_DASHBOARDS — 行为中心概览看板绑定', () => {
  it('binds an analytics overview dashboard whose widgets all reference an existing dataset id', () => {
    const datasetIds = new Set(SEED_REPORT_DATASETS.map((d) => d.id));
    const dashboardsReferencingBehaviorDatasets = SEED_REPORT_DASHBOARDS.filter((dash) =>
      (dash.widgets ?? []).some((w) => w.datasetId === 3 || w.datasetId === 4 || w.datasetId === 5),
    );
    expect(dashboardsReferencingBehaviorDatasets.length).toBeGreaterThan(0);
    for (const dash of dashboardsReferencingBehaviorDatasets) {
      for (const widget of dash.widgets ?? []) {
        if (widget.datasetId != null) expect(datasetIds.has(widget.datasetId)).toBe(true);
      }
    }
  });
});
