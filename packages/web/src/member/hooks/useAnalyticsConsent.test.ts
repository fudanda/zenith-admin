/**
 * useAnalyticsConsent 单元测试
 *
 * 覆盖要点：
 *  1. 初始（无历史记录）状态为 unknown，hasMemberAnalyticsConsent() 为 false
 *  2. accept() 持久化为 accepted，且 hasMemberAnalyticsConsent() 变为 true
 *  3. reject() 持久化为 rejected
 *  4. 版本不匹配的历史记录被视为 unknown（强制重新征求同意）
 *  5. 保存时间使用项目 formatDateTimeForApi 格式（YYYY-MM-DD HH:mm:ss），而非 toISOString
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { MEMBER_ANALYTICS_CONSENT_KEY, MEMBER_ANALYTICS_CONSENT_VERSION } from '@arcbase/shared/member';
import { useAnalyticsConsent, hasMemberAnalyticsConsent } from './useAnalyticsConsent';

beforeEach(() => {
  localStorage.clear();
});

describe('初始状态', () => {
  it('无历史记录时状态为 unknown，hasMemberAnalyticsConsent 为 false', () => {
    const { result } = renderHook(() => useAnalyticsConsent());
    expect(result.current.status).toBe('unknown');
    expect(hasMemberAnalyticsConsent()).toBe(false);
  });
});

describe('accept() / reject()', () => {
  it('accept() 后状态变为 accepted 并持久化', () => {
    const { result } = renderHook(() => useAnalyticsConsent());

    act(() => result.current.accept());

    expect(result.current.status).toBe('accepted');
    expect(hasMemberAnalyticsConsent()).toBe(true);

    const stored = JSON.parse(localStorage.getItem(MEMBER_ANALYTICS_CONSENT_KEY)!);
    expect(stored.status).toBe('accepted');
    expect(stored.version).toBe(MEMBER_ANALYTICS_CONSENT_VERSION);
    // 保存时间必须使用项目 dayjs 格式（YYYY-MM-DD HH:mm:ss），不能是 ISO 字符串
    expect(stored.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/);
  });

  it('reject() 后状态变为 rejected，hasMemberAnalyticsConsent 仍为 false', () => {
    const { result } = renderHook(() => useAnalyticsConsent());

    act(() => result.current.reject());

    expect(result.current.status).toBe('rejected');
    expect(hasMemberAnalyticsConsent()).toBe(false);
  });
});

describe('版本兼容', () => {
  it('历史记录版本号与当前不一致时视为 unknown（强制重新征求同意）', () => {
    localStorage.setItem(
      MEMBER_ANALYTICS_CONSENT_KEY,
      JSON.stringify({ status: 'accepted', version: MEMBER_ANALYTICS_CONSENT_VERSION - 1, updatedAt: '2020-01-01 00:00:00' }),
    );

    const { result } = renderHook(() => useAnalyticsConsent());

    expect(result.current.status).toBe('unknown');
    expect(hasMemberAnalyticsConsent()).toBe(false);
  });
});
