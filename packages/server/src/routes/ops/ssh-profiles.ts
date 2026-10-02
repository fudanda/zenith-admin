import { OpenAPIHono } from '@hono/zod-openapi';
import { sshProfileContract } from '@arcbase/shared/ops';
import { currentUser } from '../../lib/context';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listSshProfiles,
  getSshProfile,
  createSshProfile,
  updateSshProfile,
  deleteSshProfile,
} from '../../services/ops/ssh-profiles.service';
import { mountCrud } from '../_crud';

const router = new OpenAPIHono({ defaultHook: validationHook });

// SSH 配置按用户归属，服务函数显式接收 userId（主机服务也会以指定用户调用）；此处绑定当前用户
mountCrud(router, sshProfileContract,
  {
    list: () => listSshProfiles(currentUser().userId),
    get: (id) => getSshProfile(id, currentUser().userId),
    create: (input) => createSshProfile(currentUser().userId, input),
    update: (id, input) => updateSshProfile(id, currentUser().userId, input),
    remove: (id) => deleteSshProfile(id, currentUser().userId),
  },
  {
    messages: { create: null, update: null },
  },
);

export default router;
