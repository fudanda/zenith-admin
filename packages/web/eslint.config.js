import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import reactHooks from 'eslint-plugin-react-hooks';
import reactRefresh from 'eslint-plugin-react-refresh';
import pluginQuery from '@tanstack/eslint-plugin-query';

// ── @arcbase/shared 引用纪律：根入口与旧巨石路径禁止；把全部域收拢在一起的聚合模块只允许 Demo Mock 引用 ──
const sharedRootImportRestrictions = [
  {
    name: '@arcbase/shared',
    message:
      "请改用域子路径：'@arcbase/shared/identity' | 'payment' | 'workflow' | 'cms' | 'report' | 'core' 等；种子数据用 '@arcbase/shared/seed'。",
  },
  { name: '@arcbase/shared/types', message: "旧巨石路径已删除，请改用 '@arcbase/shared/<domain>'。" },
  { name: '@arcbase/shared/validation', message: "旧巨石路径已删除，请改用 '@arcbase/shared/<domain>'。" },
  { name: '@arcbase/shared/constants', message: "旧巨石路径已删除，请改用 '@arcbase/shared/<domain>'。" },
  { name: '@arcbase/shared/seed-data', message: "旧巨石路径已删除，请改用 '@arcbase/shared/seed'。" },
];
const SHARED_AGGREGATE_MESSAGE =
  '聚合模块会把全部域契约拆进产物并让 app-shared 膨胀：只 import 域子路径（@arcbase/shared/<domain>）或叶子模块'
  + '（@arcbase/shared/permission-catalog-core）；需要全部契约派生的数据由服务端接口下发（如 GET /api/api-catalog）。';
const sharedAggregateImportRestrictions = [
  { name: '@arcbase/shared/contracts', message: SHARED_AGGREGATE_MESSAGE },
  { name: '@arcbase/shared/permissions', message: SHARED_AGGREGATE_MESSAGE },
  { name: '@arcbase/shared/permission-catalog', message: SHARED_AGGREGATE_MESSAGE },
];

// ── 图标纪律：@iconify/react 在运行时向公网 Iconify API 拉图标数据（内网 / 离线 / Demo 下空白，登录页还多一个第三方源）。
//    文件类型 / 文件夹 / shell 图标走 components/FileTypeIcon（构建期生成的 SVG 资产），单色品牌图标走 components/icons/MonoIcon；
//    新增图标字面量后运行 `npm run icons:iconify`。其余图标一律 lucide-react ──
const iconifyRuntimeRestrictions = [
  {
    name: '@iconify/react',
    message: '禁止运行时拉取 Iconify 图标：文件类型图标用 @/components/FileTypeIcon，单色图标用 @/components/icons/MonoIcon（npm run icons:iconify 生成数据），其余用 lucide-react。',
  },
];

// ── 平台 API 纪律：内网以 http://ip 访问时不是安全上下文，navigator.clipboard 为 undefined，
//    读写统一走 @/utils/clipboard（写文本可回退 execCommand，读文本 / 写图片由调用方降级）──
const clipboardRestrictions = [
  {
    selector: 'MemberExpression[object.property.name="clipboard"][property.name=/^(writeText|readText)$/]',
    message: '请使用 @/utils/clipboard 的 copyText / copyTextWithToast / readClipboardText；非安全上下文（HTTP）下 navigator.clipboard 不存在。',
  },
];

