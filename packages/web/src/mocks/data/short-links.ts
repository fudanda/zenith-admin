import { SEED_SHORT_LINKS } from '@arcbase/shared/seed';
import type { ShortLink } from '@arcbase/shared/short-link';
import { nextIdFrom } from '@/mocks/utils/handlers';

export const mockShortLinks: ShortLink[] = SEED_SHORT_LINKS.map((link, idx) => ({
  ...link,
  // Demo 模式给出可信的访问量与短链地址（相对当前站点，复制可用）
  shortUrl: `${window.location.origin}/s/${link.code}`,
  totalPv: [1286, 342, 57][idx] ?? 0,
}));

let nextShortLinkId = nextIdFrom(mockShortLinks);
export function getNextShortLinkId(): number {
  return nextShortLinkId++;
}
