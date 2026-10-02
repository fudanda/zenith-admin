import { beforeEach, describe, expect, it } from 'vitest';
import {
  clearAllListFilterSnapshots,
  clearListFilterSnapshot,
  readListFilterSnapshot,
  writeListFilterSnapshot,
} from './list-filter-memory';

const listKey = ['tags', 'list', { query: {} }] as const;

beforeEach(() => {
  sessionStorage.clear();
});

describe('list filter memory', () => {
  it('round-trips plain filters keyed by the list query key', () => {
    writeListFilterSnapshot(listKey, { keyword: 'a', status: 'enabled', deptId: 3, flag: false });
    expect(readListFilterSnapshot(listKey)).toEqual({ keyword: 'a', status: 'enabled', deptId: 3, flag: false });
    expect(readListFilterSnapshot(['other'])).toBeUndefined();
  });

  it('revives Date values instead of leaving ISO strings behind', () => {
    const from = new Date(2026, 0, 2, 3, 4, 5);
    writeListFilterSnapshot(listKey, { range: [from, null], nested: { at: from } });
    const restored = readListFilterSnapshot<{ range: [Date, null]; nested: { at: Date } }>(listKey);
    expect(restored?.range[0]).toBeInstanceOf(Date);
    expect(restored?.range[0].getTime()).toBe(from.getTime());
    expect(restored?.nested.at.getTime()).toBe(from.getTime());
  });

  it('clears one key or every snapshot without touching unrelated storage', () => {
    sessionStorage.setItem('unrelated', '1');
    writeListFilterSnapshot(listKey, { keyword: 'a' });
    writeListFilterSnapshot(['b'], { keyword: 'b' });
    clearListFilterSnapshot(listKey);
    expect(readListFilterSnapshot(listKey)).toBeUndefined();
    expect(readListFilterSnapshot(['b'])).toEqual({ keyword: 'b' });
    clearAllListFilterSnapshots();
    expect(readListFilterSnapshot(['b'])).toBeUndefined();
    expect(sessionStorage.getItem('unrelated')).toBe('1');
  });

  it('ignores corrupt snapshots', () => {
    sessionStorage.setItem(`arcbase:list-filters:${JSON.stringify(listKey)}`, '{not json');
    expect(readListFilterSnapshot(listKey)).toBeUndefined();
  });
});
