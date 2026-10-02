/**
 * 规则执行记录路由（全资产通用）。
 * 覆盖决策表 / 决策流 / 评分卡 / 名单命中的统一留痕，支持按资产类型与调用方筛选。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { ruleExecutionContract } from '@arcbase/shared/rules';
import { validationHook } from '../../lib/openapi-schemas';
import { listRuleExecutions } from '../../services/platform/rules-executions.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, ruleExecutionContract,
  { list: listRuleExecutions },
);

export default router;
