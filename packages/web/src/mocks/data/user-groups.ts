import type { UserGroup } from '@arcbase/shared/identity';

interface MockUserGroup extends UserGroup {
  memberIds: number[];
  roleIds: number[];
}

export const mockUserGroups: MockUserGroup[] = [
  {
    id: 1,
    name: '研发部审批组',
    code: 'rd_approver',
    description: '研发部门审批人员组',
    ownerId: 1,
    ownerName: '管理员',
    memberMode: 'static',
    memberRule: null,
    ruleSyncedAt: null,
    memberCount: 3,
    memberIds: [1, 2, 3],
    roleIds: [2],
    roleCount: 1,
    status: 'enabled',
    createdAt: '2026-05-01 09:00:00',
    updatedAt: '2026-05-01 09:00:00',
  },
  {
    id: 2,
    name: '财务复核组',
    code: 'finance_review',
    description: '财务凭证复核人员',
    ownerId: 1,
    ownerName: '管理员',
    memberMode: 'static',
    memberRule: null,
    ruleSyncedAt: null,
    memberCount: 2,
    memberIds: [1, 4],
    roleIds: [],
    roleCount: 0,
    status: 'enabled',
    createdAt: '2026-05-02 10:30:00',
    updatedAt: '2026-05-02 10:30:00',
  },
  {
    id: 3,
    name: '研发全员（动态）',
    code: 'rd_all_dynamic',
    description: '按部门规则自动维护的示例动态组',
    ownerId: 1,
    ownerName: '管理员',
    memberMode: 'dynamic',
    memberRule: { departmentIds: [1], includeSubDepartments: true },
    ruleSyncedAt: '2026-05-03 02:00:00',
    memberCount: 2,
    memberIds: [2, 3],
    roleIds: [],
    roleCount: 0,
    status: 'enabled',
    createdAt: '2026-05-03 09:00:00',
    updatedAt: '2026-05-03 09:00:00',
  },
];

let nextId = mockUserGroups.length + 1;
export function getNextUserGroupId() { return nextId++; }
