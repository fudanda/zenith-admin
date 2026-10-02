import { defineContract, op } from '@arcbase/shared/core';
import { positionContract } from '@arcbase/shared/identity';
import { hostPermissions } from './permissions';

export const hostPositionContract = defineContract('/api/v1/extensions/position-host/positions', {
  list: op.get('/', { access: { permission: 'system:position:list' }, query: positionContract.list.query.pick({ keyword: true, status: true, page: true, pageSize: true }), response: positionContract.list.response, summary: '宿主岗位查询' }),
  create: op.post('/', { access: { permission: hostPermissions.create }, body: positionContract.create.body, response: positionContract.create.response, audit: '宿主创建岗位', summary: '宿主创建岗位' }),
}, { auditModule: '宿主岗位模块' });
