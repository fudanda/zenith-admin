/**
 * IoT 动态注册：白名单 + 产品注册密钥
 *
 * 设备侧注册端点在 ingest 路由（`iotIngestContract.register`，产品注册密钥签名）。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { iotWhitelistContract } from '@arcbase/shared/iot';
import { defineContractRoute } from '../../lib/contract-route';
import { ErrorResponse, jsonContent, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createIotWhitelistEntries,
  deleteIotWhitelistEntry,
  disableIotRegistration,
  getIotWhitelistStats,
  listIotWhitelist,
  resetIotRegistrationSecret,
} from '../../services/iot/iot-register.service';
import { mountCrud } from '../_crud';

export const iotWhitelistRouter = new OpenAPIHono({ defaultHook: validationHook });

const productNotFound = { 404: { content: jsonContent(ErrorResponse), description: '产品不存在' } } as const;

const statsRoute = defineContractRoute(iotWhitelistContract.stats, {
  handler: async (c) => {
    const { productId } = c.req.valid('query');
    return c.json(okBody(await getIotWhitelistStats(productId)), 200);
  },
});
const importRoute = defineContractRoute(iotWhitelistContract.import, {
  handler: async (c) => c.json(okBody(await createIotWhitelistEntries(c.req.valid('json')), '导入完成'), 200),
});

const deleteRoute_ = defineContractRoute(iotWhitelistContract.remove, {
  responses: { 404: { content: jsonContent(ErrorResponse), description: '不存在' } },
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await deleteIotWhitelistEntry(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const resetSecretRoute = defineContractRoute(iotWhitelistContract.resetRegistrationSecret, {
  responses: productNotFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await resetIotRegistrationSecret(id), '注册密钥已重置，请妥善保存'), 200);
  },
});

const disableSecretRoute = defineContractRoute(iotWhitelistContract.disableRegistration, {
  responses: productNotFound,
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await disableIotRegistration(id);
    return c.json(okBody(null, '动态注册已关闭'), 200);
  },
});

mountCrud(iotWhitelistRouter, iotWhitelistContract,
  { list: listIotWhitelist },
  { exclude: ['remove'] },
  [statsRoute, importRoute, deleteRoute_, resetSecretRoute, disableSecretRoute],
);
