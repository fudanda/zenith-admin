import { OpenAPIHono } from '@hono/zod-openapi';
import { terminalRecordingContract } from '@arcbase/shared/ops';
import { setAuditAfterData, setAuditBeforeData } from '../../middleware/guard';
import { currentUser } from '../../lib/context';
import { defineContractRoute } from '../../lib/contract-route';
import { fileBody, okBody, validationHook } from '../../lib/openapi-schemas';
import {
  createRecording,
  listRecordings,
  getRecording,
  getRecordingBeforeAudit,
  exportRecordingAsciinema,
  deleteRecording,
  cleanRecordings,
} from '../../services/ops/terminal-recordings.service';
import { mountCrud } from '../_crud';

const recordingsRouter = new OpenAPIHono({ defaultHook: validationHook });

const createRoute_ = defineContractRoute(terminalRecordingContract.create, {
  handler: async (c) => {
    const user = currentUser();
    const body = c.req.valid('json');
    const result = await createRecording(user.userId, user.tenantId ?? null, {
      title: body.title,
      shell: body.shell ?? null,
      cols: body.cols,
      rows: body.rows,
      duration: body.duration,
      events: body.events,
    });
    setAuditAfterData(c, result);
    return c.json(okBody(result, '保存成功'), 200);
  },
});

const getRoute = defineContractRoute(terminalRecordingContract.detail, {
  handler: async (c) => {
    const id = Number(c.req.valid('param').id);
    return c.json(okBody(await getRecording(id)), 200);
  },
});

const deleteRoute = defineContractRoute(terminalRecordingContract.remove, {
  handler: async (c) => {
    const id = Number(c.req.valid('param').id);
    setAuditBeforeData(c, await getRecordingBeforeAudit(id));
    await deleteRecording(id);
    return c.json(okBody(null, '删除成功'), 200);
  },
});

const exportAsciinemaRoute = defineContractRoute(terminalRecordingContract.asciinema, {
  handler: async (c) => {
    const result = await exportRecordingAsciinema(Number(c.req.valid('param').id));
    return fileBody(result.content, result.filename, result.contentType);
  },
});

const cleanRoute = defineContractRoute(terminalRecordingContract.clean, {
  handler: async (c) => {
    const { days } = c.req.valid('query');
    const deleted = await cleanRecordings(days);
    setAuditAfterData(c, { days, deleted });
    return c.json(okBody(null, `共删除 ${deleted} 条录屏记录`), 200);
  },
});

// 静态 DELETE /clean 必须先于 DELETE /{id} 注册
mountCrud(recordingsRouter, terminalRecordingContract,
  { list: listRecordings },
  { exclude: ['detail', 'create', 'remove'] },
  [createRoute_, cleanRoute, exportAsciinemaRoute, getRoute, deleteRoute],
);

export default recordingsRouter;
