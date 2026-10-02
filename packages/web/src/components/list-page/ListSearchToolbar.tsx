import type { ReactNode } from 'react';
import { SearchToolbar } from '@/components/SearchToolbar';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { SlotProbe } from '@/components/rendered-slot';
import { useRenderedSlot } from '@/hooks/useRenderedSlot';
import { deriveFilterControls, type FilterOverrides, type FilterPageLike, type FilterSpec } from './ContractFilters';

interface ListSearchToolbarBaseProps {
  /** 新增按钮：桌面端排在查询 / 重置之后，移动端保留在主区 */
  create?: ReactNode;
  /** 低频操作（导出 / 批量 / 同步…）：桌面端跟在新增之后，移动端收进「更多操作」菜单 */
  actions?: ReactNode;
  /** 覆盖移动端更多菜单内容；缺省与 `actions` 相同 */
  mobileActions?: ReactNode;
  filterTitle?: ReactNode;
  actionTitle?: string;
  className?: string;
}

/** 槽位写法：控件由页面创建（非契约类型的筛选状态、树形 / 客户端过滤等非标准形态） */
export interface ListSearchToolbarSlotProps extends ListSearchToolbarBaseProps {
  page?: undefined;
  /** 关键词输入（`KeywordInput`），桌面与移动端主区都展示 */
  keyword?: ReactNode;
  /** 其余筛选项（状态 / 类型 / 时间范围…）：桌面端内联，移动端收进筛选抽屉 */
  filters?: ReactNode;
  onSearch: () => void;
  onReset: () => void;
}

/**
 * 契约写法：传 `useListPage({ contract })` 的返回，`filters` 只声明键（与成对的时间范围端点），
 * 控件按契约 query 的 `x-filter` 语义派生（见 `ContractFilters.tsx`）；关键字类自动进主区。
 * 查询 / 重置从 `page` 取，专用控件在 `overrides` 里给出，额外的手写控件仍可放 `extraFilters`。
 */
export interface ListSearchToolbarContractProps<TSearch> extends ListSearchToolbarBaseProps {
  page: FilterPageLike<TSearch> & { readonly toolbarProps: { readonly onSearch: () => void; readonly onReset: () => void } };
  filters: ReadonlyArray<FilterSpec<TSearch>>;
  overrides?: FilterOverrides<TSearch>;
  /** 契约之外的手写筛选控件（`{...page.bind('x')}` 绑定），排在派生控件之后 */
  extraFilters?: ReactNode;
  keyword?: undefined;
  onSearch?: undefined;
  onReset?: undefined;
}

export type ListSearchToolbarProps<TSearch = Record<string, unknown>> = ListSearchToolbarSlotProps | ListSearchToolbarContractProps<TSearch>;

const present = (node: ReactNode) => Boolean(node) && !(Array.isArray(node) && node.length === 0);

/**
 * 标准列表页工具栏：把 `SearchToolbar` 的桌面 / 移动槽位排布规则写在一处——
 * 桌面：关键词 → 筛选项 → 查询 / 重置 → 新增 → 低频操作；
 * 移动：主区 关键词 + 查询 + 新增，筛选项进抽屉（应用 / 重置即查询 / 重置），低频操作进更多菜单。
 * 契约写法下控件由契约 query 的语义派生；槽位写法下控件仍由页面创建（占位文案、字典项、权限门控都在页面里可见）。
 */
export function ListSearchToolbar<TSearch = Record<string, unknown>>(props: ListSearchToolbarProps<TSearch>) {
  const { create, actions, mobileActions, filterTitle, actionTitle, className } = props;
  let keyword: ReactNode;
  let filters: ReactNode;
  let onSearch: () => void;
  let onReset: () => void;
  if (props.page) {
    const derived = deriveFilterControls({ page: props.page, specs: props.filters, overrides: props.overrides });
    keyword = derived.keyword.length ? derived.keyword : undefined;
    filters = derived.filters.length || props.extraFilters ? <>{derived.filters}{props.extraFilters}</> : undefined;
    ({ onSearch, onReset } = props.page.toolbarProps);
  } else {
    ({ keyword, filters, onSearch, onReset } = props);
  }
  // 低频操作可能整体渲染为空（带 permission 的导出 / 按选中数出现的批量按钮）：按实际渲染结果决定移动端是否出现更多菜单
  const actionsSlot = useRenderedSlot();
  const desktopActions = present(create) || present(actions)
    ? <>{create}<SlotProbe ref={actionsSlot.probeRef}>{actions}</SlotProbe></>
    : undefined;
  return (
    <SearchToolbar
      className={className}
      primary={(
        <>
          {keyword}
          {filters}
          <SearchButton onClick={onSearch} />
          <ResetButton onClick={onReset} />
        </>
      )}
      actions={desktopActions}
      mobilePrimary={(
        <>
          {keyword}
          <SearchButton onClick={onSearch} />
          {create}
        </>
      )}
      mobileFilters={present(filters) ? filters : undefined}
      // SearchToolbar 对 mobileActions 缺省回落到 actions（含新增按钮，而新增已在移动主区），这里显式给出：
      // 页面覆盖优先；否则只有低频操作真的渲染出了元素才复用，用 false 明确「没有更多操作」
      mobileActions={mobileActions ?? (actionsSlot.rendered ? actions : false)}
      filterTitle={filterTitle}
      actionTitle={actionTitle}
      onFilterApply={onSearch}
      onFilterReset={onReset}
    />
  );
}
