import { OpenAPIHono } from '@hono/zod-openapi';
import { aiConversationContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { csvStreamBody, fileBody, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listConversations,
  createConversation,
  getConversation,
  deleteConversation,
  listMessages,
  submitMessageFeedback,
  listFeedbackMessages,
  getFeedbackContext,
  exportFeedbackMessages,
  deleteMessage,
  deleteMessageCascade,
  renameConversation,
  togglePinConversation,
  toggleArchiveConversation,
  setConversationSystemPrompt,
  updateFeedbackStatus,
  exportConversation,
} from '../../services/ai/ai-conversations.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const getMessages = defineContractRoute(aiConversationContract.messages, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listMessages(id)), 200);
  },
});

const submitFeedback = defineContractRoute(aiConversationContract.submitFeedback, {
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    const { feedback, reason } = c.req.valid('json');
    await submitMessageFeedback(id, msgId, feedback, reason);
    return c.json(okBody(null, '反馈成功'), 200);
  },
});

const adminFeedbackList = defineContractRoute(aiConversationContract.feedbackList, {
  handler: async (c) => {
    return c.json(okBody(await listFeedbackMessages(c.req.valid('query'))), 200);
  },
});

const adminFeedbackContext = defineContractRoute(aiConversationContract.feedbackContext, {
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    return c.json(okBody(await getFeedbackContext(msgId)), 200);
  },
});

const adminFeedbackExport = defineContractRoute(aiConversationContract.feedbackExport, {
  handler: async (c) => {
    const { stream, filename } = await exportFeedbackMessages(c.req.valid('query'));
    return csvStreamBody(c, stream, filename);
  },
});

const updateFeedback = defineContractRoute(aiConversationContract.handleFeedback, {
  handler: async (c) => {
    const { msgId } = c.req.valid('param');
    const { status, remark } = c.req.valid('json');
    await updateFeedbackStatus(msgId, status, remark);
    return c.json(okBody(null, '处理成功'), 200);
  },
});

const exportConv = defineContractRoute(aiConversationContract.exportFile, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { format } = c.req.valid('query');
    const { content, filename, contentType } = await exportConversation(id, format);
    return fileBody(content, filename, contentType);
  },
});

const deleteMsg = defineContractRoute(aiConversationContract.removeMessage, {
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    await deleteMessage(id, msgId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const deleteMsgCascade = defineContractRoute(aiConversationContract.removeMessageCascade, {
  handler: async (c) => {
    const { id, msgId } = c.req.valid('param');
    await deleteMessageCascade(id, msgId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const rename = defineContractRoute(aiConversationContract.rename, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { title } = c.req.valid('json');
    await renameConversation(id, title);
    return c.json(okBody(null, '重命名成功'), 200);
  },
});

const togglePin = defineContractRoute(aiConversationContract.pin, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const isPinned = await togglePinConversation(id);
    return c.json(okBody({ isPinned }), 200);
  },
});

const toggleArchive = defineContractRoute(aiConversationContract.archive, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const isArchived = await toggleArchiveConversation(id);
    return c.json(okBody({ isArchived }), 200);
  },
});

const setSystemPrompt = defineContractRoute(aiConversationContract.setSystemPrompt, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { systemPrompt } = c.req.valid('json');
    const value = await setConversationSystemPrompt(id, systemPrompt);
    return c.json(okBody({ systemPromptOverride: value }), 200);
  },
});

mountCrud(router, aiConversationContract,
  { list: listConversations, get: getConversation, create: createConversation, remove: deleteConversation },
  { messages: { create: null } },
  [
    getMessages,
    rename,
    togglePin,
    toggleArchive,
    setSystemPrompt,
    exportConv,
    submitFeedback,
    deleteMsg,
    deleteMsgCascade,
    adminFeedbackList,
    adminFeedbackExport,
    adminFeedbackContext,
    updateFeedback,
  ],
);

export default router;
