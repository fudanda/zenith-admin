import * as z from 'zod';
import { defineContract, op } from '../../core/contract';

export const goDashboardContract = defineContract('/api/v1/dashboard', {
  stats: op.get('/stats', {
    access: 'authenticated', summary: 'Go 基础统计',
    response: z.object({
      totalUsers: z.int(), onlineUsers: z.int().meta({ description: '拥有未撤销有效会话的管理员数' }),
      todayLogins: z.int(), todayOperations: z.int(),
    }),
  }),
}, { tags: ['Go dashboard'] });
