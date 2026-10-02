import type { Permission } from '@arcbase/shared/core';

// Extend the typed registry in the defining module, without broadening all strings.
declare module '@arcbase/shared/core/permissions' {
  interface HostPermissionRegistry { 'host:position-host:create': true }
}
export const hostPermissions = { create: 'host:position-host:create' } as const satisfies Record<string, Permission>;
