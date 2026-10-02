import { positionContract, type Position } from '@arcbase/shared/identity';
import { mock } from '@/mocks/utils/contract';
import { mockPositions, getNextPositionId } from '@/mocks/data/positions';
import { mockUsers } from '@/mocks/data/users';
import { mockDepartments } from '@/mocks/data/departments';
import { mockDateTime } from '@/mocks/utils/date';
import { removeByIds, requireItem } from '@/mocks/utils/crud';
import { mockResource } from '@/mocks/utils/resource';

function findDepartmentName(departmentId: number | null | undefined): string | null {
  if (!departmentId) return null;
  const stack = [...mockDepartments];
  while (stack.length > 0) {
    const dept = stack.pop();
    if (!dept) continue;
    if (dept.id === departmentId) return dept.name;
    if (dept.children) stack.push(...dept.children);
  }
  return null;
}

export const positionsHandlers = [
  // 所有岗位（供下拉框使用）
  mock(positionContract.all, ({ ok }) => {
    return ok(mockPositions);
  }),
  ...mockResource(positionContract, {
    store: mockPositions,
    notFound: '岗位不存在',
    keyword: (item) => [item.name, item.code],
    exclude: ['create', 'removeBatch'],
  }),

  // 批量删除岗位
  mock(positionContract.removeBatch, ({ body, ok }) => {
    removeByIds(mockPositions, body.ids);
    return ok(null, `已删除 ${body.ids.length} 个岗位`);
  }),

  // 新增岗位
  mock(positionContract.create, ({ body, ok }) => {
    const newPos: Position = {
      id: getNextPositionId(),
      ...body,
      createdAt: mockDateTime(),
      updatedAt: mockDateTime(),
    };
    mockPositions.push(newPos);
    return ok(newPos, '新增成功');
  }),

  // 获取岗位成员
  mock(positionContract.members, ({ params, ok }) => {
    const positionId = params.id;
    requireItem(mockPositions, positionId, '岗位不存在', { status: 404 });
    const list = mockUsers
      .filter((u) => (u.positionIds ?? []).includes(positionId))
      .map((u) => ({
        id: u.id, username: u.username, nickname: u.nickname, email: u.email,
        avatar: u.avatar ?? null,
        departmentName: findDepartmentName(u.departmentId),
        joinedAt: u.createdAt,
      }));
    return ok(list);
  }),

  // 分配岗位成员（先清后设）
  mock(positionContract.setMembers, ({ params, body, ok }) => {
    const positionId = params.id;
    const pos = requireItem(mockPositions, positionId, '岗位不存在', { status: 404 });
    const nextIds = new Set(body.userIds);
    mockUsers.forEach((u) => {
      const ids = new Set(u.positionIds ?? []);
      if (nextIds.has(u.id)) ids.add(positionId);
      else ids.delete(positionId);
      u.positionIds = [...ids];
      u.positions = u.positionIds
        .map((pid) => mockPositions.find((p) => p.id === pid))
        .filter((p): p is Position => Boolean(p));
    });
    pos.updatedAt = mockDateTime();
    return ok(null, '成员分配成功');
  }),
];
