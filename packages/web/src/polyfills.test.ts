/**
 * 非安全上下文 polyfill 契约：内网 http://ip 下浏览器不暴露 crypto.randomUUID，
 * 入口 polyfill 用 getRandomValues 组装的 v4 补齐，业务代码与第三方库继续调用标准 API。
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { randomUUID, uuidV4 } from '@arcbase/shared/core';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const nativeRandomUUID = Object.getOwnPropertyDescriptor(globalThis.crypto, 'randomUUID')
  ?? Object.getOwnPropertyDescriptor(Object.getPrototypeOf(globalThis.crypto), 'randomUUID');

afterEach(() => {
  Reflect.deleteProperty(globalThis.crypto, 'randomUUID');
  if (nativeRandomUUID) Object.defineProperty(globalThis.crypto, 'randomUUID', nativeRandomUUID);
  vi.resetModules();
});

describe('uuidV4 / randomUUID', () => {
  it('uuidV4 只依赖 getRandomValues，产出 RFC 4122 v4 且互不重复', () => {
    const ids = new Set(Array.from({ length: 200 }, uuidV4));
    expect(ids.size).toBe(200);
    for (const id of ids) expect(id).toMatch(UUID_V4);
  });

  it('randomUUID 在原生缺失时回退 uuidV4', () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    expect(randomUUID()).toMatch(UUID_V4);
  });
});

describe('polyfills', () => {
  it('crypto.randomUUID 缺失时安装到实例上，标准调用可用', async () => {
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: undefined, configurable: true });
    await import('./polyfills');
    expect(typeof globalThis.crypto.randomUUID).toBe('function');
    expect(globalThis.crypto.randomUUID()).toMatch(UUID_V4);
  });

  it('原生可用时不覆盖', async () => {
    const native = vi.fn(() => '00000000-0000-4000-8000-000000000000' as const);
    Object.defineProperty(globalThis.crypto, 'randomUUID', { value: native, configurable: true });
    await import('./polyfills');
    globalThis.crypto.randomUUID();
    expect(native).toHaveBeenCalledTimes(1);
  });
});
