import { OpenAPIHono } from '@hono/zod-openapi';
import { chatContract } from '@arcbase/shared/chat';
import { defineContractRoute } from '../../lib/contract-route';
import { namedRateLimit } from '../../middleware/rate-limit';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listConversations, getOrCreateDirectConversation, listMessages,
  searchConversationMessages, searchGlobalMessages, getMessageContext,
  sendMessage, recallMessage, editMessage, markConversationRead, listChatUsers,
  createGroupConversation, addGroupMember, listGroupMembers,
  removeGroupMember, updateGroupInfo, transferGroupOwnership,
  pinConversation, starConversation, muteConversation, removeConversation, disbandConversation,
  getLinkPreview, listPinnedMessages, listFavoriteMessages, listGlobalFavoriteMessages,
  toggleMessageFavorite, toggleMessagePin, listAnnouncementHistory, deleteAnnouncementHistory, forwardMessages, deleteMessagesForUser, toggleReaction, submitVote,
  getConversationReadStates, getPresenceForUsers, getRtcConfig, postCallRecord,
  setMemberRole, muteMember, setMuteAll, getChatOrgData, archiveConversation,
} from '../../services/chat/chat.service';
import {
  listMyQuickReplies, createQuickReply, updateQuickReply, deleteQuickReply,
} from '../../services/chat/chat-quick-replies.service';
import {
  createScheduledMessage, listMyScheduledMessages, cancelScheduledMessage,
} from '../../services/chat/chat-scheduled.service';
import {
  listMyCustomEmojis, addCustomEmoji, deleteCustomEmoji,
} from '../../services/chat/chat-stickers.service';
import {
  getOrCreateInvite, resetInvite, getInviteInfo, joinByInvite,
  listJoinRequests, handleJoinRequest, setJoinApproval,
} from '../../services/chat/chat-invites.service';

const chatRouter = new OpenAPIHono({ defaultHook: validationHook });

// ─── 用户搜索（开始聊天前选对象） ────────────────────────────────────────────

const usersRoute = defineContractRoute(chatContract.users, {
  handler: async (c) => {
    const { keyword } = c.req.valid('query');
    const list = await listChatUsers(keyword);
    return c.json(okBody(list), 200);
  },
});

// ─── 在线状态（presence）────────────────────────────────────────────────────

const presenceRoute = defineContractRoute(chatContract.presence, {
  handler: async (c) => {
    const { userIds } = c.req.valid('query');
    const ids = (userIds ?? '')
      .split(',')
      .map((s) => Number.parseInt(s.trim(), 10))
      .filter((n) => Number.isInteger(n) && n > 0);
    const list = getPresenceForUsers(ids);
    return c.json(okBody(list), 200);
  },
});

// ─── WebRTC 音视频通话 ───────────────────────────────────────────────────────

const rtcConfigRoute = defineContractRoute(chatContract.rtcConfig, {
  handler: async (c) => c.json(okBody(getRtcConfig()), 200),
});

const callRecordRoute = defineContractRoute(chatContract.postCallRecord, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await postCallRecord(id, c.req.valid('json'));
    return c.json(okBody(null), 200);
  },
});

// ─── 会话列表 ─────────────────────────────────────────────────────────────────

const conversationsRoute = defineContractRoute(chatContract.conversations, {
  handler: async (c) => {
    const list = await listConversations();
    return c.json(okBody(list), 200);
  },
});

const globalFavoriteMessagesRoute = defineContractRoute(chatContract.globalFavoriteMessages, {
  handler: async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const result = await listGlobalFavoriteMessages(page, pageSize);
    return c.json(okBody(result), 200);
  },
});

// ─── 创建/获取单聊会话 ────────────────────────────────────────────────────────

const createDirectRoute = defineContractRoute(chatContract.createDirect, {
  handler: async (c) => {
    const { targetUserId } = c.req.valid('json');
    const conv = await getOrCreateDirectConversation(targetUserId);
    return c.json(okBody(conv), 200);
  },
});

// ─── 会话消息列表 ─────────────────────────────────────────────────────────────

const messagesRoute = defineContractRoute(chatContract.messages, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { beforeId, limit } = c.req.valid('query');
    const result = await listMessages(id, beforeId ?? null, limit);
    return c.json(okBody(result), 200);
  },
});

const searchMessagesRoute = defineContractRoute(chatContract.searchMessages, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const result = await searchConversationMessages(id, c.req.valid('query'));
    return c.json(okBody(result), 200);
  },
});

const messageContextRoute = defineContractRoute(chatContract.messageContext, {
  handler: async (c) => {
    const { id, messageId } = c.req.valid('param');
    const { before, after } = c.req.valid('query');
    const result = await getMessageContext(id, messageId, before, after);
    return c.json(okBody(result), 200);
  },
});

