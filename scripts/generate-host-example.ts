import { readFileSync, writeFileSync } from 'node:fs';
import * as z from 'zod';
import { hostPositionContract } from '../examples/host-application/contracts';

const operations = Object.entries(hostPositionContract).filter(([, op]) => op && typeof op === 'object' && 'method' in op).map(([id, op]) => {
  const schema = (value: z.ZodType | undefined) => {
    if (!value) return undefined;
    const result = z.toJSONSchema(value, { io: 'output', unrepresentable: 'any' });
    if (value instanceof z.ZodObject && result.required) result.required = result.required.filter(key => !value.shape[key].safeParse(undefined).success);
    return result;
  };
  const query = schema(op.query);
  return { id: `hostPositions${id[0].toUpperCase()}${id.slice(1)}`, method: op.method.toUpperCase(), path: op.fullPath,
    permission: op.access && op.access !== 'authenticated' && 'permission' in op.access ? op.access.permission : 'authenticated',
    body: schema(op.body), query, params: schema(op.params),
    queryTypes: Object.fromEntries(Object.entries(query?.properties ?? {}).map(([key, value]) => [key, typeof value === 'object' ? value.type : 'string'])),
    auditModule: op.audit?.module ?? '宿主岗位模块', auditDescription: op.audit?.description ?? '', auditRecordBody: op.audit?.recordBody ?? false,
    successStatus: op.method === 'post' ? 201 : 200 };
});
const path = 'backend/examples/hostmodule/contract.gen.json';
const output = JSON.stringify(operations, null, 2) + '\n';
if (process.argv.includes('--check')) { if (readFileSync(path, 'utf8') !== output) throw new Error('Host example contract drift'); }
else writeFileSync(path, output);
