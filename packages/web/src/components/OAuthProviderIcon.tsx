import type { OAuthProviderType } from '@arcbase/shared/identity';
import { MonoIcon } from '@/components/icons/MonoIcon';
import { MONO_ICONS } from '@/components/icons/generated/mono-icons';

/**
 * 各提供方的品牌图标（构建期从 @iconify-json 集合内联，见 scripts/gen-iconify-assets.mjs）：
 * 登录页在关键路径上，不能在运行时向公网 Iconify API 拉图标数据。
 * 钉钉 / 企业微信的字形在视框内偏小，放大一档与其他图标视觉等重。文案统一取 shared 的 OAUTH_PROVIDER_LABELS
 */
const ICONS: Record<OAuthProviderType, { icon: keyof typeof MONO_ICONS; scale?: number }> = {
  github: { icon: 'simple-icons:github' },
  dingtalk: { icon: 'ant-design:dingtalk-outlined', scale: 1.1 },
  wechat_work: { icon: 'ant-design:wechat-work-filled', scale: 1.1 },
  feishu: { icon: 'icon-park-outline:lark' },
};

export function OAuthProviderIcon({ provider, size = 16 }: Readonly<{ provider: OAuthProviderType; size?: number }>) {
  const { icon, scale = 1 } = ICONS[provider];
  return <MonoIcon icon={MONO_ICONS[icon]} size={Math.round(size * scale)} />;
}