// ── 列表页搜索纪律（constraints-frontend.md → 必须复用的公共 hook / 搜索栏与表格）：
//    受控筛选控件一律 {...bind('字段')} / {...bindKeyword('keyword')}，时间区间一律 DateRangeFilter。
//    漏用这些封装不会报错，只会表现为「点查询没反应」「回车不查询」等难以发现的行为异常。──
const listSearchRestrictions = [
  {
    selector: 'CallExpression[callee.name="setDraftParams"] > ObjectExpression[properties.length=1]',
    message: '单字段草稿写入请用 useListSearch 的 bind(\'字段\') / bindKeyword(\'keyword\') 整体绑定控件；一次改多个字段才用 setDraftParams((p) => ({ ...p, a, b }))。',
  },
  {
    selector: 'JSXAttribute[name.name="onChange"] > JSXExpressionContainer > CallExpression[callee.name="setField"]',
    message: '受控筛选控件请用 {...bind(\'字段\')} 整体绑定，控件回传比字段宽时传 parse：bind(\'x\', (v) => …)；setField 只用于 Checkbox 等非 value / onChange 形态的控件。',
  },
  {
    selector: 'JSXOpeningElement[name.name="DatePicker"] > JSXAttribute[name.name="type"] > Literal[value=/Range$/]',
    message: '搜索区的时间区间请用 @/components/search-filters 的 DateRangeFilter（秒级默认，日期级 type="dateRange"）；表单内用 Form.DatePicker。',
  },
  {
    selector: 'LogicalExpression[operator="||"][right.type="Identifier"][right.name="undefined"]:matches([left.object.name=/^submitted/], [left.object.property.name=/^submitted/], [left.callee.object.object.name=/^submitted/], [left.callee.object.object.property.name=/^submitted/])',
    message: '已提交筛选 → 契约查询参数只映射一次：标准分页列表用 useListPage({ toQuery: (s) => ({ keyword: s.keyword, … }) })，其余用 const filterQuery = useFilterQuery({ keyword: submittedParams.keyword, … })；不要逐字段写 `x || undefined`。布尔开关按「勾选才筛选」语义写 `flag ? true : undefined`。',
  },
  {
    // useMemo(() => compactParams({…}), [deps]) 的手写依赖数组形态：内容键控的 useFilterQuery 已把它收口
    selector: 'CallExpression[callee.name="useMemo"] > ArrowFunctionExpression > CallExpression[callee.name="compactParams"]',
    message: '已提交筛选 → 契约查询参数请用 @/hooks/useFilterQuery 的 useFilterQuery({ … })（compactParams 后按内容稳定引用，无需依赖数组）；标准分页列表页直接在 useListPage 的 toQuery 里映射。',
  },
  {
    // 按上下文兜底：不论草稿对象叫什么（catalogSearch / f / draft…），列表 hook 实参与导出 query 里的 `x || undefined` 都应由 compactParams 归一
    selector: ':matches(CallExpression[callee.name=/^use[A-Z]\\w*(List|Lists|Logs|Records|Catalog|Templates|Deliveries)$/] > ObjectExpression, JSXAttribute[name.name="query"] > JSXExpressionContainer) LogicalExpression[operator="||"][right.type="Identifier"][right.name="undefined"]',
    message: '列表查询 / 导出条件里的 `x || undefined` 请统一由 compactParams({ … }) 一次映射（丢弃 undefined / null / 空串、保留 0 / false），列表与 ExportButton 共用同一份 filterQuery。',
  },
  {
    // 手写「刷新回到第 1 页」的另一形态：resetPage() 同样应改为 resetKey
    selector: 'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression:matches([body.type="CallExpression"][body.callee.name="resetPage"], [body.type="BlockStatement"][body.body.length=1][body.body.0.expression.callee.name="resetPage"])',
    message: '外部作用域切换回第 1 页请用 useListSearch / usePagination 的 resetKey（多个来源传数组），不要在 useEffect 里调用 resetPage()。',
  },
  {
    selector: 'CallExpression[callee.name="useEffect"] > ArrowFunctionExpression:matches([body.type="CallExpression"][body.callee.name="setPage"][body.arguments.0.value=1], [body.type="CallExpression"][body.callee.property.name="setPage"][body.arguments.0.value=1], [body.type="BlockStatement"][body.body.length=1][body.body.0.expression.callee.name="setPage"][body.body.0.expression.arguments.0.value=1], [body.type="BlockStatement"][body.body.length=1][body.body.0.expression.callee.property.name="setPage"][body.body.0.expression.arguments.0.value=1])',
    message: '外部作用域（当前公众号 / 站点 / 空间 / 目录）切换回第 1 页请用 useListSearch / usePagination 的 resetKey（多个来源传数组）；useEffect(() => setPage(1), [scopeId]) 会先用旧页码请求一次新作用域的数据。',
  },
];

