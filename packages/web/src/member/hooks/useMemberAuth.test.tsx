/**
 * useMemberAuth 单元测试（聚焦本次改动：logout() 的埋点身份收尾）
 *
 * 覆盖要点：
 *  1. logout() 会在移除 MEMBER token 之前调用 prepareTrackerLogout()（尽力用旧身份 flush 队列）
 *  2. logout() 之后 localStorage 中的会员 token 被清除，member 状态被清空
 *
 * Mock 策略：
 *  - vi.mock '@/utils/tracker' 拦截 prepareTrackerLogout，记录调用时序
 *  - vi.mock '../utils/member-request' 拦截所有会员端 HTTP 请求
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { MEMBER_TOKEN_KEY, MEMBER_REFRESH_TOKEN_KEY } from '@arcbase/shared/core';
import { MemberAuthProvider, useMemberAuth } from './useMemberAuth';

const callOrder: string[] = [];

vi.mock('@/utils/tracker', () => ({
  prepareTrackerLogout: vi.fn(() => callOrder.push('prepareTrackerLogout')),
}));

vi.mock('../utils/member-request', () => ({
  memberRequest: {
    get: vi.fn().mockResolvedValue({ code: 0, message: 'success', data: { id: 1, nickname: '会员' } }),
    post: vi.fn().mockResolvedValue({ code: 0, message: 'success', data: null }),
  },
}));

import { prepareTrackerLogout } from '@/utils/tracker';

beforeEach(() => {
  localStorage.clear();
  callOrder.length = 0;
  vi.clearAllMocks();
});

describe('logout()', () => {
  it('先调用 prepareTrackerLogout，再清除 MEMBER token', async () => {
    localStorage.setItem(MEMBER_TOKEN_KEY, 'member-token');
    localStorage.setItem(MEMBER_REFRESH_TOKEN_KEY, 'member-refresh-token');

    const { result } = renderHook(() => useMemberAuth(), {
      wrapper: ({ children }) => <MemberAuthProvider>{children}</MemberAuthProvider>,
    });

    await waitFor(() => expect(result.current.loading).toBe(false));

    act(() => {
      result.current.logout();
    });

    expect(prepareTrackerLogout).toHaveBeenCalledTimes(1);
    expect(callOrder).toEqual(['prepareTrackerLogout']);
    expect(localStorage.getItem(MEMBER_TOKEN_KEY)).toBeNull();
    expect(localStorage.getItem(MEMBER_REFRESH_TOKEN_KEY)).toBeNull();
    expect(result.current.member).toBeNull();
  });
});
