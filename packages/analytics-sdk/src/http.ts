import { ANALYTICS_SITE_KEY_HEADER } from '@arcbase/shared/analytics';

export function analyticsRequestHeaders(input: {
  token: string | null;
  siteKey?: string;
  includeJson?: boolean;
}): Record<string, string> {
  return {
    ...(input.includeJson === false ? {} : { 'Content-Type': 'application/json' }),
    ...(input.token ? { Authorization: ['Bearer', input.token].join(' ') } : {}),
    ...(input.siteKey ? { [ANALYTICS_SITE_KEY_HEADER]: input.siteKey } : {}),
  };
}
