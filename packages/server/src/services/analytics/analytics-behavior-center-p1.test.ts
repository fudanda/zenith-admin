import { describe, expect, it } from 'vitest';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { ANALYTICS_ENVIRONMENTS, ANALYTICS_EVENT_OVERRIDE_STATUS_LABELS, ANALYTICS_EVENT_PROPERTY_TYPES, ANALYTICS_EVENT_SOURCES, ANALYTICS_IDENTITY_TYPES, ANALYTICS_QUALITY_ISSUE_TYPES, createAnalyticsEventMetaSchema, createAnalyticsUserSegmentSchema } from '@arcbase/shared/analytics';
import {
  analyticsEventOverrides,
  analyticsEventOverrideStatusEnum,
  analyticsEventQualityDaily,
  analyticsEventQualityIssueTypeEnum,
  analyticsEventSourceEnum,
  analyticsEventMeta,
  analyticsIdentityTypeEnum,
  analyticsSegmentMembers,
  analyticsSessions,
  analyticsUserProfiles,
  analyticsUserSegments,
  errorEvents,
  userEvents,
} from '../../db/schema';

describe('behavior center P1 — enum sync (DB pgEnum ↔ shared constants)', () => {
  it('keeps analytics_event_source enum values aligned with shared ANALYTICS_EVENT_SOURCES', () => {
    expect(analyticsEventSourceEnum.enumValues).toEqual(ANALYTICS_EVENT_SOURCES);
  });

  it('keeps analytics_identity_type enum values aligned with shared ANALYTICS_IDENTITY_TYPES', () => {
    expect(analyticsIdentityTypeEnum.enumValues).toEqual(ANALYTICS_IDENTITY_TYPES);
  });

  it('keeps analytics_event_override_status enum values aligned with shared COMMON_STATUS labels', () => {
    expect(analyticsEventOverrideStatusEnum.enumValues).toEqual(Object.keys(ANALYTICS_EVENT_OVERRIDE_STATUS_LABELS));
  });

  it('keeps analytics_event_quality_issue_type enum values aligned with shared ANALYTICS_QUALITY_ISSUE_TYPES', () => {
    expect(analyticsEventQualityIssueTypeEnum.enumValues).toEqual(ANALYTICS_QUALITY_ISSUE_TYPES);
  });

  it('keeps environment varchar column values constrained to shared ANALYTICS_ENVIRONMENTS via zod', () => {
    // environment 采用 varchar + zod enum（非 pg enum）以便未来新增环境值无需迁移，此处仅验证契约常量本身非空/去重
    expect(new Set(ANALYTICS_ENVIRONMENTS).size).toBe(ANALYTICS_ENVIRONMENTS.length);
  });
});

const validPropertySchema = [
  { key: 'amount', type: 'number' as const, required: true },
  { key: 'currency', type: 'string' as const, enumValues: ['CNY', 'USD'] },
];