// ── 列表页样板纪律（constraints-frontend.md → 必须复用的公共 hook / 表格列）：
//    删除确认 + 成功提示、多选状态、启用/禁用状态标签都已收口到 components/list-page 与 utils/table-columns，
//    页面内再手写一遍只会在文案、颜色、清选中等细节上慢慢漂移。──
const listPageBoilerplateRestrictions = [
  {
    // hasPermission('x') ? <CreateButton /> : null 与 can('x') && <CreateButton /> 两种写法
    selector: ':matches(ConditionalExpression[test.type="CallExpression"][test.callee.name=/^(hasPermission|can)$/][test.arguments.0.type="Literal"][alternate.type="Literal"][alternate.raw="null"] > JSXElement[openingElement.name.name="CreateButton"].consequent, LogicalExpression[operator="&&"][left.type="CallExpression"][left.callee.name=/^(hasPermission|can)$/][left.arguments.0.type="Literal"] > JSXElement[openingElement.name.name="CreateButton"].right)',
    message: '新增按钮的权限门交给 CreateButton 自身：<CreateButton permission="x:create" onClick={…} />（同 ExportButton permission），不要在外面包 hasPermission(…) ? … : null。',
  },
  {
    selector: 'CallExpression[callee.name="confirmDelete"] CallExpression[callee.object.name="Toast"][callee.property.name="success"]',
    message: '删除确认后再手写 Toast.success 的组合请用 @/components/list-page 的 deleteAction（操作列）/ confirmAndDelete（批量、面板内）；confirmDelete 只留给不提示成功的场景。',
  },
  {
    selector: ':matches(Property[key.name="rowSelection"], JSXAttribute[name.name="rowSelection"]) Property[key.name="onChange"] > ArrowFunctionExpression TSAsExpression:matches([expression.type="Identifier"], [expression.type="LogicalExpression"])',
    message: '表格多选状态请用 @/components/list-page 的 useRowSelection()，直接把返回的 rowSelection 交给表格；额外的 getCheckboxProps / fixed 走 extra 参数。',
  },
  {
    selector: 'JSXOpeningElement[name.name="Tag"] > JSXAttribute[name.name="color"] > JSXExpressionContainer > ConditionalExpression > BinaryExpression[right.value="enabled"]',
    message: 'enabled / disabled 两态状态标签请用 @/utils/table-columns 的 renderEnabledStatusTag（文案与颜色跟随 COMMON_STATUS_LABELS）；三态或语义不同的标签请加 eslint-disable 注释并注明理由。',
  },
  {
    // 另一形态：x === 'enabled' ? <Tag …>启用</Tag> : <Tag …>停用</Tag>（整段 Tag 三元）
    selector: 'ConditionalExpression[test.type="BinaryExpression"][test.operator="==="][test.right.value="enabled"][consequent.type="JSXElement"][consequent.openingElement.name.name="Tag"][alternate.type="JSXElement"][alternate.openingElement.name.name="Tag"]',
    message: 'enabled / disabled 两态状态标签请用 @/utils/table-columns 的 renderEnabledStatusTag / enabledStatusColumn()（文案与颜色跟随 COMMON_STATUS_LABELS）；三态标签只把两态分支换成 renderEnabledStatusTag(v)。',
  },
  {
    // AppModal({...x.modalProps}) > [Spin] > Form(key={x.formKey}) 三层壳：EditFormModal 已收口（Form 之前另有 Banner 传 header）
    selector: ':matches(JSXElement[openingElement.name.name="AppModal"] > JSXElement[openingElement.name.name="Form"], JSXElement[openingElement.name.name="AppModal"] > JSXElement[openingElement.name.name="Spin"] > JSXElement[openingElement.name.name="Form"]):has(JSXOpeningElement[name.name="Form"] > JSXAttribute[name.name="key"] > JSXExpressionContainer > MemberExpression[property.name="formKey"])',
    message: '新增 / 编辑弹窗壳请用 @/components/EditFormModal：<EditFormModal modal={modal} width={…}>字段</EditFormModal>（Form 之前的说明传 header，Form 额外属性传 formProps）；抽屉形态用 EditFormSheet。表单之外还有独立编辑区的复合弹窗保留 AppModal 并加 eslint-disable 注释注明理由。',
  },
  {
    // SideSheet(visible={x.visible} onCancel={x.close} footer={<ModalFooter {...x.footerProps} …/>}) > [Spin] > Form(key={x.formKey})
    selector: ':matches(JSXElement[openingElement.name.name="SideSheet"] > JSXElement[openingElement.name.name="Form"], JSXElement[openingElement.name.name="SideSheet"] > JSXElement[openingElement.name.name="Spin"] > JSXElement[openingElement.name.name="Form"]):has(JSXOpeningElement[name.name="Form"] > JSXAttribute[name.name="key"] > JSXExpressionContainer > MemberExpression[property.name="formKey"])',
    message: '新增 / 编辑侧滑抽屉壳请用 @/components/EditFormModal 的 EditFormSheet：<EditFormSheet modal={modal} width={…}>字段</EditFormSheet>；完全自定义 footer 传 footer，追加收尾的关闭逻辑传 onCancel。',
  },
  {
    selector: 'JSXAttribute[name.name="wrapperClassName"] > Literal[value="modal-spin-wrapper"]',
    message: 'modal-spin-wrapper 没有任何 CSS 定义（Semi 带 children 的 Spin 本就是 block）：编辑表单壳用 EditFormModal / EditFormSheet，其它 Spin 直接去掉该属性。',
  },
  {
    // 契约模式的 useListPage 页面里仍手写工具栏槽位控件：筛选控件应由契约 x-filter 派生（filters={[…]}），专用控件走 overrides
    selector: 'JSXOpeningElement[name.name="ListSearchToolbar"]:has(JSXAttribute[name.name="page"]):has(JSXAttribute[name.name=/^(keyword|onSearch|onReset)$/])',
    message: '契约写法的 ListSearchToolbar 只声明 page + filters（键序，成对时间端点写 [start, end]）；keyword / onSearch / onReset 由 page 派生，专用控件放 overrides，契约之外的手写控件放 extraFilters。',
  },
  {
    // createOperationColumn 里相邻的「编辑 + deleteAction」二元组：useCrudOperationColumn 已收口权限门控、确认与执行
    selector: 'CallExpression[callee.name="createOperationColumn"] ArrayExpression > ObjectExpression:has(Property[key.name="key"] > Literal[value="edit"]) + CallExpression[callee.name="deleteAction"]',
    message: '操作列的「编辑 + 删除」请用 @/components/list-page 的 useCrudOperationColumn({ permission, edit, remove, label, extra… })；条件数组 / useMemo 内定义 / 仅删除的列继续 createOperationColumn 并加 eslint-disable 注释注明理由。',
  },
];

