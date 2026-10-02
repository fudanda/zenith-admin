import { Typography } from '@douyinfe/semi-ui';
import { useNavigate } from 'react-router-dom';
import { ClipboardCheck, FileEdit, Hourglass, MessageSquareText, Send, Undo2 } from 'lucide-react';
import type { WorkflowWorkbenchSummary } from '@arcbase/shared/workflow';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import { useWorkflowWorkbenchSummary } from '@/hooks/queries/workflow-instances';

/**
 * 发起工作台顶部的个人审批概览：按「需要我动手」排序，卡片即入口。
 * 服务端按权限逐项返回 null（无对应列表权限），这里据此不渲染卡片；数字为 0 仍保留卡片，布局不跳。
 */
type SummaryKey = Exclude<keyof WorkflowWorkbenchSummary, 'pendingOverdue'>;

interface CardSpec {
  readonly key: SummaryKey;
  readonly title: string;
  readonly icon: React.ReactNode;
  readonly to: string;
  /** 数值 > 0 时的强调色；0 用弱化色 */
  readonly accent: string;
}

const CARDS: readonly CardSpec[] = [
  { key: 'pending', title: '待我审批', icon: <ClipboardCheck size={16} />, to: '/workflow/pending', accent: 'var(--semi-color-primary)' },
  { key: 'consultsPending', title: '待我协办', icon: <MessageSquareText size={16} />, to: '/workflow/pending?consults=1', accent: 'var(--semi-color-primary)' },
  { key: 'ccUnread', title: '抄送未读', icon: <Send size={16} />, to: '/workflow/cc', accent: 'var(--semi-color-info)' },
  { key: 'myReturned', title: '退回待修改', icon: <Undo2 size={16} />, to: '/workflow/applications?status=returned', accent: 'var(--semi-color-warning)' },
  { key: 'myDrafts', title: '我的草稿', icon: <FileEdit size={16} />, to: '/workflow/applications?status=draft', accent: 'var(--semi-color-text-1)' },
  { key: 'myRunning', title: '审批中', icon: <Hourglass size={16} />, to: '/workflow/applications?status=running', accent: 'var(--semi-color-text-1)' },
];

const ZERO_COLOR = 'var(--semi-color-text-3)';
const LOADING_VALUE = '—';

export default function WorkbenchSummary() {
  const navigate = useNavigate();
  const { data, isPending } = useWorkflowWorkbenchSummary();

  // 首屏未拉到数据前按全部卡片占位；拉到后只保留有权限（非 null）的项
  const visible = data ? CARDS.filter((card) => data[card.key] !== null) : CARDS;
  if (visible.length === 0) return null;

  return (
    <section aria-label="我的审批概览" style={{ marginBottom: 16 }}>
      <StatGrid minItemWidth={150} gap={12}>
        {visible.map((card) => {
          const value = data?.[card.key] ?? null;
          const overdue = card.key === 'pending' ? data?.pendingOverdue ?? 0 : 0;
          return (
            <StatCard
              key={card.key}
              title={card.title}
              icon={card.icon}
              value={isPending || value === null ? LOADING_VALUE : value}
              accent={value ? card.accent : ZERO_COLOR}
              sub={overdue > 0 ? <Typography.Text type="danger" size="small">超时 {overdue}</Typography.Text> : undefined}
              onClick={() => navigate(card.to)}
            />
          );
        })}
      </StatGrid>
    </section>
  );
}
