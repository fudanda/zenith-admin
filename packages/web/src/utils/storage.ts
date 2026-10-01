import { config } from '@/config';

const STORAGE_PREFIX = 'zenith:';

/** Stable browser-storage namespace for this deployed derived project. */
export function scopedStorageKey(key: string): string {
  if (key.startsWith(`${STORAGE_PREFIX}${config.deploymentId}:`)) return key;
  return `${STORAGE_PREFIX}${config.deploymentId}:${key}`;
}

function isScopedKey(key: string): boolean {
  return key.startsWith(`${STORAGE_PREFIX}${config.deploymentId}:`);
}

/**
 * Make all first-party direct Storage API calls deployment-scoped.
 * The facade deliberately exposes only this deployment's keys to the app and
 * makes clear() safe: it cannot delete another derived project's data.
 */
function createScopedStorage(source: Storage): Storage {
  const scoped = (key: string) => scopedStorageKey(String(key));
  const ownKeys = () => {
    const keys: string[] = [];
    for (let i = 0; i < source.length; i += 1) {
      const key = source.key(i);
      if (key && isScopedKey(key)) keys.push(key);
    }
    return keys;
  };

  return {
    get length() { return ownKeys().length; },
    key(index: number): string | null {
      const key = ownKeys()[index];
      return key ? key.slice(`${STORAGE_PREFIX}${config.deploymentId}:`.length) : null;
    },
    getItem(key: string): string | null { return source.getItem(scoped(key)); },
    setItem(key: string, value: string): void { source.setItem(scoped(key), String(value)); },
    removeItem(key: string): void { source.removeItem(scoped(key)); },
    clear(): void { ownKeys().forEach((key) => source.removeItem(key)); },
  } as Storage;
}

let installed: { users: number; restore: () => void } | null = null;

/** Entrypoints retain a lease; an embedded admin releases its lease on unmount. */
export function installScopedStorage(): () => void {
  if (typeof window === 'undefined') return () => {};
  if (installed) {
    installed.users += 1;
    return storageLease(installed);
  }
  const localDescriptor = Object.getOwnPropertyDescriptor(window, 'localStorage');
  const sessionDescriptor = Object.getOwnPropertyDescriptor(window, 'sessionStorage');
  const restoreDescriptor = (key: 'localStorage' | 'sessionStorage', descriptor: PropertyDescriptor | undefined) => {
    try {
      if (descriptor) Object.defineProperty(window, key, descriptor);
      else Reflect.deleteProperty(window, key);
    } catch { /* Restricted WebViews may refuse descriptor replacement. */ }
  };
  try {
    const local = createScopedStorage(window.localStorage);
    const session = createScopedStorage(window.sessionStorage);
    Object.defineProperty(window, 'localStorage', { configurable: true, value: local });
    Object.defineProperty(window, 'sessionStorage', { configurable: true, value: session });
    installed = { users: 1, restore: () => {
      if (window.localStorage === local) restoreDescriptor('localStorage', localDescriptor);
      if (window.sessionStorage === session) restoreDescriptor('sessionStorage', sessionDescriptor);
    } };
    return storageLease(installed);
  } catch {
    restoreDescriptor('localStorage', localDescriptor);
    restoreDescriptor('sessionStorage', sessionDescriptor);
    // Private browsing / restricted WebViews may reject replacement; callers
    // already handle Storage errors and deployment-specific explicit keys still work.
    return () => {};
  }
}

function storageLease(state: NonNullable<typeof installed>): () => void {
  let released = false;
  return () => {
    if (released) return;
    released = true;
    state.users -= 1;
    if (state.users === 0 && installed === state) { state.restore(); installed = null; }
  };
}

export const storageNamespace = `${STORAGE_PREFIX}${config.deploymentId}`;
