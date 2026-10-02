import { describe, expect, it } from 'vitest';
import type { ChatConversation } from '@arcbase/shared/chat';
import type { LeftListItem } from '../types';
import { areLeftListRowPropsEqual, toLeftListRowProps, type LeftListContext } from './left-list-row-props';

function conv(id: number, overrides: Partial<ChatConversation> = {}): ChatConversation {
  return {
    id, type: 'direct', name: null, unreadCount: 0, lastMessage: null, updatedAt: '2026-01-01 00:00:00',
    targetUser: { id: 100 + id, nickname: `用户${id}`, avatar: null },
    ...overrides,
  } as unknown as ChatConversation;
}

const noop = (() => undefined) as never;

function ctx(overrides: Partial<LeftListContext> = {}): LeftListContext {
  return {
    activeChannelId: null, activeConvId: 1, groupAvatarMap: {}, onlineUserIds: new Set([102]), failedMessages: [], draftsMap: { 2: '还没发出去' },
    channelAvatarNode: noop, setActiveChannelId: noop, setActiveConvId: noop, setChannels: noop, handleSelectConv: noop, setLeftPaneContextMenu: noop,
    ...overrides,
  };
}

const item = (c: ChatConversation): LeftListItem => ({ kind: 'conv', sortTime: 0, pinned: false, conv: c });

describe('toLeftListRowProps', () => {
  it('把列表级集合裁成本行的值：激活态 / 在线 / 草稿 / 发送失败', () => {
    const c2 = conv(2);
    const props = toLeftListRowProps(item(c2), ctx(), new Set([2]));
    expect(props).toMatchObject({ isActive: false, isTargetOnline: true, hasFailedMsg: true, draftText: '还没发出去', groupMembers: undefined });
  });

  it('激活会话不展示草稿（正在输入框里编辑）', () => {
    const props = toLeftListRowProps(item(conv(1)), ctx({ draftsMap: { 1: '正在写' } }), new Set());
    expect(props.isActive).toBe(true);
    expect(props.draftText).toBe('');
  });
});

describe('areLeftListRowPropsEqual', () => {
  const c2 = conv(2);

  it('列表重算产生新的 item 包装、但会话对象与其它入参不变 → 视为相等，跳过重渲染', () => {
    const before = toLeftListRowProps(item(c2), ctx(), new Set());
    const after = toLeftListRowProps(item(c2), ctx(), new Set());
    expect(areLeftListRowPropsEqual(before, after)).toBe(true);
  });

  it('本行会话对象被替换（新消息 / 未读数变化）→ 不相等', () => {
    const before = toLeftListRowProps(item(c2), ctx(), new Set());
    const after = toLeftListRowProps(item(conv(2, { unreadCount: 3 })), ctx(), new Set());
    expect(areLeftListRowPropsEqual(before, after)).toBe(false);
  });

  it('只有别的会话的草稿 / 在线状态变化 → 本行仍相等', () => {
    const before = toLeftListRowProps(item(c2), ctx(), new Set());
    const after = toLeftListRowProps(item(c2), ctx({ draftsMap: { 2: '还没发出去', 3: '别人的草稿' }, onlineUserIds: new Set([102, 103]) }), new Set());
    expect(areLeftListRowPropsEqual(before, after)).toBe(true);
  });

  it('本行草稿 / 在线 / 激活态变化 → 不相等', () => {
    const before = toLeftListRowProps(item(c2), ctx(), new Set());
    expect(areLeftListRowPropsEqual(before, toLeftListRowProps(item(c2), ctx({ draftsMap: {} }), new Set()))).toBe(false);
    expect(areLeftListRowPropsEqual(before, toLeftListRowProps(item(c2), ctx({ onlineUserIds: new Set() }), new Set()))).toBe(false);
    expect(areLeftListRowPropsEqual(before, toLeftListRowProps(item(c2), ctx({ activeConvId: 2 }), new Set()))).toBe(false);
  });
});
