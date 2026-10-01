import { useEffect, type ReactNode } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { subscribe } from '@zenith/client';
import { useZenith, useSession } from '@zenith/elements';
import { useAdminOptions } from '@/admin/runtime';

/** A stream only invalidates cache; refreshed queries retain their server scope. */
export function RealtimeBridge({ children }: { children: ReactNode }) {
  const { client } = useZenith();
  const { session, status, refresh } = useSession();
  const queries = useQueryClient();
  const { authSession } = useAdminOptions();
  const userId = status === 'authenticated' ? session?.user.id : undefined;
  useEffect(() => {
    if (!userId) return;
    const stream = subscribe(client, {
      onChange: ({ resources }) => {
        void queries.invalidateQueries();
        // Owned sessions observe /me in Query; controlled host sessions need
        // their own refresh when grants or policy change, including reconnect.
        if (authSession && (resources.length === 0 || resources.includes('*'))) void refresh();
      },
      onUnauthorized: () => { void refresh(); },
    });
    return () => stream.close();
  }, [client, queries, userId, refresh, authSession]);
  return children;
}
