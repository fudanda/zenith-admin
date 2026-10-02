import { OpenAPIHono } from '@hono/zod-openapi';
import { memberCheckinContract } from '@arcbase/shared/member';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import { getCheckinCalendar, listMemberCheckins } from '../../services/member/member-checkin.service';
import { mountCrud } from '../_crud';

const memberCheckinsRouter = new OpenAPIHono({ defaultHook: validationHook });

const calendarRoute = defineContractRoute(memberCheckinContract.calendar, {
  handler: async (c) => c.json(okBody(await getCheckinCalendar(c.req.valid('query').month)), 200),
});

mountCrud(memberCheckinsRouter, memberCheckinContract,
  { list: listMemberCheckins },
  {},
  [calendarRoute],
);

export default memberCheckinsRouter;
