/**
 * 权限码注册表的类型基座。
 *
 * 每个业务域在 `shared/src/{域}/permissions.ts` 用 `definePermissions()` 声明自己的权限码，
 * `@zenith/shared/permissions` 把各域注册表聚合成 `PERMISSION_REGISTRY_BY_DOMAIN`；这里只以 **type-only** 方式引用该聚合，
 * 从中推导 `Permission` 字面量联合——运行时没有 core → 业务域的依赖，而任何引用了 `Permission` 的编译单元
 * 都必然带上全部域的注册表（不依赖调用方是否恰好 import 了某个域）。
 *
 * 权限码是唯一真相：种子 button 节点由注册表生成，契约操作的 `access`、服务端 `hasPermission()`、
 * 前端 `hasPermission()` / `permission=` 属性都以 `Permission` 类型约束——拼错的码在编译期报错，而不是在生产静默放行 / 拒绝。
 */
import type { PERMISSION_REGISTRY_BY_DOMAIN } from '../permissions';

export interface PermissionMeta {
  /** 按钮标题（角色管理菜单树 / 权限矩阵展示） */
  readonly label: string;
  /**
   * 所属页面菜单的 `name`（`SEED_MENUS` 中 type 为 menu / directory 的行）；同一权限挂多个页面时传数组。
   * 无页面的纯 API 权限挂到虚拟隐藏目录 `ApiOnlyPermissions`。
   */
  readonly menu: string | readonly string[];
  /** 覆盖生成的 button id（缺省 = 页面 id + 1 + 在该页面的序号）；与 `menu` 数组一一对应 */
  readonly id?: number | readonly (number | undefined)[];
  /** 覆盖生成的排序值（缺省 = 在该页面的序号）；与 `menu` 数组一一对应 */
  readonly sort?: number | readonly (number | undefined)[];
  /** 服务端没有任何接口检查该码：纯前端门控，或待清理的死权限 */
  readonly uiOnly?: boolean;
}

type DomainRegistry = (typeof PERMISSION_REGISTRY_BY_DOMAIN)[keyof typeof PERMISSION_REGISTRY_BY_DOMAIN];
type KeysOfUnion<T> = T extends unknown ? keyof T & string : never;

/** 全部已注册权限码的字面量联合（各域注册表键的并集） */
/** Hosts may augment this interface with their own registered permission names. */
export interface HostPermissionRegistry {} // eslint-disable-line @typescript-eslint/no-empty-object-type
export type Permission = KeysOfUnion<DomainRegistry> | (keyof HostPermissionRegistry & string);

type PrefixOfSuffix<T, S extends string> = T extends `${infer P}:${S}` ? P : never;

/** 拥有 `:list` 后缀的权限前缀（`mountCrud` 按前缀 + 约定后缀派生 `:list / :create / :update / :delete`） */
export type PermissionPrefix = PrefixOfSuffix<Permission, 'list'>;

/** 同时拥有 `:update` 与 `:delete` 的权限前缀（列表操作列按前缀派生编辑 / 删除门控） */
export type CrudPermissionPrefix = Extract<PrefixOfSuffix<Permission, 'update'>, PrefixOfSuffix<Permission, 'delete'>>;

/** 声明一个域的权限码注册表；`const` 泛型保留键的字面量类型 */
export function definePermissions<const T extends Record<string, PermissionMeta>>(defs: T): T {
  return defs;
}

/** 权限值归一为数组（`guard` / 前端门控接受单个或多个「任一即可」） */
export function permissionList(permission: Permission | readonly Permission[]): readonly Permission[] {
  return typeof permission === 'string' ? [permission] : permission;
}