// ─── 发送消息 ─────────────────────────────────────────────────────────────────

const linkPreviewRoute = defineContractRoute(chatContract.linkPreview, {
  handler: async (c) => {
    const { url } = c.req.valid('query');
    const data = await getLinkPreview(url);
    return c.json(okBody(data), 200);
  },
});

const sendMessageRoute = defineContractRoute(chatContract.sendMessage, {
  middleware: [namedRateLimit('chat_send')],
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const msg = await sendMessage(id, c.req.valid('json'));
    return c.json(okBody(msg), 200);
  },
});

const pinnedMessagesRoute = defineContractRoute(chatContract.pinnedMessages, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const list = await listPinnedMessages(id);
    return c.json(okBody(list), 200);
  },
});

const favoriteMessagesRoute = defineContractRoute(chatContract.favoriteMessages, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { page, pageSize } = c.req.valid('query');
    const result = await listFavoriteMessages(id, page, pageSize);
    return c.json(okBody(result), 200);
  },
});

const editMessageRoute = defineContractRoute(chatContract.editMessage, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { content } = c.req.valid('json');
    const msg = await editMessage(id, content);
    return c.json(okBody(msg), 200);
  },
});

// ─── 撤回消息 ─────────────────────────────────────────────────────────────────

const recallMessageRoute = defineContractRoute(chatContract.recallMessage, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await recallMessage(id);
    return c.json(okBody(null), 200);
  },
});

const favoriteMessageRoute = defineContractRoute(chatContract.favoriteMessage, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { favorite } = c.req.valid('json');
    const msg = await toggleMessageFavorite(id, favorite);
    return c.json(okBody(msg), 200);
  },
});

const pinMessageRoute = defineContractRoute(chatContract.pinMessage, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { pin } = c.req.valid('json');
    const msg = await toggleMessagePin(id, pin);
    return c.json(okBody(msg), 200);
  },
});

// ─── 标记已读 ─────────────────────────────────────────────────────────────────

const markReadRoute = defineContractRoute(chatContract.markRead, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markConversationRead(id);
    return c.json(okBody(null), 200);
  },
});

// ─── 已读回执：会话成员已读状态 ──────────────────────────────────────────────

const readStatesRoute = defineContractRoute(chatContract.readStates, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const list = await getConversationReadStates(id);
    return c.json(okBody(list), 200);
  },
});

// ─── 创建群聊 ─────────────────────────────────────────────────────────────────

const createGroupRoute = defineContractRoute(chatContract.createGroup, {
  handler: async (c) => {
    const { name, memberIds } = c.req.valid('json');
    const conv = await createGroupConversation(name, memberIds ?? []);
    return c.json(okBody(conv), 200);
  },
});

// ─── 归档 / 取消归档 ──────────────────────────────────────────────────────────

const archiveConversationRoute = defineContractRoute(chatContract.archiveConversation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { archive } = c.req.valid('json');
    await archiveConversation(id, archive);
    return c.json(okBody(null), 200);
  },
});

// ─── 常用语（个人快捷回复） ───────────────────────────────────────────────────

const quickRepliesRoute = defineContractRoute(chatContract.quickReplies, {
  handler: async (c) => {
    const list = await listMyQuickReplies();
    return c.json(okBody(list), 200);
  },
});

const createQuickReplyRoute = defineContractRoute(chatContract.createQuickReply, {
  handler: async (c) => {
    const body = c.req.valid('json');
    const item = await createQuickReply(body.content, body.sort);
    return c.json(okBody(item), 200);
  },
});

const updateQuickReplyRoute = defineContractRoute(chatContract.updateQuickReply, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const item = await updateQuickReply(id, c.req.valid('json'));
    return c.json(okBody(item), 200);
  },
});

const removeQuickReplyRoute = defineContractRoute(chatContract.removeQuickReply, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteQuickReply(id);
    return c.json(okBody(null), 200);
  },
});

// ─── 定时消息 ─────────────────────────────────────────────────────────────────

const createScheduledMessageRoute = defineContractRoute(chatContract.createScheduledMessage, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const body = c.req.valid('json');
    const item = await createScheduledMessage(id, { content: body.content, scheduledAt: body.scheduledAt });
    return c.json(okBody(item), 200);
  },
});

const scheduledMessagesRoute = defineContractRoute(chatContract.scheduledMessages, {
  handler: async (c) => {
    const { status } = c.req.valid('query');
    const list = await listMyScheduledMessages(status);
    return c.json(okBody(list), 200);
  },
});

const cancelScheduledMessageRoute = defineContractRoute(chatContract.cancelScheduledMessage, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await cancelScheduledMessage(id);
    return c.json(okBody(null), 200);
  },
});

// ─── 自定义表情 ───────────────────────────────────────────────────────────────

