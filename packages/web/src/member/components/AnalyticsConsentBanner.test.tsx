/**
 * AnalyticsConsentBanner 单元测试
 *
 * 覆盖要点：
 *  1. 同意状态为 unknown 时展示提示条，含文案与两个操作按钮
 *  2. 点击「同意」后状态持久化为 accepted，提示条随之消失
 *  3. 点击「暂不同意」后状态持久化为 rejected，提示条随之消失
 *  4. 已存在同意/拒绝记录时不展示提示条
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MEMBER_ANALYTICS_CONSENT_KEY, MEMBER_ANALYTICS_CONSENT_VERSION } from '@arcbase/shared/member';
import { AnalyticsConsentBanner } from './AnalyticsConsentBanner';
import { hasMemberAnalyticsConsent } from '../hooks/useAnalyticsConsent';

beforeEach(() => {
  localStorage.clear();
  cleanup();
});

describe('未表态时', () => {
  it('展示提示条与接受/拒绝按钮', () => {
    render(<AnalyticsConsentBanner />);

    expect(screen.getByRole('region', { name: '体验分析同意提示' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '同意体验分析采集' })).toBeTruthy();
    expect(screen.getByRole('button', { name: '拒绝体验分析采集' })).toBeTruthy();
  });

  it('点击「同意」后持久化为 accepted 并隐藏提示条', async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsentBanner />);

    await user.click(screen.getByRole('button', { name: '同意体验分析采集' }));

    expect(hasMemberAnalyticsConsent()).toBe(true);
    expect(screen.queryByRole('region', { name: '体验分析同意提示' })).toBeNull();
  });

  it('点击「暂不同意」后持久化为 rejected 并隐藏提示条', async () => {
    const user = userEvent.setup();
    render(<AnalyticsConsentBanner />);

    await user.click(screen.getByRole('button', { name: '拒绝体验分析采集' }));

    expect(hasMemberAnalyticsConsent()).toBe(false);
    expect(screen.queryByRole('region', { name: '体验分析同意提示' })).toBeNull();
  });
});

describe('已表态时', () => {
  it('已有同意记录时不展示提示条', () => {
    localStorage.setItem(
      MEMBER_ANALYTICS_CONSENT_KEY,
      JSON.stringify({ status: 'accepted', version: MEMBER_ANALYTICS_CONSENT_VERSION, updatedAt: '2024-01-01 00:00:00' }),
    );

    render(<AnalyticsConsentBanner />);

    expect(screen.queryByRole('region', { name: '体验分析同意提示' })).toBeNull();
    expect(screen.getByRole('button', { name: '修改体验分析设置' })).toBeTruthy();
  });

  it('允许已同意用户重新打开设置并撤回同意', async () => {
    localStorage.setItem(
      MEMBER_ANALYTICS_CONSENT_KEY,
      JSON.stringify({ status: 'accepted', version: MEMBER_ANALYTICS_CONSENT_VERSION, updatedAt: '2024-01-01 00:00:00' }),
    );
    const user = userEvent.setup();
    render(<AnalyticsConsentBanner />);

    await user.click(screen.getByRole('button', { name: '修改体验分析设置' }));
    await user.click(screen.getByRole('button', { name: '拒绝体验分析采集' }));

    expect(hasMemberAnalyticsConsent()).toBe(false);
  });
});
