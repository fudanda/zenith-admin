/**
 * 站点树纯函数工具（从 SitesPage 抽出，便于单测）。
 */
import type { CmsSite, CmsSiteInheritableField } from '@arcbase/shared/cms';

/**
 * 在扁平站点列表中收集 rootId 的全部后代 id（含自身）。
 * 移动站点时排除自身子树，防止移动成自己的后代形成环。
 */
export function collectFlatSiteDescendantIds(sites: CmsSite[], rootId: number): Set<number> {
  const result = new Set<number>([rootId]);
  let changed = true;
  while (changed) {
    changed = false;
    for (const site of sites) {
      if (site.parentId != null && result.has(site.parentId) && !result.has(site.id)) {
        result.add(site.id);
        changed = true;
      }
    }
  }
  return result;
}

/** 继承配置面板：某可继承字段在有效配置里的展示值 */
export function displayEffectiveValue(field: CmsSiteInheritableField, resolved: Record<string, unknown>): string {
  const valueByField: Record<CmsSiteInheritableField, unknown> = {
    seoTitle: resolved.title,
    seoKeywords: resolved.keywords,
    seoDescription: resolved.description,
    staticMode: resolved.staticMode,
    reviewMode: resolved.auditMode,
    webhook: {
      url: resolved.webhookUrl,
      secret: resolved.webhookSecret,
    },
    cdn: {
      url: resolved.cdnPurgeUrl,
      token: resolved.cdnPurgeToken,
    },
    theme: {
      code: resolved.theme,
    },
    themeConfig: resolved.themeConfig,
    templates: resolved.defaultTemplates,
  };
  const value = valueByField[field];
  if (value === null || value === undefined || value === '') return '-';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

/** 站点下拉选项：按层级缩进（— 前缀），供父级选择/移动目标使用 */
export function siteIndentOptions(sites: CmsSite[]): { value: number; label: string }[] {
  return sites.map((site) => ({
    value: site.id,
    label: `${'—'.repeat(Math.max(0, (site.depth ?? 1) - 1))}${site.name}`,
  }));
}
