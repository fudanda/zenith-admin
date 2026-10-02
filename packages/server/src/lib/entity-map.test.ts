import { describe, expect, expectTypeOf, it } from 'vitest';
import * as z from 'zod';
import { entityStatusSchema, auditFieldsSchema } from '@arcbase/shared/core';
import { formatDateTime } from './datetime';
import { entityMapper, pickEntity } from './entity-map';

const tagSchema = z.object({
  id: z.int(),
  name: z.string(),
  color: z.string().nullable(),
  description: z.string().nullable().optional(),
  status: entityStatusSchema,
  sortOrder: z.int(),
  ...auditFieldsSchema,
  createdAt: z.string(),
  updatedAt: z.string(),
});

const createdAt = new Date(2026, 8, 13, 10, 20, 30);
const updatedAt = new Date(2026, 8, 13, 11, 0, 0);

const row = {
  id: 7,
  name: '重点',
  color: null,
  description: undefined,
  status: 'enabled' as const,
  sortOrder: 3,
  createdBy: 1,
  updatedBy: null,
  createdAt,
  updatedAt,
  internalFlag: 'not in entity',
};

describe('pickEntity', () => {
  it('按实体 schema 的键投影、Date 格式化、undefined 归一为 null，行上多余列不泄漏', () => {
    const entity = pickEntity(tagSchema, row);
    expect(entity).toEqual({
      id: 7,
      name: '重点',
      color: null,
      description: null,
      status: 'enabled',
      sortOrder: 3,
      createdBy: 1,
      updatedBy: null,
      createdAt: formatDateTime(createdAt),
      updatedAt: formatDateTime(updatedAt),
    });
    expect('internalFlag' in entity).toBe(false);
    expect(tagSchema.safeParse(entity).success).toBe(true);
    expectTypeOf(entity).toEqualTypeOf<z.output<typeof tagSchema>>();
  });

  it('overrides 原样采用，并免除该键对行的要求', () => {
    const { description: _omit, ...rowWithoutDescription } = row;
    const entity = pickEntity(tagSchema, rowWithoutDescription, { description: '来自覆盖', name: row.name.toUpperCase() });
    expect(entity.description).toBe('来自覆盖');
    expect(entity.name).toBe('重点');
  });

  it('只允许缺省不允许 null 的字段：行值 null → undefined', () => {
    const schema = z.object({ id: z.int(), note: z.string().optional() });
    expect(pickEntity(schema, { id: 1, note: null })).toEqual({ id: 1, note: undefined });
    expect(pickEntity(schema, { id: 1, note: 'x' })).toEqual({ id: 1, note: 'x' });
  });

  it('可为 null 的字段：行值 null / undefined 都归一为 null；有值原样', () => {
    const schema = z.object({ remark: z.string().nullable(), count: z.int().nullable().optional() });
    expect(pickEntity(schema, { remark: undefined, count: null })).toEqual({ remark: null, count: null });
    expect(pickEntity(schema, { remark: 'r', count: 0 })).toEqual({ remark: 'r', count: 0 });
  });

  it('类型层：行缺少实体字段或类型不匹配时不编译', () => {
    const schema = z.object({ id: z.int(), name: z.string(), remark: z.string().nullable() });
    // @ts-expect-error 缺 remark
    pickEntity(schema, { id: 1, name: 'a' });
    // @ts-expect-error name 类型不匹配
    pickEntity(schema, { id: 1, name: 2, remark: null });
    // 通过 overrides 补齐缺失字段则合法
    pickEntity(schema, { id: 1, name: 'a' }, { remark: null });
    // 字符串字段接受 Date（自动格式化）
    pickEntity(schema, { id: 1, name: new Date(), remark: null });
  });

  it('同一 schema 的字段计划只计算一次（WeakMap 缓存），多次调用结果一致', () => {
    const first = pickEntity(tagSchema, row);
    const second = pickEntity(tagSchema, { ...row, name: '另一个' });
    expect(second).toEqual({ ...first, name: '另一个' });
  });
});

describe('entityMapper', () => {
  it('无覆盖：返回接受实体所需行形状的映射函数', () => {
    const mapTag = entityMapper(tagSchema);
    expect(mapTag(row)).toMatchObject({ id: 7, name: '重点', createdAt: formatDateTime(createdAt) });
    expect([row, { ...row, id: 8 }].map(mapTag).map((t) => t.id)).toEqual([7, 8]);
  });

  it('带覆盖：覆盖函数按标注的行类型取内部列，映射入参为「行类型 ∩ 实体要求」', () => {
    const secretSchema = z.object({ id: z.int(), name: z.string(), secret: z.string().nullable(), createdAt: z.string() });
    interface SecretRow { id: number; name: string; secretEncrypted: string | null; createdAt: Date }
    const mapSecret = entityMapper(secretSchema, (r: SecretRow) => ({ secret: r.secretEncrypted ? '******' : null }));
    expect(mapSecret({ id: 1, name: 'k', secretEncrypted: 'enc', createdAt })).toEqual({ id: 1, name: 'k', secret: '******', createdAt: formatDateTime(createdAt) });
    expect(mapSecret({ id: 2, name: 'k', secretEncrypted: null, createdAt }).secret).toBeNull();
    expectTypeOf(mapSecret).returns.toEqualTypeOf<z.output<typeof secretSchema>>();
  });
});
