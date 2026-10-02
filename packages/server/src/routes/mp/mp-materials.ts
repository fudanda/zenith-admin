import { OpenAPIHono } from '@hono/zod-openapi';
import { HTTPException } from 'hono/http-exception';
import { MP_MATERIAL_TYPES, mpMaterialContract, type MpMaterialType } from '@arcbase/shared/mp';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  mpMaterialService,
  syncMpMaterials,
  uploadMpMaterial,
} from '../../services/mp/mp-material.service';
import { mountCrud } from '../_crud';

const mpMaterialsRouter = new OpenAPIHono({ defaultHook: validationHook });
const syncRoute = defineContractRoute(mpMaterialContract.sync, {
  handler: async (c) => c.json(okBody(await syncMpMaterials(c.req.valid('json').accountId), '同步完成'), 200),
});
const uploadRoute = defineContractRoute(mpMaterialContract.upload, {
  handler: async (c) => {
    const body = await c.req.parseBody();
    const file = body.file;
    if (!(file instanceof File)) throw new HTTPException(400, { message: '请选择要上传的文件' });
    const accountId = Number(body.accountId);
    if (!Number.isInteger(accountId) || accountId <= 0) throw new HTTPException(400, { message: '公众号参数无效' });
    const type = String(body.type ?? '');
    if (!(MP_MATERIAL_TYPES as readonly string[]).includes(type)) throw new HTTPException(400, { message: '素材类型无效' });
    const name = body.name ? String(body.name) : '';
    const videoMeta = type === 'video'
      ? { title: body.title ? String(body.title) : (name || file.name), introduction: body.introduction ? String(body.introduction) : '' }
      : undefined;
    const result = await uploadMpMaterial(accountId, type as MpMaterialType, file, file.name, name, videoMeta);
    return c.json(okBody(result, '上传成功'), 200);
  },
});

mountCrud(mpMaterialsRouter, mpMaterialContract,
  mpMaterialService,
  {},
  [syncRoute, uploadRoute],
);

export default mpMaterialsRouter;
