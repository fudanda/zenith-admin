import { describe, expect, it } from 'vitest';
import { normalizeAdminBasePath, normalizeAssetBasePath, validateAdminOptions } from './runtime';

describe('admin paths', () => {
  it('normalizes local route basenames and independently hosted static assets', () => {
    expect(normalizeAdminBasePath('/console/')).toBe('/console');
    expect(normalizeAdminBasePath('/')).toBe('/');
    expect(normalizeAssetBasePath('https://static.example/zenith')).toBe('https://static.example/zenith/');
  });
  it('rejects external routes, traversal, ambiguous slashes and unsafe asset URLs', () => {
    for (const path of ['https://example.com', '//evil', '/dash/../', '/dash?x=1', '/dash//x', '/%2f']) expect(() => normalizeAdminBasePath(path)).toThrow();
    for (const path of ['javascript:alert(1)', 'https://u:p@example.com/', '/assets?token=secret', '/assets#part']) expect(() => normalizeAssetBasePath(path)).toThrow();
  });
  it('rejects unsafe branding links and unsupported host choices', () => {
    expect(() => validateAdminOptions({ brand: { loginImage: '/brand/login.png', icpUrl: 'https://example.com' }, theme: 'system', locale: 'en-US' })).not.toThrow();
    for (const url of ['javascript:alert(1)', 'data:text/html,secret', 'https://u:p@example.com']) expect(() => validateAdminOptions({ brand: { loginImage: url } })).toThrow();
  });
});
