import { createLabelOptions, createLabelOptionsFromMap } from './enum-options';

export const API_PREFIX = '/api';

export const TOKEN_KEY = 'arcbase_token';

export const REFRESH_TOKEN_KEY = 'arcbase_refresh_token';

export const PREFERENCES_KEY = 'arcbase_preferences';

export const TABS_STORAGE_KEY = 'arcbase_tabs';

// ─── 账号切换器（Account Switcher）──────────────────────────────────
/** 停靠账号注册表的 localStorage key（仅存非活跃账号：资料快照 + refreshToken） */
export const ACCOUNTS_STORE_KEY = 'arcbase_accounts';

/** 同时保持登录的账号总数上限（1 个活跃 + 最多 4 个停靠） */
export const MAX_STORED_ACCOUNTS = 5;

/** 账号切换跨标签页广播 key：写入时间戳通知其他标签页整页重载为新账号 */
export const ACCOUNT_SWITCH_BROADCAST_KEY = 'arcbase_account_switch';

// ─── 模拟登录（Impersonation）───────────────────────────────────────
/**
 * 当前浏览器处于模拟登录态的本地标记（操作者身份 + 目标 + 到期时间）。
 * 模拟态只持有目标身份的 access token（REFRESH_TOKEN_KEY 为空），操作者凭证停靠在 ACCOUNTS_STORE_KEY 里，
 * 结束 / 到期 / 被强制结束时据此标记回切操作者账号而不是回登录页。
 */
export const IMPERSONATION_STORE_KEY = 'arcbase_impersonation';

export const USER_STATUSES = ['enabled', 'disabled'] as const;

/** 通用启用/禁用状态标签（与 common_status 字典种子文案一致；server 导出等无法走字典的场景使用） */
export const COMMON_STATUS_LABELS = { enabled: '启用', disabled: '禁用' } as const;

/** 通用启用/禁用下拉选项（与 COMMON_STATUS_LABELS 自动同步；行为中心事件覆盖/分群等复用） */
export const COMMON_STATUS_OPTIONS: Array<{ value: keyof typeof COMMON_STATUS_LABELS; label: string }> =
  createLabelOptionsFromMap(COMMON_STATUS_LABELS);

// ─── 会员中心（Member Center）────────────────────────────────────────
/** 会员前台 token 的 localStorage key（与管理员 arcbase_token 隔离）*/
export const MEMBER_TOKEN_KEY = 'arcbase_member_token';

export const MEMBER_REFRESH_TOKEN_KEY = 'arcbase_member_refresh_token';

// ─── 通用比较运算符 ────────────────────────────────────────────────────
export const BASIC_COMPARISON_OPERATORS = ['eq', 'neq', 'gt', 'gte', 'lt', 'lte'] as const;

export type BasicComparisonOperator = (typeof BASIC_COMPARISON_OPERATORS)[number];

export const BASIC_COMPARISON_OPERATOR_LABELS: Record<BasicComparisonOperator, string> = {
  eq: '等于 =',
  neq: '不等于 ≠',
  gt: '大于 >',
  gte: '大于等于 ≥',
  lt: '小于 <',
  lte: '小于等于 ≤',
};

export const BASIC_COMPARISON_OPERATOR_OPTIONS: Array<{ value: BasicComparisonOperator; label: string }> =
  createLabelOptions(BASIC_COMPARISON_OPERATORS, BASIC_COMPARISON_OPERATOR_LABELS);

export const BASIC_COMPARISON_OPERATOR_SYMBOLS: Record<BasicComparisonOperator, string> = {
  eq: '=',
  neq: '≠',
  gt: '>',
  gte: '≥',
  lt: '<',
  lte: '≤',
};

export const BASIC_COMPARISON_SYMBOL_OPTIONS: Array<{
  value: BasicComparisonOperator;
  label: string;
}> = createLabelOptions(BASIC_COMPARISON_OPERATORS, BASIC_COMPARISON_OPERATOR_SYMBOLS);

// ─── 自 validation 上移（枚举 SSOT：供跨域 z.enum() 引用，避免 validation 间值环）───
export const DATE_TIME_PATTERN = /^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/;
