import { OpenAPIHono } from '@hono/zod-openapi';
import { mpKfAccountContract } from '@arcbase/shared/mp';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  mpKfAccountService,
  syncMpKfAccounts,
} from '../../services/mp/mp-kf.service';
import { mountCrud } from '../_crud';

const mpKfRouter = new OpenAPIHono({ defaultHook: validationHook });
const syncRoute = defineContractRoute(mpKfAccountContract.sync, {
  handler: async (c) => c.json(okBody(await syncMpKfAccounts(c.req.valid('json').accountId), '同步完成'), 200),
});

mountCrud(mpKfRouter, mpKfAccountContract,
  mpKfAccountService,
  {},
  [syncRoute],
);

export default mpKfRouter;
