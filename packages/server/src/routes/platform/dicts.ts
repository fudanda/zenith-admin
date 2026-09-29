import { OpenAPIHono } from '@hono/zod-openapi';
import { dictContract } from '@zenith/shared/platform';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import {
  listDictItems,
  listDictItemsByCode,
  createDictItem,
  updateDictItem,
  deleteDictItem,
  getDictItemBeforeAudit,
  dictService,
  getDictItem,
} from '../../services/platform/dicts.service';
import { mountCrud } from '../_crud';

const dictsRouter = new OpenAPIHono({ defaultHook: validationHook });

const exportCsvRoute = defineContractRoute(dictContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await dictService.list({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield row;
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    return csvStreamBody(c, streamToCsv([
      { key: 'id', header: 'ID' }, { key: 'name', header: '字典名称', transform: safe },
      { key: 'code', header: '字典编码', transform: safe }, { key: 'description', header: '描述', transform: safe },
      { key: 'status', header: '状态' }, { key: 'createdAt', header: '创建时间' },
    ], rows()), 'dicts.csv');
  },
});

const listItemsRoute = defineContractRoute(dictContract.items, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listDictItems(id)), 200);
  },
});

const getItemsByCodeRoute = defineContractRoute(dictContract.itemsByCode, {
  handler: async (c) => {
    const { code } = c.req.valid('param');
    return c.json(okBody(await listDictItemsByCode(code)), 200);
  },
});

const createItemRoute = defineContractRoute(dictContract.createItem, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await createDictItem(id, c.req.valid('json')), '创建成功'), 200);
  },
});

const getItemRoute = defineContractRoute(dictContract.itemDetail, {
  handler: async (c) => {
    const { id, itemId } = c.req.valid('param');
    return c.json(okBody(await getDictItem(id, itemId)), 200);
  },
});

const updateItemRoute = defineContractRoute(dictContract.updateItem, {
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const before = await getDictItemBeforeAudit(itemId);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await updateDictItem(itemId, c.req.valid('json')), '更新成功'), 200);
  },
});

const deleteItemRoute = defineContractRoute(dictContract.removeItem, {
  handler: async (c) => {
    const { itemId } = c.req.valid('param');
    const before = await getDictItemBeforeAudit(itemId);
    if (before) setAuditBeforeData(c, before);
    await deleteDictItem(itemId);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

mountCrud(dictsRouter, dictContract,
  dictService,
  {},
  [exportCsvRoute, listItemsRoute, getItemsByCodeRoute, getItemRoute, createItemRoute, updateItemRoute, deleteItemRoute],
);

export default dictsRouter;
