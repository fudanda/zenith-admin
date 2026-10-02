import type { CmsModelField } from '@zenith/shared/cms';

/**
 * 字段可选项：优先用服务端解析后的 resolvedOptions（字典来源已展开），
 * 回落 options 兼容尚未返回 resolvedOptions 的旧接口响应。
 */
export function cmsModelFieldOptions(field: CmsModelField): { label: string; value: string }[] {
  return field.resolvedOptions ?? field.options ?? [];
}
