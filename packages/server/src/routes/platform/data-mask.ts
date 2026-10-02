import { OpenAPIHono } from '@hono/zod-openapi';
import { dataMaskContract } from '@arcbase/shared/platform';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  getEffectiveMaskForViewer,
  listDataMaskFields,
  resetDataMaskPolicy,
  revealSensitiveValue,
  saveDataMaskPolicy,
} from '../../services/platform/data-mask.service';

const dataMaskRouter = new OpenAPIHono({ defaultHook: validationHook });

const fieldsRoute = defineContractRoute(dataMaskContract.fields, {
  handler: async (c) => c.json(okBody(await listDataMaskFields(c.req.valid('query'))), 200),
});

// 任何登录用户都需要知道自己看到的哪些字段是掩码（表单锁定 / 查看明文入口），不额外要求权限
const effectiveRoute = defineContractRoute(dataMaskContract.effective, {
  handler: async (c) => c.json(okBody(await getEffectiveMaskForViewer()), 200),
});

const savePolicyRoute = defineContractRoute(dataMaskContract.savePolicy, {
  handler: async (c) => {
    const { entity, field } = c.req.valid('param');
    const before = (await listDataMaskFields({ entity })).find((item) => item.field === field);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await saveDataMaskPolicy(entity, field, c.req.valid('json')), '策略已保存'), 200);
  },
});

const resetPolicyRoute = defineContractRoute(dataMaskContract.resetPolicy, {
  handler: async (c) => {
    const { entity, field } = c.req.valid('param');
    const before = (await listDataMaskFields({ entity })).find((item) => item.field === field);
    if (before) setAuditBeforeData(c, before);
    return c.json(okBody(await resetDataMaskPolicy(entity, field), '已恢复契约默认策略'), 200);
  },
});

// 明文查看逐次留痕：审计记录谁在何时看了哪条记录的哪个字段；响应体（明文）本身不进审计日志，
// 变更后快照也手动指定为字段坐标，避免 guard 默认把响应 data 当 after 快照落库
const revealRoute = defineContractRoute(dataMaskContract.reveal, {
  handler: async (c) => {
    const { entity, id, field } = c.req.valid('json');
    setAuditAfterData(c, { entity, id, field, revealed: true });
    return c.json(okBody(await revealSensitiveValue(entity, id, field)), 200);
  },
});

dataMaskRouter.openapiRoutes([fieldsRoute, effectiveRoute, revealRoute, savePolicyRoute, resetPolicyRoute] as const);

export default dataMaskRouter;