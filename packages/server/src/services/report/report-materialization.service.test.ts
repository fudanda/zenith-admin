import { describe, expect, it } from 'vitest';
import type { ReportDataResult } from '@arcbase/shared/report';
import {
  filterIncrementalDelta,
  mergeIncrementalSnapshot,
  resolveSnapshotWatermark,
} from './report-materialization.service';

function result(rows: Record<string, unknown>[]): ReportDataResult {
  return {
    columns: ['id', 'value'],
    fields: [
      { name: 'id', label: 'id', type: 'number', source: 'declared' },
      { name: 'value', label: 'value', type: 'string', source: 'declared' },
    ],
    rows,
    total: rows.length,
  };
}

describe('report durable materialization helpers', () => {
  it('deterministically upserts incremental rows by key', () => {
    const merged = mergeIncrementalSnapshot(
      result([{ id: 2, value: 'old' }, { id: 1, value: 'one' }]),
      result([{ id: 2, value: 'new' }, { id: 3, value: 'three' }]),
      'id',
    );
    expect(merged.rows).toEqual([
      { id: 1, value: 'one' },
      { id: 2, value: 'new' },
      { id: 3, value: 'three' },
    ]);
  });

  it('filters numeric and date watermark deltas with overlap windows', () => {
    expect(filterIncrementalDelta(result([{ id: 8 }, { id: 10 }, { id: 12 }]), 'id', '10', 0).rows)
      .toEqual([{ id: 10 }, { id: 12 }]);
    const dateData: ReportDataResult = {
      columns: ['changedAt'],
      fields: [{ name: 'changedAt', label: 'changedAt', type: 'date', source: 'declared' }],
      rows: [
        { changedAt: '2026-03-10 09:00:00' },
        { changedAt: '2026-03-10 09:50:00' },
      ],
    };
    expect(filterIncrementalDelta(dateData, 'changedAt', '2026-03-10 10:00:00', 15).rows)
      .toEqual([{ changedAt: '2026-03-10 09:50:00' }]);
  });

  it('resolves the greatest stable watermark and rejects missing keys', () => {
    expect(resolveSnapshotWatermark([{ id: 2 }, { id: 10 }, { id: 3 }], 'id')).toBe('10');
    expect(() => mergeIncrementalSnapshot(null, result([{ value: 'x' }]), 'id')).toThrow('增量物化键不能为空');
  });
});
