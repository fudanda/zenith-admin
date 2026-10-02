import { OpenAPIHono } from '@hono/zod-openapi';
import { ipAccessLogContract } from '@arcbase/shared/platform';
import { validationHook } from '../../lib/openapi-schemas';
import { listIpAccessLogs } from '../../services/platform/ip-access-logs.service';
import { mountCrud } from '../_crud';

const ipAccessLogsRoute = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(ipAccessLogsRoute, ipAccessLogContract,
  { list: listIpAccessLogs },
);

export default ipAccessLogsRoute;
