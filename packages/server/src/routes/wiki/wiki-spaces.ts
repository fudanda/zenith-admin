import { OpenAPIHono } from '@hono/zod-openapi';
import { wikiSpaceContract } from '@arcbase/shared/wiki';
import { setAuditBeforeData, setAuditAfterData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { validationHook, okBody } from '../../lib/openapi-schemas';
import {
  createWikiSpace,
  deleteWikiSpace,
  getWikiSpace,
  getWikiSpaceMembersBeforeAudit,
  listMyWikiSpaces,
  listWikiSpaceMembers,
  listWikiSpaces,
  saveWikiSpaceMembers,
  updateWikiSpace,
} from '../../services/wiki/spaces.service';
import { mountCrud } from '../_crud';

const spacesRouter = new OpenAPIHono({ defaultHook: validationHook });

const myRoute = defineContractRoute(wikiSpaceContract.my, {
  handler: async (c) => c.json(okBody(await listMyWikiSpaces()), 200),
});
const listMembersRoute = defineContractRoute(wikiSpaceContract.listMembers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await listWikiSpaceMembers(id)), 200);
  },
});

const saveMembersRoute = defineContractRoute(wikiSpaceContract.saveMembers, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    setAuditBeforeData(c, await getWikiSpaceMembersBeforeAudit(id));
    await saveWikiSpaceMembers(id, c.req.valid('json'));
    setAuditAfterData(c, await getWikiSpaceMembersBeforeAudit(id));
    return c.json(okBody(null, '保存成功'), 200);
  },
});

mountCrud(spacesRouter, wikiSpaceContract,
  {
    list: listWikiSpaces,
    get: getWikiSpace,
    create: createWikiSpace,
    update: updateWikiSpace,
    remove: deleteWikiSpace,
  },
  {},
  [myRoute, listMembersRoute, saveMembersRoute],
);

export default spacesRouter;