// ── Mock 纪律（crud-mock.md）：可选等值筛选统一 matchesFilter(actual, expected)，
//    手写 `!query.x || item.x === query.x` 会把 false / 0 当成「未筛选」。──
const mockRestrictions = [
  {
    selector: 'LogicalExpression[operator="||"][left.type="UnaryExpression"][left.operator="!"][left.argument.type="MemberExpression"][left.argument.object.name="query"] > BinaryExpression.right[operator="==="]',
    message: '可选等值筛选请用 @/mocks/utils/filter 的 matchesFilter(item.x, query.x)；`!query.x || …` 会把 false / 0 误判为未筛选。',
  },
];

export default [
  { ignores: ['dist/**', 'node_modules/**', 'public/mockServiceWorker.js'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  ...pluginQuery.configs['flat/recommended'],
  {
    rules: {
      // queryFn 引用变量必须进 queryKey 的检查误报较多（如 silent 等仅影响行为不影响数据的选项），
      // 关闭此条；插件其余规则（no-unstable-deps 等）保留
      '@tanstack/query/exhaustive-deps': 'off',
    },
  },
  {
    languageOptions: {
      parserOptions: {
        tsconfigRootDir: import.meta.dirname,
        warnOnUnsupportedTypeScriptVersion: false,
      },
    },
  },
  {
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      // Classic react-hooks rules only (v7 compiler rules are too strict for this codebase)
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': [
        'warn',
        {
          allowConstantExport: true,
          // MasterDetailLayout 用 Object.assign 挂载 Header/Body 子组件，视为类 HOC 导出；
          // Semi Form 的 withField(自定义控件) 同样是 HOC 导出（FormXxx 字段包装）
          extraHOCs: ['assign', 'withField'],
          // 与组件强相关的工厂函数/选项常量，允许与组件同文件导出
          allowExportNames: ['createOperationColumn', 'DATA_SCOPE_OPTIONS'],
        },
      ],
      '@typescript-eslint/no-explicit-any': 'warn',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      // @arcbase/shared 已按业务域拆分：根入口会把全部 18 个域拉进依赖图与前端产物，
      // 使「改 CMS 类型」这类局部改动波及所有消费方，故禁止直接引用根入口与已废弃的旧巨石路径。
      'no-restricted-imports': ['error', { paths: [...sharedRootImportRestrictions, ...iconifyRuntimeRestrictions] }],
      // 同名规则在后续 files 更窄的配置块中会被整体覆盖而非合并，Token 纪律块需再带一份 clipboardRestrictions
      'no-restricted-syntax': ['error', ...clipboardRestrictions],
    },
  },
  {
    // ── 业务模块禁止 import @arcbase/shared 的聚合模块；mocks 只进 Demo 构建、测试不进产物，均放行 ──
    files: ['src/**/*.ts', 'src/**/*.tsx'],
    ignores: ['src/mocks/**', 'src/**/*.test.ts', 'src/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': ['error', { paths: [...sharedRootImportRestrictions, ...sharedAggregateImportRestrictions, ...iconifyRuntimeRestrictions] }],
    },
  },
  {
    // ── Token 纪律（防复发）：与 .stylelintrc.json 的 CSS 规则对应 ──
    // member/approval 为独立主题端，mocks 为静态数据，均不受偏好系统管辖
    files: ['src/**/*.tsx'],
    ignores: ['src/member/**', 'src/approval/**', 'src/mocks/**'],
    rules: {
      'no-restricted-syntax': [
        'error',
        ...clipboardRestrictions,
        ...listSearchRestrictions,
        ...listPageBoilerplateRestrictions,
        {
          selector: 'Property[key.name="borderRadius"][value.type="Literal"][value.value>=2][value.value<=14]',
          message: '内联圆角请使用 var(--semi-border-radius-small/medium/large)，以便跟随「圆角大小」偏好；刻意的造型值请加 eslint-disable 注释并注明理由。',
        },
        {
          selector: String.raw`Property[key.name="boxShadow"] Literal[value=/rgba\(\s*0\s*,\s*0\s*,\s*0/]`,
          message: '自写黑色阴影暗色模式下不可见，请使用 var(--semi-shadow-elevated)；刻意的强调投影请加 eslint-disable 注释并注明理由。',
        },
        {
          // JSX 子节点里直写 {formatDateTime(x)} / {x ? formatDateTime(x) : '—'}：时间元信息应跟随「时间显示方式」偏好
          selector: ':matches(JSXElement > JSXExpressionContainer > CallExpression[callee.name="formatDateTime"], JSXElement > JSXExpressionContainer > ConditionalExpression > CallExpression[callee.name="formatDateTime"])',
          message: '展示时间请用 @/components/DateTimeText（跟随「时间显示方式」偏好，相对形态悬停显示精确时刻，空值占位内建）；详情字段等需固定精确时刻的位置传 mode="absolute"。formatDateTime() 只用于数据语义（导出文件名、拼接文本、表单值）。',
        },
      ],
    },
  },
  {
    // 会员端 / 审批端不受 Token 纪律管辖，但列表页搜索与样板纪律同样适用
    files: ['src/member/**/*.tsx', 'src/approval/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['error', ...clipboardRestrictions, ...listSearchRestrictions, ...listPageBoilerplateRestrictions],
    },
  },
  {
    // ── MSW Mock handler：同名规则整体覆盖，故把 clipboardRestrictions 一并带上 ──
    files: ['src/mocks/**/*.ts'],
    ignores: ['src/mocks/**/*.test.ts'],
    rules: {
      'no-restricted-syntax': ['error', ...clipboardRestrictions, ...mockRestrictions],
    },
  },
  {
    // ── 域 hooks 由契约派生：服务端状态一律经 lib/contract-query 访问，key 由 contractKey 生成 ──
    // 同名规则整体覆盖，故此处把根配置的 @arcbase/shared 路径限制一并带上
    files: ['src/hooks/queries/**/*.ts'],
    ignores: ['src/hooks/queries/**/*.test.ts', 'src/hooks/queries/**/*.test.tsx'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          paths: [
            {
              name: '@tanstack/react-query',
              importNames: ['useQuery', 'useMutation'],
              message:
                '域 hooks 用 useApiQuery / apiQueryOptions / useApiMutation / useSaveMutation / createResourceQueries（lib/contract-query）；'
                + '仅组合多次请求、非契约通道、多操作分派、上传进度等场景可手写，须在 import 行加 eslint-disable 并注明理由，且 queryKey 仍由 contractKey 生成。',
            },
            { name: '@arcbase/shared', message: "请改用域子路径 '@arcbase/shared/<domain>'。" },
            ...sharedAggregateImportRestrictions,
            ...iconifyRuntimeRestrictions,
          ],
        },
      ],
    },
  },
];
