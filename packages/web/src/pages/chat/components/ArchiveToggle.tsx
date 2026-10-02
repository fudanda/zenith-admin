import { Badge, Typography } from '@douyinfe/semi-ui';
import { Archive, ArrowLeft, ChevronRight } from 'lucide-react';
import type { ChatConversation } from '@arcbase/shared/chat';
import type { Setter } from '../types';

const { Text } = Typography;

/** 左栏「已归档会话」折叠开关行（自 ChatPage 原样搬移） */
export function ArchiveToggle({
  showArchived, setShowArchived, archivedConvs, archivedUnread,
}: Readonly<{
  showArchived: boolean;
  setShowArchived: Setter<boolean>;
  archivedConvs: ChatConversation[];
  archivedUnread: number;
}>) {
  return (
              <button
                type="button"
                onClick={() => setShowArchived((v) => !v)}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8, width: '100%',
                  padding: '8px 12px', border: 'none', cursor: 'pointer', textAlign: 'left',
                  background: showArchived ? 'var(--semi-color-fill-0)' : 'transparent',
                  borderBottom: '1px solid var(--semi-color-border)',
                }}
              >
                {showArchived
                  ? <ArrowLeft size={14} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />
                  : <Archive size={14} style={{ color: 'var(--semi-color-text-2)', flexShrink: 0 }} />}
                <Text strong style={{ fontSize: 12, flex: 1 }}>
                  {showArchived ? '返回会话列表' : `已归档（${archivedConvs.length}）`}
                </Text>
                {!showArchived && archivedUnread > 0 && (
                  <Badge count={archivedUnread} overflowCount={99} type="danger" />
                )}
                {!showArchived && <ChevronRight size={14} style={{ color: 'var(--semi-color-text-3)', flexShrink: 0 }} />}
              </button>
  );
}
