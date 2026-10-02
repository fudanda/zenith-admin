import { OpenAPIHono } from '@hono/zod-openapi';
import { announcementContract } from '@arcbase/shared/messaging';
import { setAuditBeforeData } from '../../middleware/guard';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody, validationHook } from '../../lib/openapi-schemas';
import {
  listPublishedForUser,
  markAnnouncementRead,
  markAllAnnouncementsRead,
  getInbox,
  listAnnouncements,
  batchDeleteAnnouncements,
  getAnnouncementReadStats,
  getAnnouncementDetail,
  createAnnouncement,
  updateAnnouncement,
  deleteAnnouncement,
  getAnnouncementsBeforeAudit,
  getUnreadAnnouncementCount,
} from '../../services/messaging/announcements.service';
import { mountCrud } from '../_crud';

const announcementsRouter = new OpenAPIHono({ defaultHook: validationHook });

const publishedRoute = defineContractRoute(announcementContract.published, {
  handler: async (c) => c.json(okBody(await listPublishedForUser()), 200),
});

const unreadCountRoute = defineContractRoute(announcementContract.unreadCount, {
  handler: async (c) => c.json(okBody({ count: await getUnreadAnnouncementCount() }), 200),
});

const readRoute = defineContractRoute(announcementContract.markRead, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    await markAnnouncementRead(id);
    return c.json(okBody(null), 200);
  },
});

const readAllRoute = defineContractRoute(announcementContract.markAllRead, {
  handler: async (c) => {
    await markAllAnnouncementsRead();
    return c.json(okBody(null), 200);
  },
});

const inboxRoute = defineContractRoute(announcementContract.inbox, {
  handler: async (c) => c.json(okBody(await getInbox(c.req.valid('query'))), 200),
});

const batchDeleteRoute = defineContractRoute(announcementContract.removeBatch, {
  handler: async (c) => {
    const { ids } = c.req.valid('json');
    const before = await getAnnouncementsBeforeAudit(ids);
    if (before.length > 0) setAuditBeforeData(c, before);
    const count = await batchDeleteAnnouncements(ids);
    return c.json(okBody(null, `已删除 ${count} 条公告`), 200);
  },
});

const readStatsRoute = defineContractRoute(announcementContract.readStats, {
  handler: async (c) => {
    const { id } = c.req.valid('param');
    return c.json(okBody(await getAnnouncementReadStats(id, c.req.valid('query'))), 200);
  },
});

mountCrud(announcementsRouter, announcementContract,
  {
    list: listAnnouncements,
    get: getAnnouncementDetail,
    create: createAnnouncement,
    update: updateAnnouncement,
    remove: deleteAnnouncement,
  },
  { exclude: ['removeBatch'] },
  [
    publishedRoute,
    unreadCountRoute,
    readRoute,
    readAllRoute,
    inboxRoute,
    batchDeleteRoute,
    readStatsRoute,
  ],
);

export default announcementsRouter;
