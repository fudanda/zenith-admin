import { impersonationContract, type ImpersonationSession } from '@arcbase/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { requireItem } from '@/mocks/utils/crud';
import { badRequest, forbidden, notFound, nextIdFrom, unauthorized } from '@/mocks/utils/handlers';
import { currentMockSession, isMockPlatformAdmin, mockAccessToken } from '@/mocks/utils/auth';
import { filterByKeyword, matchesFilter, withinDateRange } from '@/mocks/utils/filter';
import { mockDateTime, mockDateTimeOffset } from '@/mocks/utils/date';
import { mockUsers } from '@/mocks/data/users';
import { getMockSettings } from '@/mocks/data/settings';

/** Demo 模式的模拟登录记录（模块级可变，初始一条已结束的样例） */
const mockImpersonationSessions: ImpersonationSession[] = [
  {
    id: 1,
    impersonatorId: 1,
    impersonatorName: 'admin',
    impersonatorNickname: '超级管理员',
    targetUserId: 2,
    targetUsername: mockUsers[1]?.username ?? 'user',
    targetNickname: mockUsers[1]?.nickname ?? null,
    tenantId: null,
    readOnly: true,
    reason: '工单 #1024：复现该用户看不到报表菜单的问题',
    ip: '127.0.0.1',
    location: '内网地址',
    browser: 'Chrome 124',
    os: 'Windows 11',
    status: 'ended',
    startedAt: mockDateTimeOffset(-2 * 86400 * 1000),
    expiresAt: mockDateTimeOffset(-2 * 86400 * 1000 + 30 * 60_000),
    endedAt: mockDateTimeOffset(-2 * 86400 * 1000 + 12 * 60_000),
    endReason: 'manual',
    endedBy: null,
  },
];

function isActive(row: ImpersonationSession): boolean {
  return row.status === 'active';
}

export const impersonationHandlers = [
  mock(impersonationContract.start, ({ body, request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('未登录', { status: 401 });
    if (session.impersonation) return forbidden('模拟会话中不能再次发起模拟', { status: 403 });
    const policy = getMockSettings('identitySecurity').impersonation;
    if (!policy.enabled) return forbidden('模拟登录功能已关闭', { status: 403 });
    if (!body.readOnly && !policy.allowWrite) return badRequest('当前安全策略只允许只读模拟', { status: 400 });
    if (body.password !== session.user.password) return badRequest('当前账号密码错误，无法发起模拟登录', { status: 400 });
    const target = mockUsers.find((u) => u.id === body.userId);
    if (!target) return notFound('目标用户不存在', { status: 404 });
    if (target.id === session.user.id) return badRequest('不能模拟自己', { status: 400 });
    if (isMockPlatformAdmin(target)) return forbidden('不能模拟平台超级管理员', { status: 403 });
    if (target.status !== 'enabled') return badRequest('目标用户当前不可登录：账号已被禁用', { status: 400 });

    const minutes = Math.min(body.durationMinutes ?? policy.maxMinutes, policy.maxMinutes);
    const startedAt = mockDateTime();
    const expiresAt = mockDateTimeOffset(minutes * 60_000);
    const record: ImpersonationSession = {
      id: nextIdFrom(mockImpersonationSessions),
      impersonatorId: session.user.id,
      impersonatorName: session.user.username,
      impersonatorNickname: session.user.nickname,
      targetUserId: target.id,
      targetUsername: target.username,
      targetNickname: target.nickname,
      tenantId: target.tenantId ?? null,
      readOnly: body.readOnly,
      reason: body.reason,
      ip: '127.0.0.1',
      location: '内网地址',
      browser: 'Chrome 124',
      os: 'Windows 11',
      status: 'active',
      startedAt,
      expiresAt,
      endedAt: null,
      endReason: null,
      endedBy: null,
    };
    mockImpersonationSessions.unshift(record);
    const impersonation = {
      id: record.id,
      impersonatorId: record.impersonatorId,
      impersonatorName: record.impersonatorName,
      readOnly: record.readOnly,
      reason: record.reason,
      startedAt,
      expiresAt,
    };
    return ok({
      accessToken: mockAccessToken(target.username, undefined, { id: record.id, byUserId: session.user.id, byUsername: session.user.username, readOnly: record.readOnly, reason: record.reason, startedAt, expiresAt }),
      impersonation,
      target: { id: target.id, username: target.username, nickname: target.nickname },
    }, '已进入模拟登录');
  }),

  mock(impersonationContract.end, ({ request, ok }) => {
    const session = currentMockSession(request);
    if (!session) return unauthorized('未登录', { status: 401 });
    if (!session.impersonation) return badRequest('当前不是模拟会话', { status: 400 });
    const record = mockImpersonationSessions.find((r) => r.id === session.impersonation?.id);
    if (record && isActive(record)) {
      record.status = 'ended';
      record.endedAt = mockDateTime();
      record.endReason = 'manual';
    }
    return ok(null, '已结束模拟登录');
  }),

  mock(impersonationContract.list, ({ query, ok, paginate }) => {
    const list = filterByKeyword(mockImpersonationSessions, query.keyword, [(r) => r.impersonatorName, (r) => r.targetUsername, (r) => r.reason])
      .filter((r) => matchesFilter(r.status, query.status) && withinDateRange(r.startedAt, query.startTime, query.endTime));
    return ok(paginate(list));
  }),

  mock(impersonationContract.forceEnd, ({ params, ok }) => {
    const record = requireItem(mockImpersonationSessions, params.id, '模拟会话不存在', { status: 404 });
    if (!isActive(record)) return badRequest('该模拟会话已结束', { status: 400 });
    record.status = 'ended';
    record.endedAt = mockDateTime();
    record.endReason = 'forced';
    record.endedBy = 1;
    return ok(null, '已强制结束该模拟会话');
  }),
];
