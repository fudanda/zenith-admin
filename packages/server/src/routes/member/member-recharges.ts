import { OpenAPIHono } from '@hono/zod-openapi';
import { memberRechargeContract } from '@arcbase/shared/member';
import { validationHook } from '../../lib/openapi-schemas';
import { listMemberRecharges } from '../../services/member/member-recharge.service';
import { mountCrud } from '../_crud';

const memberRechargesRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(memberRechargesRouter, memberRechargeContract,
  { list: listMemberRecharges },
);

export default memberRechargesRouter;
