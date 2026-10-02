import { OpenAPIHono } from '@hono/zod-openapi';
import { workflowDataSourceContract } from '@arcbase/shared/workflow';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  workflowDataSourceService,
  fetchDataSourceOptions,
  fetchDataSourceRecord,
} from '../../services/workflow/workflow-data-source.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// 代理拉取选项（运行时填表用，仅需登录态）
const optionsRoute = defineContractRoute(workflowDataSourceContract.options, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { keyword } = c.req.valid('query');
    return c.json(okBody(await fetchDataSourceOptions(id, keyword)), 200);
  },
});

// 按选项值取完整记录（联动赋值回填用，仅需登录态）
const recordRoute = defineContractRoute(workflowDataSourceContract.record, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { value } = c.req.valid('query');
    return c.json(okBody(await fetchDataSourceRecord(id, value)), 200);
  },
});

mountCrud(router, workflowDataSourceContract,
  workflowDataSourceService,
  {},
  [optionsRoute, recordRoute],
);

export default router;
