import { describe, expect, it } from 'vitest';
import { normalizeAdminBasePath, normalizeAssetBasePath, validateAdminOptions } from './runtime';
import { hostMenus } from './modules';

describe('admin paths', () => {
  it('keeps host paths isolated and removes menus immediately when permissions are revoked', () => {
    const module = { id: 'business', title: 'Business', pages: [{ id: 'positions', title: 'Positions', path: '/extensions/business/positions', permission: 'system:position:list', component: () => null }] };
    expect(() => validateAdminOptions({ modules: [module] })).not.toThrow();
    expect(hostMenus([module], []).length).toBe(0);
    const menus = hostMenus([module], ['system:position:list']);
    expect(menus[0].id).toBeLessThan(0);
    expect(menus[0].children?.[0].path).toBe(module.pages[0].path);
    for (const path of ['/system/users', '/extensions/other/positions', '/extensions/business/../users', '/extensions/business/file.js']) expect(() => validateAdminOptions({ modules: [{ ...module, pages: [{ ...module.pages[0], path }] }] })).toThrow();
    expect(() => validateAdminOptions({ modules: [module, module] })).toThrow();
  });
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
