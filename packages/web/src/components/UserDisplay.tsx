import { formatUserLabel } from '../utils/user-labels';
import { Typography } from '@douyinfe/semi-ui';

/**
 * 表格用户单元格：单行「昵称（用户名）」，超宽省略并悬浮补全。
 * 昵称缺失或与用户名相同时退化为用户名。
 */
export function UserDisplayCell({ username, nickname }: Readonly<{ username: string | null | undefined; nickname?: string | null }>) {
  if (!username) return <span style={{ color: 'var(--semi-color-text-2)' }}>-</span>;
  return (
    <Typography.Text ellipsis={{ showTooltip: true }} style={{ maxWidth: '100%' }}>
      {formatUserLabel(username, nickname)}
    </Typography.Text>
  );
}
