import { AsyncLocalStorage } from 'node:async_hooks';
import { cmsTelemetryPageContextSchema, type CmsTelemetryPageContext, type CmsTelemetryConfig } from '@arcbase/shared/cms';
import { createSignedTokenCodec } from '../../lib/signed-token';

const codec = createSignedTokenCodec<CmsTelemetryPageContext>({ purpose: 'cms-telemetry-v2-page' });
const environmentScope = new AsyncLocalStorage<'live' | 'preview'>();

export function withCmsTelemetryEnvironment<T>(environment: 'live' | 'preview', fn: () => Promise<T>): Promise<T> {
  return environmentScope.run(environment, fn);
}
export function cmsTelemetryEnvironment(): 'live' | 'preview' { return environmentScope.getStore() ?? 'live'; }
export function verifyCmsTelemetryPageToken(token: string): CmsTelemetryPageContext | null {
  const decoded = codec.decode(token);
  const result = cmsTelemetryPageContextSchema.safeParse(decoded);
  return result.success ? result.data : null;
}
export function signCmsTelemetryPage(page: CmsTelemetryPageContext): { contextToken: string; config: CmsTelemetryConfig } {
  const validated = cmsTelemetryPageContextSchema.parse(page);
  return { contextToken: codec.encode(validated), config: {
    siteId: page.siteId, environment: page.environment, canonicalPath: page.canonicalPath, pageType: page.pageType,
    ...(page.contentId ? { contentId: page.contentId } : {}), ...(page.search ? { search: page.search } : {}),
  } };
}
