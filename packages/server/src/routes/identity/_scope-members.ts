/**
 * 「成员预览」路由工厂：部门 / 角色 / 岗位 / 用户组四处形状完全一致，只有契约挂载点不同。
 *
 * 之所以做成四条各自守卫的路由、而不是一条带 scopeType 参数的通用路由：
 * 权限数组是「满足其一」语义，通用路由只能声明四个权限的并集，
 * 那样只有角色查看权的人就能读到部门成员。每个域的 `memberPreviewOp()` 在契约上声明自己的 `:list` 权限，
 * 才能保证「能看见这个列表页 = 能看这一列的成员」，前端也因此不需要任何额外权限判断。
 */
import type { Bind } from '@arcbase/shared/core';
import type { memberPreviewOp } from '@arcbase/shared/identity';
import { defineContractRoute } from '../../lib/contract-route';
import { okBody } from '../../lib/openapi-schemas';
import { listScopeMembers, type UserScopeType } from '../../services/identity/user-scope.service';

type MemberPreviewOperation = Bind<ReturnType<typeof memberPreviewOp>>;

export function defineScopeMembersRoute(options: {
  op: MemberPreviewOperation;
  scopeType: UserScopeType;
}) {
  return defineContractRoute(options.op, {
    handler: async (c) => c.json(
      okBody(await listScopeMembers(options.scopeType, c.req.valid('param').id, c.req.valid('query'))),
      200,
    ),
  });
}
