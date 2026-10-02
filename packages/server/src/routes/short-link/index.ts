import { channelAnalysisContract, shortLinkContract } from '@arcbase/shared/short-link';
import { defineRouteDomain } from '../_kit';
import shortLinksRoutes from './short-links';
import redirectRoutes from './redirect';
import channelAnalysisRoutes from './channel-analysis';

export default defineRouteDomain({
  name: 'short-link',
  mounts: () => [
    [shortLinkContract.basePath, shortLinksRoutes],
    [channelAnalysisContract.basePath, channelAnalysisRoutes],
    // 公开跳转入口（非 JSON API，输出 30x / HTML，不进入契约）：mounts 先于所有域的 fallback（CMS 前台 SSR）注册，/s 前缀不会被吞掉
    ['/s', redirectRoutes],
  ],
});
