/**
 * 接口目录数据面：`@arcbase/shared` 从契约派生目录并转成契约响应形状；目录是构建期静态可知的（契约即代码），
 * 进程内算一次即缓存。前端不直接 import 契约聚合（见 shared/permission-catalog-core 的说明），从这里取。
 */
import type { ApiCatalog } from '@arcbase/shared/identity';
import { buildApiCatalog } from '@arcbase/shared/permission-catalog';

let cached: ApiCatalog | null = null;

export function getApiCatalog(): ApiCatalog {
  cached ??= buildApiCatalog();
  return cached;
}
