import { uuidV4 } from '@arcbase/shared/core';

// HTTP intranet hosts need the same equivalent platform fallback as standalone.
// Storage replacement is owned by the entrypoint / mounted admin lifetime.
if (globalThis.crypto && typeof globalThis.crypto.randomUUID !== 'function') {
  Object.defineProperty(globalThis.crypto, 'randomUUID', { value: uuidV4, configurable: true, writable: true });
}
