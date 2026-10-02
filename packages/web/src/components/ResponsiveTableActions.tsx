import type { ReactNode } from 'react';
import { Button, Dropdown, Space, Tooltip } from '@douyinfe/semi-ui';
import type { ColumnProps, Data } from '@douyinfe/semi-ui/lib/es/table';
import { MoreHorizontal } from 'lucide-react';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { ARCBASE_OPERATION_COLUMN_SYMBOL, type ArcBaseOperationColumnMarker } from './table-column-meta';

type OperationColumnRecord = Data;
type OperationColumn<RecordType extends OperationColumnRecord> = ColumnProps<RecordType> & ArcBaseOperationColumnMarker;
type InlineActionButtonType = 'primary' | 'secondary' | 'tertiary' | 'warning' | 'danger';

export const OPERATION_COLUMN_KEY = 'operation';

export interface ResponsiveTableAction {
  key: string;
  label: ReactNode;
  onClick?: () => void | Promise<void>;
  danger?: boolean;
  type?: InlineActionButtonType;
  loading?: boolean;
  disabled?: boolean;
  disabledReason?: ReactNode;
  hidden?: boolean;
  dividerBefore?: boolean;
}

interface ResponsiveTableActionsProps {
  actions: ResponsiveTableAction[];
  desktopInlineKeys?: string[];
  menuAriaLabel?: string;
  emptyContent?: ReactNode;
}

interface OperationColumnOptions<RecordType extends OperationColumnRecord> {
  actions: (record: RecordType) => ResponsiveTableAction[];
  /** 按 ui-patterns.md → 操作列 的公式取值：最宽内联组合的内容宽 + 40，向上取整到 10 */
  width: number;
  title?: ReactNode;
  /** 桌面端内联的动作 key（≤ 3 个），其余进「更多」菜单；省略则全部内联 */
  desktopInlineKeys?: string[];
  menuAriaLabel?: string;
  emptyContent?: ReactNode | ((record: RecordType) => ReactNode);
}

function visibleActions(actions: ResponsiveTableAction[]) {
  return actions.filter((action) => !action.hidden);
}

function runAction(action: ResponsiveTableAction) {
  if (action.disabled || action.loading) return;
  void action.onClick?.();
}

function renderActionMenu(actions: ResponsiveTableAction[]) {
  const items: ReactNode[] = [];

  actions.forEach((action, index) => {
    if (action.dividerBefore && index > 0) {
      items.push(<Dropdown.Divider key={`${action.key}-divider`} />);
    }
    items.push(
      <Dropdown.Item
        key={action.key}
        type={action.danger || action.type === 'danger' ? 'danger' : undefined}
        disabled={action.disabled || action.loading}
        onClick={() => runAction(action)}
      >
        {action.label}
      </Dropdown.Item>,
    );
  });

  return <Dropdown.Menu>{items}</Dropdown.Menu>;
}

function ActionMenuButton({
  actions,
  ariaLabel,
}: Readonly<{
  actions: ResponsiveTableAction[];
  ariaLabel: string;
}>) {
  if (actions.length === 0) return null;

  return (
    <Dropdown
      trigger="click"
      position="bottomRight"
      clickToHide
      render={renderActionMenu(actions)}
    >
      <Button
        theme="borderless"
        size="small"
        icon={<MoreHorizontal size={14} />}
        aria-label={ariaLabel}
        title={ariaLabel}
      />
    </Dropdown>
  );
}

function InlineActionButton({ action }: Readonly<{ action: ResponsiveTableAction }>) {
  const button = (
    <Button
      theme="borderless"
      type={action.danger ? 'danger' : action.type}
      size="small"
      disabled={action.disabled}
      loading={action.loading}
      onClick={() => runAction(action)}
    >
      {action.label}
    </Button>
  );

  if (!action.disabled || !action.disabledReason) return button;

  return (
    <Tooltip content={action.disabledReason}>
      <span className="responsive-table-actions__tooltip-wrap">{button}</span>
    </Tooltip>
  );
}

export function ResponsiveTableActions({
  actions,
  desktopInlineKeys,
  menuAriaLabel = '更多操作',
  emptyContent,
}: Readonly<ResponsiveTableActionsProps>) {
  const isMobile = useIsMobile();
  const filteredActions = visibleActions(actions);

  if (filteredActions.length === 0) {
    return emptyContent ?? <span className="table-cell-placeholder">—</span>;
  }

  if (isMobile) {
    return (
      <div className="responsive-table-actions responsive-table-actions--mobile">
        <ActionMenuButton actions={filteredActions} ariaLabel={menuAriaLabel} />
      </div>
    );
  }

  const inlineKeySet = desktopInlineKeys ? new Set(desktopInlineKeys) : null;
  const inlineActions = inlineKeySet
    ? filteredActions.filter((action) => inlineKeySet.has(action.key))
    : filteredActions;
  const menuActions = inlineKeySet
    ? filteredActions.filter((action) => !inlineKeySet.has(action.key))
    : [];

  return (
    <Space className="responsive-table-actions" spacing={4}>
      {inlineActions.map((action) => (
        <InlineActionButton key={action.key} action={action} />
      ))}
      <ActionMenuButton actions={menuActions} ariaLabel={menuAriaLabel} />
    </Space>
  );
}

export function createOperationColumn<RecordType extends OperationColumnRecord>({
  actions,
  width,
  title = '操作',
  desktopInlineKeys,
  menuAriaLabel,
  emptyContent,
}: Readonly<OperationColumnOptions<RecordType>>): OperationColumn<RecordType> {
  return {
    key: OPERATION_COLUMN_KEY,
    title,
    fixed: 'right',
    [ARCBASE_OPERATION_COLUMN_SYMBOL]: true,
    width,
    render: (_: unknown, record: RecordType) => {
      const resolvedEmptyContent = typeof emptyContent === 'function' ? emptyContent(record) : emptyContent;
      return (
        <ResponsiveTableActions
          actions={actions(record)}
          desktopInlineKeys={desktopInlineKeys}
          menuAriaLabel={menuAriaLabel}
          emptyContent={resolvedEmptyContent}
        />
      );
    },
  };
}

export default ResponsiveTableActions;
