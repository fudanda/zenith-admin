/**
 * MemberAnalyticsBridge 单元测试
 *
 * 覆盖要点：
 *  1. 路由标题映射正确传给 usePageTracker，且 enabled 与同意状态一致（accepted 才为 true）
 *  2. 未知路径回退使用 pathname 本身作为标题
 *  3. 已登录会员触发 identifyMember（携带 id + 展示名回退链）
 *  4. 未登录（member 为 null）触发 resetIdentity
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import type { Member } from '@arcbase/shared/member';

const usePageTrackerMock = vi.fn();
vi.mock('@/hooks/usePageTracker', () => ({
  usePageTracker: (...args: unknown[]) => usePageTrackerMock(...args),
}));

const identifyMemberMock = vi.fn();
const resetIdentityMock = vi.fn();
vi.mock('@/utils/tracker', () => ({
  identifyMember: (...args: unknown[]) => identifyMemberMock(...args),
  resetIdentity: (...args: unknown[]) => resetIdentityMock(...args),
}));

const useMemberAuthMock = vi.fn();
vi.mock('../hooks/useMemberAuth', () => ({
  useMemberAuth: () => useMemberAuthMock(),
}));

const useAnalyticsConsentMock = vi.fn();
vi.mock('../hooks/useAnalyticsConsent', () => ({
  useAnalyticsConsent: () => useAnalyticsConsentMock(),
}));

import { MemberAnalyticsBridge } from './MemberAnalyticsBridge';

function makeMember(overrides: Partial<Member> = {}): Member {
  return {
    id: 1,
    nickname: '会员昵称',
    username: 'member1',
    status: 'active',
    createdAt: '2024-01-01 00:00:00',
    updatedAt: '2024-01-01 00:00:00',
    ...overrides,
  } as Member;
}

beforeEach(() => {
  vi.clearAllMocks();
  useMemberAuthMock.mockReturnValue({ member: null });
  useAnalyticsConsentMock.mockReturnValue({ status: 'unknown' });
});

describe('页面浏览采集', () => {
  it('已知路由映射标题，且仅 accepted 时 enabled 为 true', () => {
    useAnalyticsConsentMock.mockReturnValue({ status: 'accepted' });

    render(
      <MemoryRouter initialEntries={['/points']}>
        <MemberAnalyticsBridge />
      </MemoryRouter>,
    );

    expect(usePageTrackerMock).toHaveBeenCalledWith('会员中心-积分', true);
  });

  it('未接受同意时 enabled 为 false', () => {
    useAnalyticsConsentMock.mockReturnValue({ status: 'rejected' });

    render(
      <MemoryRouter initialEntries={['/wallet']}>
        <MemberAnalyticsBridge />
      </MemoryRouter>,
    );

    expect(usePageTrackerMock).toHaveBeenCalledWith('会员中心-钱包', false);
  });

  it('未知路径回退使用 pathname 本身作为标题', () => {
    useAnalyticsConsentMock.mockReturnValue({ status: 'accepted' });

    render(
      <MemoryRouter initialEntries={['/unknown-route']}>
        <MemberAnalyticsBridge />
      </MemoryRouter>,
    );

    expect(usePageTrackerMock).toHaveBeenCalledWith('/unknown-route', true);
  });
});

describe('身份关联', () => {
  it('已登录会员触发 identifyMember，展示名回退到 username', () => {
    useMemberAuthMock.mockReturnValue({ member: makeMember({ nickname: '', username: 'fallback-name' }) });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <MemberAnalyticsBridge />
      </MemoryRouter>,
    );

    expect(identifyMemberMock).toHaveBeenCalledWith(1, 'fallback-name');
    expect(resetIdentityMock).not.toHaveBeenCalled();
  });

  it('已登录会员优先使用 nickname 作为展示名', () => {
    useMemberAuthMock.mockReturnValue({ member: makeMember({ nickname: '昵称优先' }) });

    render(
      <MemoryRouter initialEntries={['/home']}>
        <MemberAnalyticsBridge />
      </MemoryRouter>,
    );

    expect(identifyMemberMock).toHaveBeenCalledWith(1, '昵称优先');
  });

  it('未登录（member 为 null）触发 resetIdentity', () => {
    useMemberAuthMock.mockReturnValue({ member: null });

    render(
      <MemoryRouter initialEntries={['/']}>
        <MemberAnalyticsBridge />
      </MemoryRouter>,
    );

    expect(resetIdentityMock).toHaveBeenCalled();
    expect(identifyMemberMock).not.toHaveBeenCalled();
  });
});