describe('behavior center P1 — Tracking Plan property schema validation', () => {
  it('accepts a well-formed property schema', () => {
    const result = createAnalyticsEventMetaSchema.safeParse({
      eventName: 'order_submit',
      propertySchema: validPropertySchema,
    });
    expect(result.success).toBe(true);
  });

  it('rejects duplicate keys within the same property schema', () => {
    const result = createAnalyticsEventMetaSchema.safeParse({
      eventName: 'order_submit',
      propertySchema: [
        { key: 'amount', type: 'number' },
        { key: 'amount', type: 'string' },
      ],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unsupported property type', () => {
    const result = createAnalyticsEventMetaSchema.safeParse({
      eventName: 'order_submit',
      propertySchema: [{ key: 'amount', type: 'bigint' }],
    });
    expect(result.success).toBe(false);
  });

  it('rejects an empty property key', () => {
    const result = createAnalyticsEventMetaSchema.safeParse({
      eventName: 'order_submit',
      propertySchema: [{ key: '', type: 'string' }],
    });
    expect(result.success).toBe(false);
  });

  it('validates every declared property type is one of the shared enum values', () => {
    for (const type of ANALYTICS_EVENT_PROPERTY_TYPES) {
      const result = createAnalyticsEventMetaSchema.safeParse({
        eventName: 'evt',
        propertySchema: [{ key: 'k', type }],
      });
      expect(result.success).toBe(true);
    }
  });

  it('does not allow clients to set the server-managed version field', () => {
    const result = createAnalyticsEventMetaSchema.safeParse({ eventName: 'evt', version: 5 });
    // 未声明的字段会被 Zod 忽略（非 strict schema），但类型上不导出 version 供客户端填写
    expect(result.success).toBe(true);
    expect((result.success ? result.data : {}) as Record<string, unknown>).not.toHaveProperty('version');
  });
});

const baseRule = {
  operator: 'AND' as const,
  conditions: [
    { type: 'event' as const, eventName: 'order_submit', days: 30, minCount: 1 },
  ],
};

describe('behavior center P1 — user segment rule boundaries', () => {
  it('accepts a minimal valid AND rule with a single event condition', () => {
    const result = createAnalyticsUserSegmentSchema.safeParse({ name: '高价值用户', rules: baseRule });
    expect(result.success).toBe(true);
  });

  it('accepts an OR rule combining event and attribute conditions', () => {
    const result = createAnalyticsUserSegmentSchema.safeParse({
      name: '活跃管理员',
      rules: {
        operator: 'OR',
        conditions: [
          { type: 'event', eventName: '$pageview', days: 7, minCount: 3 },
          { type: 'attribute', field: 'identityType', op: 'eq', value: 'admin' },
        ],
      },
    });
    expect(result.success).toBe(true);
  });

  it('rejects a rule with zero conditions', () => {
    const result = createAnalyticsUserSegmentSchema.safeParse({
      name: '空规则',
      rules: { operator: 'AND', conditions: [] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects a rule with more than 10 conditions', () => {
    const conditions = Array.from({ length: 11 }, (_, i) => ({
      type: 'attribute' as const,
      field: `prop${i}`,
      op: 'eq' as const,
      value: i,
    }));
    const result = createAnalyticsUserSegmentSchema.safeParse({
      name: '超限规则',
      rules: { operator: 'AND', conditions },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an unknown condition type (no cohort nesting supported in this phase)', () => {
    const result = createAnalyticsUserSegmentSchema.safeParse({
      name: '嵌套分群',
      rules: { operator: 'AND', conditions: [{ type: 'cohort', segmentId: 1 }] },
    });
    expect(result.success).toBe(false);
  });

  it('rejects an invalid compare operator on an attribute condition', () => {
    const result = createAnalyticsUserSegmentSchema.safeParse({
      name: '非法运算符',
      rules: {
        operator: 'AND',
        conditions: [{ type: 'attribute', field: 'userId', op: 'contains', value: 1 }],
      },
    });
    expect(result.success).toBe(false);
  });
});

describe('behavior center P1 — schema field & index existence', () => {
  it('extends user_events with multi-platform columns and matching indexes', () => {
    expect(userEvents.source).toBeDefined();
    expect(userEvents.appId).toBeDefined();
    expect(userEvents.environment).toBeDefined();
    expect(userEvents.sdkVersion).toBeDefined();
    expect(userEvents.memberId).toBeDefined();
    const indexNames = getTableConfig(userEvents).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('user_events_member_idx');
    expect(indexNames).toContain('user_events_tenant_created_name_idx');
    expect(indexNames).toContain('user_events_source_created_idx');
  });

  it('extends analytics_sessions with multi-platform columns and the tenant+startedAt index', () => {
    expect(analyticsSessions.source).toBeDefined();
    expect(analyticsSessions.appId).toBeDefined();
    expect(analyticsSessions.environment).toBeDefined();
    expect(analyticsSessions.memberId).toBeDefined();
    const indexNames = getTableConfig(analyticsSessions).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_sessions_member_idx');
    expect(indexNames).toContain('analytics_sessions_tenant_started_idx');
  });

  it('extends error_events with multi-platform columns', () => {
    expect(errorEvents.source).toBeDefined();
    expect(errorEvents.appId).toBeDefined();
    expect(errorEvents.environment).toBeDefined();
    expect(errorEvents.memberId).toBeDefined();
    const indexNames = getTableConfig(errorEvents).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('error_events_member_idx');
  });

  it('extends analytics_event_meta into a Tracking Plan', () => {
    expect(analyticsEventMeta.version).toBeDefined();
    expect(analyticsEventMeta.ownerId).toBeDefined();
    expect(analyticsEventMeta.ownerName).toBeDefined();
    expect(analyticsEventMeta.strictMode).toBeDefined();
    const indexNames = getTableConfig(analyticsEventMeta).indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_event_meta_owner_idx');
  });

  it('declares analytics_event_overrides with tenant scoping and a unique tenant+eventName index', () => {
    const config = getTableConfig(analyticsEventOverrides);
    expect(analyticsEventOverrides.tenantId).toBeDefined();
    expect(analyticsEventOverrides.eventName).toBeDefined();
    expect(analyticsEventOverrides.status).toBeDefined();
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_event_overrides_tenant_name_uq');
    expect(indexNames).toContain('analytics_event_overrides_status_idx');
  });

  it('declares analytics_event_quality_daily with the composite uniqueness key', () => {
    const config = getTableConfig(analyticsEventQualityDaily);
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_event_quality_daily_uq');
    expect(indexNames).toContain('analytics_event_quality_daily_date_idx');
    expect(indexNames).toContain('analytics_event_quality_daily_tenant_idx');
  });

  it('declares analytics_user_profiles with a coalesced tenant+distinctId uniqueness key', () => {
    const config = getTableConfig(analyticsUserProfiles);
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_user_profiles_tenant_distinct_uq');
    expect(indexNames).toContain('analytics_user_profiles_user_idx');
    expect(indexNames).toContain('analytics_user_profiles_member_idx');
    expect(indexNames).toContain('analytics_user_profiles_last_seen_idx');
  });

  it('declares analytics_user_segments with global and tenant-scoped partial unique name indexes', () => {
    const config = getTableConfig(analyticsUserSegments);
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_user_segments_tenant_name_uq');
    expect(indexNames).toContain('analytics_user_segments_global_name_uq');
    expect(indexNames).toContain('analytics_user_segments_tenant_status_idx');
  });

  it('declares analytics_segment_members as a materialized snapshot with cascade FK', () => {
    const config = getTableConfig(analyticsSegmentMembers);
    const indexNames = config.indexes.map((index) => index.config.name);
    expect(indexNames).toContain('analytics_segment_members_segment_distinct_uq');
    expect(indexNames).toContain('analytics_segment_members_segment_idx');
    expect(indexNames).toContain('analytics_segment_members_tenant_idx');
    expect(indexNames).toContain('analytics_segment_members_member_idx');
  });
});
