import { OpenAPIHono } from '@hono/zod-openapi';
import { stream } from 'hono/streaming';
import { HTTPException } from 'hono/http-exception';
import { networkDiagContract } from '@arcbase/shared/ops';
import { defineContractRoute } from '../../lib/contract-route';
import { errBody, okBody, validationHook } from '../../lib/openapi-schemas';
import { spawnNetDiag, runNslookup, checkPort, validateHost, resolveDns, reverseDns, httpProbe, getInterfaces } from '../../services/ops/network-diag.service';

const router = new OpenAPIHono({ defaultHook: validationHook });

// ping / traceroute 逐行流式输出
const streamRoute = defineContractRoute(networkDiagContract.stream, {
  handler: async (c) => {
    const { type, host } = c.req.valid('query');
    try {
      validateHost(host);
    } catch {
      return c.json(errBody('非法主机名或 IP'), 400);
    }

    const { kill, lines } = spawnNetDiag(type, host);

    return stream(c, async (s) => {
      s.onAbort(() => kill());
      try {
        for await (const chunk of lines) {
          await s.write((chunk as Buffer).toString());
        }
      } catch { /* client disconnected */ } finally {
        kill();
      }
    });
  },
});

const nslookupRoute = defineContractRoute(networkDiagContract.nslookup, {
  handler: async (c) => {
    const { host } = c.req.valid('query');
    const output = await runNslookup(host);
    return c.json(okBody({ output }), 200);
  },
});

const portCheckRoute = defineContractRoute(networkDiagContract.portCheck, {
  handler: async (c) => {
    const { host, port } = c.req.valid('json');
    try { validateHost(host); } catch { throw new HTTPException(400, { message: '非法主机名或 IP' }); }
    const result = await checkPort(host, port);
    return c.json(okBody(result), 200);
  },
});

const dnsRoute = defineContractRoute(networkDiagContract.dns, {
  handler: async (c) => {
    const { host, type } = c.req.valid('query');
    try { validateHost(host); } catch { throw new HTTPException(400, { message: '非法主机名' }); }
    const result = await resolveDns(host, type);
    return c.json(okBody(result), 200);
  },
});

const reverseRoute = defineContractRoute(networkDiagContract.reverse, {
  handler: async (c) => {
    const { ip } = c.req.valid('query');
    try { const r = await reverseDns(ip); return c.json(okBody(r), 200); } catch (e) { throw new HTTPException(400, { message: (e as Error).message }); }
  },
});

const httpProbeRoute = defineContractRoute(networkDiagContract.httpProbe, {
  handler: async (c) => {
    const { url } = c.req.valid('json');
    const result = await httpProbe(url);
    return c.json(okBody(result), 200);
  },
});

const interfacesRoute = defineContractRoute(networkDiagContract.interfaces, {
  handler: (c) => c.json(okBody(getInterfaces()), 200),
});

router.openapiRoutes([streamRoute, nslookupRoute, portCheckRoute, dnsRoute, reverseRoute, httpProbeRoute, interfacesRoute] as const);

export default router;
