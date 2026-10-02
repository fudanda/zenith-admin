import { tagContract, type Tag } from '@arcbase/shared/platform';
import { mock } from '@/mocks/utils/contract';
import { mockTags, getTagGroups } from '@/mocks/data/tags';
import { mockResource } from '@/mocks/utils/resource';

export const tagsHandlers = [
  ...mockResource(tagContract, {
    store: mockTags,
    notFound: '标签不存在',
    keyword: (item) => [item.name, item.description],
    unique: { field: 'name', message: '标签名称已存在' },
    create: (body, id, now): Tag => ({ id, name: body.name, color: body.color ?? null, groupName: body.groupName ?? null, description: body.description ?? null, status: body.status, sortOrder: body.sortOrder, createdAt: now, updatedAt: now }),
    messages: { removeBatch: (count) => `已删除 ${count} 条标签` },
  }),

  // 获取分组列表
  mock(tagContract.groups, ({ ok }) => ok(getTagGroups())),
];
