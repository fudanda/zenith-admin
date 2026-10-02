import { authContract } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody } from '../../lib/openapi-schemas';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { getMySignature, getMySignatureAuditMetadata, saveMySignature, deleteMySignature } from '../../services/identity/user-signatures.service';

const mySignatureRoute = defineContractRoute(authContract.mySignature, {
  handler: async (c) => {
    c.header('Cache-Control', 'no-store');
    return c.json(okBody(await getMySignature()), 200);
  },
});
const saveMySignatureRoute = defineContractRoute(authContract.saveMySignature, {
  handler: async (c) => {
    c.header('Cache-Control', 'no-store');
    setAuditBeforeData(c, await getMySignatureAuditMetadata());
    const saved = await saveMySignature(c.req.valid('json'));
    // recordResponseBody=false不关闭guard的afterData回退，必须显式给出无图像快照。
    setAuditAfterData(c, { id: saved.id, version: saved.version, updatedAt: saved.updatedAt });
    return c.json(okBody(saved), 200);
  },
});
const deleteMySignatureRoute = defineContractRoute(authContract.deleteMySignature, {
  handler: async (c) => {
    setAuditBeforeData(c, await getMySignatureAuditMetadata());
    await deleteMySignature();
    setAuditAfterData(c, null);
    return c.json(okBody(null, '已删除签名'), 200);
  },
});

export const signatureRoutes = [mySignatureRoute, saveMySignatureRoute, deleteMySignatureRoute] as const;
