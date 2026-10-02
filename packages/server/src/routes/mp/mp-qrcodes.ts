import { OpenAPIHono } from '@hono/zod-openapi';
import { mpQrcodeContract } from '@arcbase/shared/mp';
import { idempotencyGuard } from '../../middleware/idempotency';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listMpQrcodes,
  createMpQrcode,
  deleteMpQrcode,
  getMpQrcodeBeforeAudit,
} from '../../services/mp/mp-qrcode.service';
import { mountCrud } from '../_crud';

const mpQrcodesRouter = new OpenAPIHono({ defaultHook: validationHook });
const createRouteDef = defineContractRoute(mpQrcodeContract.create, {
  middleware: [idempotencyGuard({ ttlSeconds: 10 })],
  handler: async (c) => c.json(okBody(await createMpQrcode(c.req.valid('json')), '生成成功'), 200),
});

mountCrud(mpQrcodesRouter, mpQrcodeContract,
  { list: listMpQrcodes, get: getMpQrcodeBeforeAudit, remove: deleteMpQrcode },
  { exclude: ['create'] },
  [createRouteDef],
);

export default mpQrcodesRouter;
