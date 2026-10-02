# UI 规范

前端采用 **Semi Design v2** 作为组件库，图标统一使用 **lucide-react**。页面结构、表格、筛选、弹窗、状态展示与响应式行为优先复用 `packages/web/src/components/`、`packages/web/src/hooks/` 中的公共封装。

::: tip 硬性约束不在本页
可机械核对的「必须 / 禁止」规则维护在 [`.agents/skills/arcbase/references/constraints-frontend.md`](https://github.com/iwangbowen/zenith-admin/blob/master/.agents/skills/zenith/references/constraints-frontend.md)。可直接复制的 CRUD 页面模板见 [`crud-frontend.md`](https://github.com/iwangbowen/zenith-admin/blob/master/.agents/skills/zenith/references/crud-frontend.md)。本页只描述设计取向与文档入口。
:::

## 规范索引

| 你要做的事 | 去哪查 |
| --- | --- |
| 标准 CRUD 页面、域 hooks、列表搜索、弹窗保存 | [数据获取与服务端状态](/frontend/data-fetching)；`crud-frontend.md` |
| 搜索栏、筛选控件、查询/重置/新增/刷新按钮 | [公共组件](/frontend/components#列表页基础组件)；`constraints-frontend.md`「搜索栏与表格」 |
| 表格列显隐、刷新、全屏、尺寸/斑马纹、操作列 | [公共组件](/frontend/components#列表页基础组件) |
| 时间列、空值、文本省略 | `packages/web/src/utils/table-columns.ts`；`constraints-frontend.md`「搜索栏与表格」 |
| 弹窗表单、上传字段、时区字段、滑块输入、分割线 | [公共组件](/frontend/components#表单与展示组件)；`constraints-frontend.md`「表单与展示组件」 |
| 多 Tab、左右分栏、平铺列表、统计卡、栅格、URL 状态 | `ui-patterns.md`；[公共组件](/frontend/components#布局、导航与状态组件) |
| 文件预览、附件上传、文件名列 | [文件预览组件](/frontend/file-preview)；[公共组件](/frontend/components#文件与预览组件) |
| 认证、请求实例、账号切换、维护模式 | [认证与请求](/frontend/auth-request) |
| 动态菜单、路由守卫、标签页、页面缓存 | [前端路由与菜单](/frontend/routing) |
| mutation 失效粒度与 query key 结构 | `query-cache.md` |

## 页面设计原则

- **信息层次清晰，高频操作易于触达**：列表页优先服务查询、筛选、批量处理与快速定位
- **稳定一致**：新页面沿用既有容器、工具栏、表格、弹窗和状态反馈，不为单页发明交互范式
- **移动端做减法**：窄屏只保留关键词、查询、新增等核心入口；低频筛选放底部抽屉，低频操作放更多菜单
- **服务端状态交给 Query**：列表、详情、统计、下拉源、权限快照、菜单树都按 Query 管理；本地 state 只表达交互状态
- **表单校验声明式**：使用 Semi Form `rules`；跨字段校验放在提交编排中，失败时用 `abortSubmit()` 中断
- **语义变量优先**：卡片 / 面板用 `var(--surface-card)`，页面底衬用 `var(--color-content-bg)`；无需背景时继承容器颜色
- **可访问与可复制**：详情查看态优先纯文本展示，必要时保留复杂控件（附件、签名、明细等）

## 列表页视觉约定

标准列表页由 `SearchToolbar`、`KeywordInput` / `FilterSelect` / `StatusSelect` / `DateRangeFilter`、`SearchButton` / `ResetButton` / `CreateButton`、`ConfigurableTable` 和 `createOperationColumn` 组合。

- 搜索条件较多时使用 `SearchToolbar` 的结构化 props：`primary`、`filters`、`actions`，并按需覆盖 `mobilePrimary`、`mobileFilters`、`mobileActions`
- 关键词、状态、时间范围筛选使用 `components/search-filters.tsx`；面板或弹窗内需要自适应宽度的搜索框可直接用 Semi `Input`
- 表格使用 `<ConfigurableTable bordered ... />`，传 `onRefresh` 与 `refreshLoading`
- 每个表格有且只有一个弹性主列（名称 / 标题列）用 `minWidth` 声明、不写 `width`，其余列写固定 `width`；不写 `scroll.x`，由组件按列宽之和推导
- 操作列使用 `createOperationColumn`；动作 label 使用纯文字，危险动作标 `danger: true`；桌面端内联动作不超过 3 个，
  `width` 按最宽内联组合计算（内容宽 + 40，向上取整到 10），状态特有 / 低频动作用 `desktopInlineKeys` 收进「更多」
- 状态列紧靠操作列左侧并固定在右侧；时间列使用 `dateTimeColumn` / `dateColumn` / `createdAtColumn` / `updatedAtColumn`
- 空值占位统一使用 `EMPTY_PLACEHOLDER`（`—`）

## 弹窗与表单约定

- 新增/编辑弹窗优先使用 `useEditModal` + `EditFormModal`（抽屉形态 `EditFormSheet`），页面只写字段
- `Form` 使用 `labelPosition="left"`；`Form key={modal.formKey}` 必须显式写出
- 所有 `Modal` 应允许 `closeOnEsc`；使用 `AppModal` 时默认具备 ESC 关闭与全屏按钮
- 单图上传使用 `ImageUploadField`；时区字段使用 `FormTimezoneSelect`
- 有明确上下界且适合拖动预览的数值字段使用 `SliderInput` / `FormSliderInput`
- 分割线使用 Semi `Divider` 或 `Dropdown.Divider`

## 布局与响应式约定

- 页面级业务 Tab 使用 `.page-container.page-tabs-page`，Tab 状态用 `useUrlTabState`
- 主从分栏使用 `MasterDetailLayout`；左侧平铺列表使用 `NavListPanel` + `NavListItem`
- 分栏选中项深链使用 `useUrlSelectionState`；同页已使用 `useUrlTabState` 时选中项保持本地 state
- 指标卡使用 `StatCard` + `StatGrid`；有界度量用 `MetricMeter`；排行/占比条用 `DataBar`
- 栅格使用 `StatGrid`、`.chart-grid` 或 `.auto-grid`，不要在行内样式写死列数
- 行内「图标 + 文字」「头像 + 姓名」「小按钮组」优先用 Semi `Space`，不要为替换已有复杂 flex 布局而引入回归风险

## 相关文档

- [公共组件](/frontend/components)
- [数据获取与服务端状态](/frontend/data-fetching)
- [前端路由与菜单](/frontend/routing)
- [认证与请求](/frontend/auth-request)
- [文件预览组件](/frontend/file-preview)
