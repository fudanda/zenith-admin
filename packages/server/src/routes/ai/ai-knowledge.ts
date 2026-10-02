import { OpenAPIHono } from '@hono/zod-openapi';
import { aiKnowledgeBaseContract } from '@arcbase/shared/ai';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listKnowledgeBases,
  createKnowledgeBase,
  updateKnowledgeBase,
  deleteKnowledgeBase,
  listKbDocuments,
  listKbChunks,
  addKbDocument,
  importKbUrl,
  deleteKbDocument,
} from '../../services/ai/ai-knowledge.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

/** 聊天页挂载选择器用：无需 kb:list 权限，仅登录即可读取自己的知识库 */
const available = defineContractRoute(aiKnowledgeBaseContract.all, {
  handler: async (c) => c.json(okBody(await listKnowledgeBases()), 200),
});
const update = defineContractRoute(aiKnowledgeBaseContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await updateKnowledgeBase(id, c.req.valid('json')), '更新成功'), 200);
  },
});

const remove = defineContractRoute(aiKnowledgeBaseContract.remove, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteKnowledgeBase(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const listDocs = defineContractRoute(aiKnowledgeBaseContract.documents, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listKbDocuments(id)), 200);
  },
});

const addDoc = defineContractRoute(aiKnowledgeBaseContract.addDocument, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await addKbDocument(id, c.req.valid('json')), '文档已入库'), 200);
  },
});

const importUrl = defineContractRoute(aiKnowledgeBaseContract.importUrl, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await importKbUrl(id, c.req.valid('json')), '网页已入库'), 200);
  },
});

const listChunks = defineContractRoute(aiKnowledgeBaseContract.chunks, {
  handler: async (c) => {
    const { id, docId } = c.req.valid('param');
    return c.json(okBody(await listKbChunks(id, docId)), 200);
  },
});

const removeDoc = defineContractRoute(aiKnowledgeBaseContract.removeDocument, {
  handler: async (c) => {
    const { id, docId } = c.req.valid('param');
    await deleteKbDocument(id, docId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(router, aiKnowledgeBaseContract,
  { create: createKnowledgeBase, list: listKnowledgeBases },
  { exclude: ['update', 'remove'] },
  [available, update, remove, listDocs, addDoc, importUrl, listChunks, removeDoc],
);

export default router;
