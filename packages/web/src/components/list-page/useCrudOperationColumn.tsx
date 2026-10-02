import type { ReactNode } from 'react';
import type { CrudPermissionPrefix, Permission } from '@arcbase/shared/core';
import { createOperationColumn, type ResponsiveTableAction } from '@/components/ResponsiveTableActions';
import { usePermission } from '@/hooks/usePermission';
import { deleteAction } from './deleteAction';

type IdLike = number | string;
type WithRecord<R, T> = T | ((record: R) => T);

const resolve = <R, T>(value: WithRecord<R, T> | undefined, record: R): T | undefined =>
  (typeof value === 'function' ? (value as (record: R) => T)(record) : value);

export interface CrudOperationColumnOptions<R extends { id: IdLike }> {
  /** 权限前缀（`workflow:datasource`）：编辑要求 `:update`，删除要求 `:delete`，两码都须在注册表；不按约定时用 `permissions` 逐项指定 */
  readonly permission?: CrudPermissionPrefix;
  readonly permissions?: { readonly edit?: Permission; readonly remove?: Permission };
  /** 页面已算好的布尔门控（`canManage` 一类），与权限码门控叠加 */
  readonly allow?: { readonly edit?: boolean; readonly remove?: boolean };
  /** 按行隐藏（内置记录不可删、非草稿不可编辑…），与门控叠加 */
  readonly hidden?: { readonly edit?: (record: R) => boolean; readonly remove?: (record: R) => boolean };
  /** 编辑：`useEditModal` 的返回（取其 `openEdit`）或回调；缺省 / `false` = 无编辑动作 */
  readonly edit?: { readonly openEdit: (record: R) => void } | ((record: R) => void) | false;
  /** 删除：`useDelete()` 的 mutation（按 `[record.id]` 调用）或自定义执行函数；缺省 / `false` = 无删除动作 */
  readonly remove?: { readonly mutateAsync: (ids: R['id'][]) => Promise<unknown> } | ((record: R) => Promise<unknown>) | false;
  /** 删除确认标题里的对象名：`(r) => r.name` → 「确定要删除「xxx」吗？」；缺省「确定要删除吗？」 */
  readonly label?: (record: R) => string;
  /** 完全自定义的删除确认标题（优先于 `label`） */
  readonly title?: WithRecord<R, string>;
  /** 删除确认的补充说明（级联影响等） */
  readonly content?: WithRecord<R, ReactNode>;
  /** 删除成功提示，默认「删除成功」；`null` 关闭；可按结果生成 */
  readonly successMessage?: string | null | ((result: unknown) => string);
  /** 删除成功后的收尾（清选中、关详情…） */
  readonly onDeleted?: (record: R, result: unknown) => void;
  /** 按行禁用删除并给出原因 */
  readonly disabled?: { readonly remove?: (record: R) => boolean; readonly reason?: WithRecord<R, ReactNode> };
  /** 追加动作，排在编辑之前（查看 / 测试 / 复制…） */
  readonly extra?: (record: R) => ResponsiveTableAction[];
  /** 追加动作，排在编辑与删除之间（复制 / 启停…） */
  readonly extraBetween?: (record: R) => ResponsiveTableAction[];
  /** 追加动作，排在删除之后（日志 / 历史…） */
  readonly extraAfter?: (record: R) => ResponsiveTableAction[];
  /** 列宽；缺省按动作数估算（编辑 + 删除 150，每组附加动作 +60） */
  readonly width?: number;
  /** 桌面端内联的动作 key（≤ 3 个），其余进「更多」菜单；缺省全部内联 */
  readonly desktopInlineKeys?: string[];
  readonly editLabel?: ReactNode;
  readonly removeLabel?: ReactNode;
  readonly columnTitle?: ReactNode;
  readonly menuAriaLabel?: string;
  readonly emptyContent?: ReactNode | ((record: R) => ReactNode);
}

/**
 * 标准资源操作列：`[...extra, 编辑, ...extraBetween, 删除, ...extraAfter]`，权限门控、删除确认 + 执行 + 提示都按约定接好——
 * 页面只声明「用哪个弹窗编辑、用哪个 mutation 删、拿什么当对象名」，行级隐藏 / 禁用与自定义文案按需追加。
 *
 * @example
 * const operationColumn = useCrudOperationColumn<Tag>({
 *   permission: 'system:tag',
 *   edit: tagModal,
 *   remove: deleteMutation,
 *   label: (r) => r.name,
 * });
 * const columns = [..., operationColumn];
 */
export function useCrudOperationColumn<R extends { id: IdLike }>(options: CrudOperationColumnOptions<R>) {
  const { hasPermission } = usePermission();
  const {
    permission, permissions, allow, hidden, edit, remove, label, title, content, successMessage, onDeleted, disabled,
    extra, extraBetween, extraAfter, width, desktopInlineKeys, editLabel, removeLabel, columnTitle, menuAriaLabel, emptyContent,
  } = options;
  // CrudPermissionPrefix 已保证 `${prefix}:update` / `${prefix}:delete` 都在注册表，模板拼接结果按 Permission 使用
  const editPermission = permissions?.edit ?? (permission ? (`${permission}:update` as Permission) : undefined);
  const removePermission = permissions?.remove ?? (permission ? (`${permission}:delete` as Permission) : undefined);
  const canEdit = Boolean(edit) && (allow?.edit ?? true) && (!editPermission || hasPermission(editPermission));
  const canRemove = Boolean(remove) && (allow?.remove ?? true) && (!removePermission || hasPermission(removePermission));

  const openEdit = typeof edit === 'function' ? edit : edit ? edit.openEdit : undefined;
  const runRemove = typeof remove === 'function'
    ? remove
    : remove
      ? (record: R) => remove.mutateAsync([record.id])
      : undefined;

  const groups = (extra ? 1 : 0) + (extraBetween ? 1 : 0) + (extraAfter ? 1 : 0);
  return createOperationColumn<R>({
    title: columnTitle,
    width: width ?? 150 + groups * 60,
    desktopInlineKeys,
    menuAriaLabel,
    emptyContent,
    actions: (record) => [
      ...(extra ? extra(record) : []),
      ...(openEdit ? [{ key: 'edit', label: editLabel ?? '编辑', hidden: !canEdit || Boolean(hidden?.edit?.(record)), onClick: () => openEdit(record) }] : []),
      ...(extraBetween ? extraBetween(record) : []),
      ...(runRemove
        ? [deleteAction<unknown>({
          hidden: !canRemove || Boolean(hidden?.remove?.(record)),
          disabled: disabled?.remove?.(record),
          disabledReason: resolve(disabled?.reason, record),
          label: removeLabel,
          title: resolve(title, record) ?? (label ? `确定要删除「${label(record)}」吗？` : '确定要删除吗？'),
          content: resolve(content, record),
          run: () => runRemove(record),
          ...(successMessage !== undefined ? { successMessage } : {}),
          ...(onDeleted ? { onDeleted: (result: unknown) => onDeleted(record, result) } : {}),
        })]
        : []),
      ...(extraAfter ? extraAfter(record) : []),
    ],
  });
}
