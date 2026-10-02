import { OpenAPIHono } from '@hono/zod-openapi';
import { positionContract } from '@arcbase/shared/identity';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody, csvStreamBody } from '../../lib/openapi-schemas';
import { streamToCsv } from '../../lib/excel-export';
import { defineScopeMembersRoute } from './_scope-members';
import {
  listAllPositions,
  listPositions,
  createPosition,
  updatePosition,
  deletePosition,
  batchDeletePositions,
  getPositionsBeforeAudit,
  getPositionBeforeAudit,
  getPosition,
  listPositionMembers,
  setPositionMembers,
  getPositionMembersBeforeAudit,
} from '../../services/identity/positions.service';
import { mountCrud } from '../_crud';

const positionsRouter = new OpenAPIHono({ defaultHook: validationHook });

const allRoute = defineContractRoute(positionContract.all, {
  handler: async (c) => c.json(okBody(await listAllPositions()), 200),
});
const exportCsvRoute = defineContractRoute(positionContract.exportCsv, {
  handler: async (c) => {
    const filters = c.req.valid('query');
    async function* rows() {
      for (let page = 1; ; page++) {
        const result = await listPositions({ ...filters, page, pageSize: 200 });
        for (const row of result.list) yield row;
        if (result.list.length < 200) break;
      }
    }
    const safe = (value: unknown) => {
      const text = String(value ?? '');
      return /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
    };
    const stream = streamToCsv([
      { key: 'id', header: 'ID' },
      { key: 'name', header: '岗位名称', transform: safe },
      { key: 'code', header: '岗位编码', transform: safe },
      { key: 'sort', header: '排序' },
      { key: 'status', header: '状态' },
      { key: 'remark', header: '备注', transform: safe },
      { key: 'createdAt', header: '创建时间' },
    ], rows());
    return csvStreamBody(c, stream, 'positions.csv');
  },
});
const updatePositionRoute = defineContractRoute(positionContract.update, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const before = await getPositionBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    const updated = await updatePosition(id, c.req.valid('json'));
    setAuditAfterData(c, updated);
    return c.json(okBody(updated, '更新成功'), 200);
  },
});

const batchDeleteRoute = defineContractRoute(positionContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getPositionsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const { count } = await batchDeletePositions(ids);
    return c.json(okBody(null, `已删除 ${count} 个岗位`), 200);
  },
});
const listMembersRoute = defineContractRoute(positionContract.members, {
  handler: async (c) => c.json(okBody(await listPositionMembers(c.req.valid('param').id)), 200),
});

const memberPreviewRoute = defineScopeMembersRoute({
  op: positionContract.memberPreview,
  scopeType: 'position',
});

const setMembersRoute = defineContractRoute(positionContract.setMembers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { userIds } = c.req.valid('json');
    const before = await getPositionMembersBeforeAudit(id);
    if (before) setAuditBeforeData(c, before);
    await setPositionMembers(id, userIds);
    const after = await getPositionMembersBeforeAudit(id);
    if (after) setAuditAfterData(c, after);
    return c.json(okBody(null, '保存成功'), 200);
  },
});

mountCrud(positionsRouter, positionContract,
  { list: listPositions, get: getPosition, create: createPosition, remove: deletePosition },
  { exclude: ['update', 'removeBatch'] },
  [
    allRoute,
    exportCsvRoute,
    updatePositionRoute,
    batchDeleteRoute,
    listMembersRoute,
    memberPreviewRoute,
    setMembersRoute,
  ],
);

export default positionsRouter;
