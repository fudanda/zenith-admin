import type { Role } from '@arcbase/shared/identity';
import { SEED_ROLES } from '@arcbase/shared/seed';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockRoles: Role[] = SEED_ROLES.map((r) => ({
  ...r,
  userCount: r.code === 'super_admin' ? 3 : 5,
  userPreview: r.code === 'super_admin'
    ? [
        { id: 1, nickname: '系统管理员', avatar: null },
        { id: 2, nickname: '张三', avatar: null },
        { id: 3, nickname: '李四', avatar: null },
      ]
    : [
        { id: 4, nickname: '王五', avatar: null },
        { id: 5, nickname: '赵六', avatar: null },
        { id: 6, nickname: '孙七', avatar: null },
        { id: 7, nickname: '周八', avatar: null },
        { id: 8, nickname: '吴九', avatar: null },
      ],
}));

let nextRoleId = nextIdFrom(mockRoles);
export function getNextRoleId() {
  return nextRoleId++;
}
