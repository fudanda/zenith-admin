import { beforeEach, describe, expect, it, vi } from 'vitest';

const { select, insert, onConflictDoUpdate, values: insertValues } = vi.hoisted(() => ({
  select: vi.fn(),
  insert: vi.fn(),
  onConflictDoUpdate: vi.fn(),
  values: vi.fn(),
}));

vi.mock('../../db', () => ({
  db: { select, insert },
}));

import {
  detectSchemaIssues,
  evaluateEvents,
  invalidateGovernanceCache,
  __resetGovernanceStateForTest,
} from './analytics-governance.service';
import type { TrackEventInput } from '@arcbase/shared/analytics';

function baseEvent(overrides: Partial<TrackEventInput> = {}): TrackEventInput {
  return {
    eventId: 'evt-1',
    sessionId: 'session-1',
    eventType: 'custom',
    pagePath: '/checkout',
    ...overrides,
  } as TrackEventInput;
}

describe('detectSchemaIssues — Tracking Plan propertySchema validation', () => {
  it('returns no issues when propertySchema is null/empty', () => {
    expect(detectSchemaIssues(null, { any: 'thing' })).toEqual([]);
    expect(detectSchemaIssues([], { any: 'thing' })).toEqual([]);
  });

  it('flags a missing required property', () => {
    const issues = detectSchemaIssues([{ key: 'amount', type: 'number', required: true }], {});
    expect(issues).toEqual([{ key: 'amount', issueType: 'missing_required', expected: 'number', actualType: 'undefined' }]);
  });

  it('does not flag a missing optional property', () => {
    const issues = detectSchemaIssues([{ key: 'amount', type: 'number', required: false }], {});
    expect(issues).toEqual([]);
  });

  it('flags a type mismatch without leaking the actual value', () => {
    const issues = detectSchemaIssues([{ key: 'amount', type: 'number' }], { amount: 'not-a-number' });
    expect(issues).toEqual([{ key: 'amount', issueType: 'type_mismatch', expected: 'number', actualType: 'string' }]);
  });

  it('validates datetime as Date instance or ISO-parsable string', () => {
    expect(detectSchemaIssues([{ key: 'at', type: 'datetime' }], { at: new Date().toISOString() })).toEqual([]);
    expect(detectSchemaIssues([{ key: 'at', type: 'datetime' }], { at: 'not-a-date' })[0]?.issueType).toBe('type_mismatch');
  });

  it('validates object/array types distinctly', () => {
    expect(detectSchemaIssues([{ key: 'tags', type: 'array' }], { tags: [1, 2] })).toEqual([]);
    expect(detectSchemaIssues([{ key: 'tags', type: 'array' }], { tags: { a: 1 } })[0]?.actualType).toBe('object');
    expect(detectSchemaIssues([{ key: 'meta', type: 'object' }], { meta: [1, 2] })[0]?.actualType).toBe('array');
  });

  it('flags an invalid enum value without leaking the raw value, using the schema-defined allowed list as "expected"', () => {
    const issues = detectSchemaIssues([{ key: 'currency', type: 'string', enumValues: ['CNY', 'USD'] }], { currency: 'secret-raw-value' });
    expect(issues).toEqual([{ key: 'currency', issueType: 'invalid_enum', expected: 'CNY|USD', actualType: 'string' }]);
    // 断言脱敏：不应含用户上报的原始值
    expect(JSON.stringify(issues)).not.toContain('secret-raw-value');
  });

  it('allows unknown properties not declared in the schema', () => {
    const issues = detectSchemaIssues([{ key: 'amount', type: 'number', required: true }], { amount: 1, extra: 'anything' });
    expect(issues).toEqual([]);
  });
});