const customEmojisRoute = defineContractRoute(chatContract.customEmojis, {
  handler: async (c) => {
    const list = await listMyCustomEmojis();
    return c.json(okBody(list), 200);
  },
});

const addCustomEmojiRoute = defineContractRoute(chatContract.addCustomEmoji, {
  handler: async (c) => {
    const item = await addCustomEmoji(c.req.valid('json'));
    return c.json(okBody(item), 200);
  },
});

const removeCustomEmojiRoute = defineContractRoute(chatContract.removeCustomEmoji, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteCustomEmoji(id);
    return c.json(okBody(null), 200);
  },
});

// ─── 群邀请链接 / 入群审批 ────────────────────────────────────────────────────

const createInviteRoute = defineContractRoute(chatContract.createInvite, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const invite = await getOrCreateInvite(id);
    return c.json(okBody(invite), 200);
  },
});

const resetInviteRoute = defineContractRoute(chatContract.resetInvite, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const invite = await resetInvite(id);
    return c.json(okBody(invite), 200);
  },
});

const inviteInfoRoute = defineContractRoute(chatContract.inviteInfo, {
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const info = await getInviteInfo(token);
    return c.json(okBody(info), 200);
  },
});

const joinByInviteRoute = defineContractRoute(chatContract.joinByInvite, {
  handler: async (c) => {
    const { token } = c.req.valid('param');
    const { message } = c.req.valid('json');
    const result = await joinByInvite(token, message);
    return c.json(okBody(result), 200);
  },
});

const joinRequestsRoute = defineContractRoute(chatContract.joinRequests, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const list = await listJoinRequests(id);
    return c.json(okBody(list), 200);
  },
});

const handleJoinRequestRoute = defineContractRoute(chatContract.handleJoinRequest, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { approve } = c.req.valid('json');
    await handleJoinRequest(id, approve);
    return c.json(okBody(null), 200);
  },
});

const setJoinApprovalRoute = defineContractRoute(chatContract.setJoinApproval, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { enabled } = c.req.valid('json');
    await setJoinApproval(id, enabled);
    return c.json(okBody(null), 200);
  },
});

// ─── 组织架构选人数据 ─────────────────────────────────────────────────────────

const orgUsersRoute = defineContractRoute(chatContract.orgUsers, {
  handler: async (c) => {
    const data = await getChatOrgData();
    return c.json(okBody(data), 200);
  },
});

// ─── 群成员 ───────────────────────────────────────────────────────────────────

const groupMembersRoute = defineContractRoute(chatContract.groupMembers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const members = await listGroupMembers(id);
    return c.json(okBody(members), 200);
  },
});

const addGroupMemberRoute = defineContractRoute(chatContract.addGroupMember, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userId } = c.req.valid('json');
    await addGroupMember(id, userId);
    return c.json(okBody(null), 200);
  },
});

// ─── 置顶 / 星标 / 免打扰 ─────────────────────────────────────────────────────

const pinConversationRoute = defineContractRoute(chatContract.pinConversation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { pin } = c.req.valid('json');
    await pinConversation(id, pin);
    return c.json(okBody(null), 200);
  },
});

const starConversationRoute = defineContractRoute(chatContract.starConversation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { star } = c.req.valid('json');
    await starConversation(id, star);
    return c.json(okBody(null), 200);
  },
});

const muteConversationRoute = defineContractRoute(chatContract.muteConversation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { mute } = c.req.valid('json');
    await muteConversation(id, mute);
    return c.json(okBody(null), 200);
  },
});

// ─── 删除/退出会话 ───────────────────────────────────────────────────────────

const disbandConversationRoute = defineContractRoute(chatContract.disbandConversation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await disbandConversation(id);
    return c.json(okBody(null, '已解散'), 200);
  },
});

const removeConversationRoute = defineContractRoute(chatContract.removeConversation, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await removeConversation(id);
    return c.json(okBody(null), 200);
  },
});

// ─── 移除群成员 ───────────────────────────────────────────────────────────────

const removeGroupMemberRoute = defineContractRoute(chatContract.removeGroupMember, {
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    await removeGroupMember(id, userId);
    return c.json(okBody(null), 200);
  },
});

// ─── 更新群聊信息（群名/公告）────────────────────────────────────────────────

const updateGroupInfoRoute = defineContractRoute(chatContract.updateGroupInfo, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await updateGroupInfo(id, c.req.valid('json'));
    return c.json(okBody(null), 200);
  },
});

// ─── 转让群主 ─────────────────────────────────────────────────────────────────

const transferGroupRoute = defineContractRoute(chatContract.transferGroup, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { newOwnerId } = c.req.valid('json');
    await transferGroupOwnership(id, newOwnerId);
    return c.json(okBody(null), 200);
  },
});

