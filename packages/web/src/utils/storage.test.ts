import { describe, expect, it } from 'vitest';
import { installScopedStorage, scopedStorageKey } from './storage';
import { config } from '@/config';

describe('deployment storage lifetime', () => {
  it('migrates legacy preferences while preserving new values, host data and other deployments', () => {
    const native = window.localStorage;
    const old = `zenith:${config.deploymentId}:`;
    native.setItem(`${old}theme`, 'dark');
    native.setItem(`${old}language`, 'old');
    native.setItem(scopedStorageKey('language'), 'new');
    native.setItem('zenith:another-deployment:theme', 'keep');
    const release = installScopedStorage();
    try {
      expect(window.localStorage.getItem('theme')).toBe('dark');
      expect(window.localStorage.getItem('language')).toBe('new');
      expect(native.getItem(`${old}theme`)).toBeNull();
      expect(scopedStorageKey(`${old}theme`)).toBe(scopedStorageKey('theme'));
      window.localStorage.clear();
      expect(native.getItem('zenith:another-deployment:theme')).toBe('keep');
    } finally { release(); native.clear(); }
  });
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