describe('evaluateEvents — governance gate', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    __resetGovernanceStateForTest();
    insertValues.mockReturnValue({ onConflictDoUpdate });
    onConflictDoUpdate.mockResolvedValue(undefined);
    insert.mockReturnValue({ values: insertValues });
  });

  function mockCacheRows(metaRows: unknown[], overrideRows: unknown[] = []) {
    let call = 0;
    // meta query (no .where()) resolves directly via `from`, override query chains `.where()`
    select.mockImplementation(() => {
      call += 1;
      const isMetaQuery = call % 2 === 1;
      return {
        from: () => (isMetaQuery
          ? Promise.resolve(metaRows)
          : { where: async () => overrideRows }),
      };
    });
  }

  it('passes through events with no eventName untouched', async () => {
    mockCacheRows([]);
    const events = [baseEvent({ eventName: undefined })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual(events);
    expect(result.pendingSchemaIssues).toEqual([]);
  });

  it('rejects an event whose Tracking Plan status is globally blocked', async () => {
    mockCacheRows([{ eventName: 'bad_event', status: 'blocked', strictMode: false, propertySchema: null }]);
    const events = [baseEvent({ eventName: 'bad_event' })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual([]);
  });

  it('rejects an event disabled for the current tenant and records event_disabled quality once per client eventId', async () => {
    mockCacheRows(
      [{ eventName: 'checkout', status: 'active', strictMode: false, propertySchema: null }],
      [{ tenantId: 11, eventName: 'checkout' }],
    );
    const events = [baseEvent({ eventName: 'checkout', eventId: 'evt-dup' })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual([]);
    await vi.waitFor(() => expect(insert).toHaveBeenCalledTimes(1));

    // Re-evaluate the same client eventId again (simulated retry): must not double count
    mockCacheRows(
      [{ eventName: 'checkout', status: 'active', strictMode: false, propertySchema: null }],
      [{ tenantId: 11, eventName: 'checkout' }],
    );
    await evaluateEvents(events, 11);
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(insert).toHaveBeenCalledTimes(1); // still just once — dedup by client eventId worked
  });

  it('does not reject an event disabled only for a different tenant', async () => {
    mockCacheRows(
      [{ eventName: 'checkout', status: 'active', strictMode: false, propertySchema: null }],
      [{ tenantId: 999, eventName: 'checkout' }],
    );
    const events = [baseEvent({ eventName: 'checkout' })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual(events);
  });

  it('strictMode=true rejects an event with a schema issue', async () => {
    mockCacheRows([{
      eventName: 'order_submit', status: 'active', strictMode: true,
      propertySchema: [{ key: 'amount', type: 'number', required: true }],
    }]);
    const events = [baseEvent({ eventName: 'order_submit', properties: {} })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual([]);
  });

  it('strictMode=false accepts an event with a schema issue but reports the pending issue for later fresh-gated counting', async () => {
    mockCacheRows([{
      eventName: 'order_submit', status: 'active', strictMode: false,
      propertySchema: [{ key: 'amount', type: 'number', required: true }],
    }]);
    const events = [baseEvent({ eventName: 'order_submit', properties: {} })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual(events);
    expect(result.pendingSchemaIssues).toHaveLength(1);
    expect(result.pendingSchemaIssues[0]).toMatchObject({ tenantId: 11, issues: [{ key: 'amount', issueType: 'missing_required' }] });
  });

  it('degrades to full pass-through when the cache load fails (governance must never block real ingest)', async () => {
    select.mockImplementation(() => { throw new Error('db down'); });
    const events = [baseEvent({ eventName: 'order_submit' })];
    const result = await evaluateEvents(events, 11);
    expect(result.accepted).toEqual(events);
    expect(result.pendingSchemaIssues).toEqual([]);
  });
});

describe('invalidateGovernanceCache', () => {
  it('forces the next evaluateEvents call to reload from the database', async () => {
    __resetGovernanceStateForTest();
    insertValues.mockReturnValue({ onConflictDoUpdate });
    onConflictDoUpdate.mockResolvedValue(undefined);
    insert.mockReturnValue({ values: insertValues });
    let selectCalls = 0;
    select.mockImplementation(() => {
      selectCalls += 1;
      return { from: () => (selectCalls % 2 === 1 ? Promise.resolve([]) : { where: async () => [] }) };
    });
    await evaluateEvents([baseEvent({ eventName: 'x' })], 11);
    const callsAfterFirst = selectCalls;
    await evaluateEvents([baseEvent({ eventName: 'x' })], 11);
    expect(selectCalls).toBe(callsAfterFirst); // cached, no new queries within TTL
    invalidateGovernanceCache();
    await evaluateEvents([baseEvent({ eventName: 'x' })], 11);
    expect(selectCalls).toBeGreaterThan(callsAfterFirst); // cache invalidated → reloaded
  });
});
