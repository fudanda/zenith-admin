/**
 * 支付应用（App 维度）管理路由。
 * 外部身份由开放平台客户端管理，本模块只维护支付渠道路由。
 */
import { OpenAPIHono } from '@hono/zod-openapi';
import { paymentAppContract } from '@arcbase/shared/payment';
import { validationHook } from '../../lib/openapi-schemas';
import { listApps, getApp, createApp, updateApp, deleteApp } from '../../services/payment/payment-apps.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(router, paymentAppContract,
  { list: listApps, get: getApp, create: createApp, update: updateApp, remove: deleteApp },
);

export default router;
