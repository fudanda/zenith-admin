import { describe, expect, it } from 'vitest';
import { installScopedStorage, scopedStorageKey } from './storage';

describe('deployment storage lifetime', () => {
  it('keeps deployment isolation and restores the host only after the final lease', () => {
    const native = window.localStorage;
    native.setItem('host-data', 'keep');
    const standalone = installScopedStorage();
    const embedded = installScopedStorage();
    expect(window.localStorage).not.toBe(native);
    expect(window.localStorage.getItem('host-data')).toBeNull();
    window.localStorage.setItem('preference', 'dark');
    expect(native.getItem(scopedStorageKey('preference'))).toBe('dark');
    embedded();
    embedded();
    expect(window.localStorage.getItem('preference')).toBe('dark');
    window.localStorage.clear();
    expect(native.getItem('host-data')).toBe('keep');
    standalone();
    expect(window.localStorage).toBe(native);
    expect(native.getItem('host-data')).toBe('keep');
    native.clear();
  });
});
