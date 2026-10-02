import { OpenAPIHono } from '@hono/zod-openapi';
import { sslCertificateContract } from '@arcbase/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { fileBody, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  deleteSslCertificate,
  generateSelfSignedCert,
  getSslCertificate,
  getSslCertificateDownload,
  listSslCertificates,
  uploadCert,
} from '../../services/ops/ssl-certificates.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

const generateRoute = defineContractRoute(sslCertificateContract.generate, {
  handler: async (c) => c.json(okBody(await generateSelfSignedCert(c.req.valid('json')), '证书已生成'), 200),
});

const uploadRoute = defineContractRoute(sslCertificateContract.upload, {
  handler: async (c) => c.json(okBody(await uploadCert(c.req.valid('json')), '证书已上传'), 200),
});
const downloadRoute = defineContractRoute(sslCertificateContract.download, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    const { kind = 'cert' } = c.req.valid('query');
    const download = await getSslCertificateDownload(id, kind);
    return fileBody(download.content, download.filename, download.contentType);
  },
});

mountCrud(router, sslCertificateContract,
  { list: listSslCertificates, get: getSslCertificate, remove: deleteSslCertificate },
  {
    messages: { remove: '证书已删除' },
  },
  [generateRoute, uploadRoute, downloadRoute],
);

export default router;
