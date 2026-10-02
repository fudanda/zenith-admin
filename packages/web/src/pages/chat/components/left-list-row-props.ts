import type { ReactNode } from 'react';
import type { ChatConversation } from '@arcbase/shared/chat';
import type { Channel } from '@arcbase/shared/messaging';
import type { FailedMessage, GroupAvatarMap, LeftListItem, LeftPaneContextMenuState, Setter } from '../types';

/**
 * 左栏列表的列表级输入（ChatPage 一次性传入）。
 * 行组件不直接消费这些集合：`toLeftListRowProps` 把每行用到的部分裁成值 / 稳定引用，
 * 这样输入框击键、在线状态、别人的草稿等无关变化都不会让整列会话行重渲染。
 */
export interface LeftListContext {
  activeChannelId: number | null;
  activeConvId: number | null;
  groupAvatarMap: GroupAvatarMap;
  onlineUserIds: Set<number>;
  failedMessages: FailedMessage[];
  draftsMap: Record<number, string>;
  channelAvatarNode: (ch: Channel) => ReactNode;
  setActiveChannelId: Setter<number | null>;
  setActiveConvId: Setter<number | null>;
  setChannels: Setter<Channel[]>;
  /** 必须是稳定引用（ChatPage 经 useEventCallback 包装），否则每次击键都会击穿行 memo */
  handleSelectConv: (conv: ChatConversation) => Promise<void>;
  setLeftPaneContextMenu: Setter<LeftPaneContextMenuState | null>;
}

/** 单行入参：只含本行用到的值与稳定回调，配合 memo */
export interface LeftListRowProps {
  item: LeftListItem;
  isActive: boolean;
  /** 单聊对方在线（频道 / 群聊恒为 false） */
  isTargetOnline: boolean;
  /** 群头像九宫格成员（仅群聊） */
  groupMembers: GroupAvatarMap[number] | undefined;
  hasFailedMsg: boolean;
  /** 非激活会话的草稿文本（激活会话正在输入框里编辑，不在列表预览） */
  draftText: string;
  channelAvatarNode: (ch: Channel) => ReactNode;
  setActiveChannelId: Setter<number | null>;
  setActiveConvId: Setter<number | null>;
  setChannels: Setter<Channel[]>;
  handleSelectConv: (conv: ChatConversation) => Promise<void>;
  setLeftPaneContextMenu: Setter<LeftPaneContextMenuState | null>;
}

/** 由列表级输入裁出某一行的入参；`failedConvIds` 由调用方按 failedMessages 预先聚合一次 */
export function toLeftListRowProps(item: LeftListItem, ctx: LeftListContext, failedConvIds: ReadonlySet<number>): LeftListRowProps {
  const shared = {
    item,
    channelAvatarNode: ctx.channelAvatarNode,
    setActiveChannelId: ctx.setActiveChannelId,
    setActiveConvId: ctx.setActiveConvId,
    setChannels: ctx.setChannels,
    handleSelectConv: ctx.handleSelectConv,
    setLeftPaneContextMenu: ctx.setLeftPaneContextMenu,
  };
  if (item.kind === 'channel') {
    return { ...shared, isActive: ctx.activeChannelId === item.channel.id, isTargetOnline: false, groupMembers: undefined, hasFailedMsg: false, draftText: '' };
  }
  const conv = item.conv;
  const isActive = conv.id === ctx.activeConvId;
  return {
    ...shared,
    isActive,
    isTargetOnline: conv.type === 'direct' && !!conv.targetUser && ctx.onlineUserIds.has(conv.targetUser.id),
    groupMembers: conv.type === 'group' ? ctx.groupAvatarMap[conv.id] : undefined,
    hasFailedMsg: failedConvIds.has(conv.id),
    draftText: isActive ? '' : (ctx.draftsMap[conv.id] ?? ''),
  };
}

/** `item` 包装对象在列表重算时总是新的，按其内部会话 / 频道对象比对（未变更的会话对象引用不变） */
function sameListItem(a: LeftListItem, b: LeftListItem): boolean {
  if (a.kind !== b.kind) return false;
  return a.kind === 'channel' ? a.channel === (b as typeof a).channel : a.conv === (b as typeof a).conv;
}

/** LeftListRow 的 memo 比较器：除 item 外逐键 Object.is，item 按内部对象比对 */
export function areLeftListRowPropsEqual(prev: LeftListRowProps, next: LeftListRowProps): boolean {
  for (const key of Object.keys(next) as Array<keyof LeftListRowProps>) {
    if (key !== 'item' && !Object.is(prev[key], next[key])) return false;
  }
  return sameListItem(prev.item, next.item);
}