// ─── 群管理员 / 禁言 ──────────────────────────────────────────────────────────

const setMemberRoleRoute = defineContractRoute(chatContract.setMemberRole, {
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const { role } = c.req.valid('json');
    await setMemberRole(id, userId, role);
    return c.json(okBody(null), 200);
  },
});

const muteMemberRoute = defineContractRoute(chatContract.muteMember, {
  handler: async (c) => {
    const { id, userId } = c.req.valid('param');
    const { mute, durationMinutes } = c.req.valid('json');
    await muteMember(id, userId, mute, durationMinutes);
    return c.json(okBody(null), 200);
  },
});

const setMuteAllRoute = defineContractRoute(chatContract.setMuteAll, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { muteAll } = c.req.valid('json');
    await setMuteAll(id, muteAll);
    return c.json(okBody(null), 200);
  },
});

const announcementHistoryRoute = defineContractRoute(chatContract.announcementHistory, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const list = await listAnnouncementHistory(id);
    return c.json(okBody(list), 200);
  },
});

const removeAnnouncementHistoryRoute = defineContractRoute(chatContract.removeAnnouncementHistory, {
  handler: async (c) => {
    const { id, messageId } = c.req.valid('param');
    await deleteAnnouncementHistory(id, messageId);
    return c.json(okBody(null), 200);
  },
});

// ─── 转发消息 ─────────────────────────────────────────────────────────────────

const forwardMessagesRoute = defineContractRoute(chatContract.forwardMessages, {
  middleware: [namedRateLimit('chat_send')],
  handler: async (c) => {
    await forwardMessages(c.req.valid('json'));
    return c.json(okBody(null), 200);
  },
});

// ─── 删除消息（仅对自己） ─────────────────────────────────────────────────────

const batchDeleteMessagesRoute = defineContractRoute(chatContract.batchDeleteMessages, {
  handler: async (c) => {
    const { messageIds } = c.req.valid('json');
    await deleteMessagesForUser(messageIds);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

// ─── 全局消息搜索 ─────────────────────────────────────────────────────────────

const globalSearchRoute = defineContractRoute(chatContract.globalSearch, {
  handler: async (c) => {
    const result = await searchGlobalMessages(c.req.valid('query'));
    return c.json(okBody(result), 200);
  },
});

// ─── 消息表情回应 ─────────────────────────────────────────────────────────────

const toggleReactionRoute = defineContractRoute(chatContract.toggleReaction, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { emoji } = c.req.valid('json');
    const reactions = await toggleReaction(id, emoji);
    return c.json(okBody(reactions), 200);
  },
});

// ─── 投票 ──────────────────────────────────────────────────────────────────────

const voteRoute = defineContractRoute(chatContract.vote, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { optionIds } = c.req.valid('json');
    const updated = await submitVote(id, optionIds);
    return c.json(okBody(updated), 200);
  },
});

// 注册顺序即匹配顺序；同一路由器的多次 openapiRoutes() 按主题分批，避免单个元组过深导致类型实例化超限
chatRouter.openapiRoutes([
  usersRoute, presenceRoute, rtcConfigRoute, callRecordRoute,
  conversationsRoute, globalFavoriteMessagesRoute, createDirectRoute,
  messagesRoute, searchMessagesRoute, messageContextRoute,
  linkPreviewRoute, sendMessageRoute, pinnedMessagesRoute, favoriteMessagesRoute,
  editMessageRoute, recallMessageRoute, favoriteMessageRoute, pinMessageRoute,
  markReadRoute, readStatesRoute, createGroupRoute, archiveConversationRoute,
] as const);
chatRouter.openapiRoutes([
  quickRepliesRoute, createQuickReplyRoute, updateQuickReplyRoute, removeQuickReplyRoute,
  createScheduledMessageRoute, scheduledMessagesRoute, cancelScheduledMessageRoute,
  customEmojisRoute, addCustomEmojiRoute, removeCustomEmojiRoute,
  createInviteRoute, resetInviteRoute, inviteInfoRoute, joinByInviteRoute,
  joinRequestsRoute, handleJoinRequestRoute, setJoinApprovalRoute,
  orgUsersRoute, groupMembersRoute, addGroupMemberRoute,
] as const);
chatRouter.openapiRoutes([
  pinConversationRoute, starConversationRoute, muteConversationRoute,
  disbandConversationRoute, removeConversationRoute, removeGroupMemberRoute,
  updateGroupInfoRoute, transferGroupRoute, setMemberRoleRoute, muteMemberRoute, setMuteAllRoute,
  announcementHistoryRoute, removeAnnouncementHistoryRoute,
  forwardMessagesRoute, batchDeleteMessagesRoute, globalSearchRoute, toggleReactionRoute, voteRoute,
] as const);

export default chatRouter;
