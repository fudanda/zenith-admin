import { beforeEach, describe, expect, it } from 'vitest';
import { ACCOUNTS_STORE_KEY, MAX_STORED_ACCOUNTS } from '@arcbase/shared/core';
import {
  clearParkedAccounts,
  getParkedAccount,
  listParkedAccounts,
  parkAccount,
  removeParkedAccount,
  takeParkedAccount,
  type StoredAccount,
} from './account-store';

function makeAccount(overrides: Partial<StoredAccount> = {}): StoredAccount {
  return {
    userId: 1,
    username: 'admin',
    nickname: '管理员',
    refreshToken: 'refresh-1',
    lastUsedAt: 1000,
    ...overrides,
  };
}

beforeEach(() => {
  localStorage.clear();
});

describe('account-store', () => {
  it('parks and lists accounts sorted by lastUsedAt desc', () => {
    parkAccount(makeAccount({ userId: 1, lastUsedAt: 100 }));
    parkAccount(makeAccount({ userId: 2, username: 'lisi', nickname: '李四', refreshToken: 'refresh-2', lastUsedAt: 300 }));
    parkAccount(makeAccount({ userId: 3, username: 'wangwu', nickname: '王五', refreshToken: 'refresh-3', lastUsedAt: 200 }));

    expect(listParkedAccounts().map((a) => a.userId)).toEqual([2, 3, 1]);
  });

  it('deduplicates by userId keeping the latest snapshot', () => {
    parkAccount(makeAccount({ refreshToken: 'old-refresh', lastUsedAt: 100 }));
    parkAccount(makeAccount({ refreshToken: 'new-refresh', lastUsedAt: 200 }));

    const list = listParkedAccounts();
    expect(list).toHaveLength(1);
    expect(list[0].refreshToken).toBe('new-refresh');
  });

  it('evicts the least recently used account beyond the cap (active slot reserved)', () => {
    const capacity = MAX_STORED_ACCOUNTS - 1;
    for (let i = 1; i <= capacity + 1; i++) {
      parkAccount(makeAccount({ userId: i, username: `user${i}`, refreshToken: `refresh-${i}`, lastUsedAt: i }));
    }

    const list = listParkedAccounts();
    expect(list).toHaveLength(capacity);
    // userId 1（lastUsedAt 最小）被淘汰
    expect(list.some((a) => a.userId === 1)).toBe(false);
  });

  it('takes a parked account out of the registry', () => {
    parkAccount(makeAccount({ userId: 1 }));
    parkAccount(makeAccount({ userId: 2, username: 'lisi', refreshToken: 'refresh-2' }));

    const taken = takeParkedAccount(2);
    expect(taken?.refreshToken).toBe('refresh-2');
    expect(getParkedAccount(2)).toBeNull();
    expect(getParkedAccount(1)).not.toBeNull();
    expect(takeParkedAccount(99)).toBeNull();
  });

  it('removes and clears accounts', () => {
    parkAccount(makeAccount({ userId: 1 }));
    parkAccount(makeAccount({ userId: 2, username: 'lisi', refreshToken: 'refresh-2' }));

    removeParkedAccount(1);
    expect(listParkedAccounts().map((a) => a.userId)).toEqual([2]);

    clearParkedAccounts();
    expect(listParkedAccounts()).toEqual([]);
    expect(localStorage.getItem(ACCOUNTS_STORE_KEY)).toBeNull();
  });

  it('ignores corrupted or malformed storage content', () => {
    localStorage.setItem(ACCOUNTS_STORE_KEY, 'not-json');
    expect(listParkedAccounts()).toEqual([]);

    localStorage.setItem(ACCOUNTS_STORE_KEY, JSON.stringify({ userId: 1 }));
    expect(listParkedAccounts()).toEqual([]);

    // 合法条目保留，非法条目过滤
    localStorage.setItem(ACCOUNTS_STORE_KEY, JSON.stringify([
      makeAccount({ userId: 1 }),
      { userId: 2, username: 'broken' },
      { userId: 3, username: 'no-token', nickname: 'x', refreshToken: '', lastUsedAt: 1 },
    ]));
    expect(listParkedAccounts().map((a) => a.userId)).toEqual([1]);
  });
});
