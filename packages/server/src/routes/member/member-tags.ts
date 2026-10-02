import { OpenAPIHono } from '@hono/zod-openapi';
import { memberTagContract } from '@arcbase/shared/member';
import { validationHook } from '../../lib/openapi-schemas';
import {
  listMemberTags,
  createMemberTag,
  updateMemberTag,
  deleteMemberTag,
  ensureMemberTagExists,
  mapMemberTag,
} from '../../services/member/member-tags.service';
import { mountCrud } from '../_crud';

const memberTagsRouter = new OpenAPIHono({ defaultHook: validationHook });

mountCrud(memberTagsRouter, memberTagContract,
  {
    get: async (id: number) => mapMemberTag(await ensureMemberTagExists(id)),
    create: createMemberTag,
    update: updateMemberTag,
    remove: deleteMemberTag,
    list: listMemberTags,
  },
);

export default memberTagsRouter;
