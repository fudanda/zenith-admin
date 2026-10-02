/** Explicit migration entry: original ArcBase pages, served by the Go API. */
export const IS_GO_FOUNDATION = import.meta.env.VITE_GO_FOUNDATION === 'true';

export const foundationPagePaths: ReadonlySet<string> = new Set(connectedFoundationPages.map((page) => page.path));

export function isPageAvailable(path: string): boolean {
  return !IS_GO_FOUNDATION || foundationPagePaths.has(path);
}
import { connectedFoundationPages } from '@arcbase/shared/foundation';
