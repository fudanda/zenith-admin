import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@zenith/client';
import { ZenithAdmin } from './index';
import type { ZenithAdminProps } from './index';

const { host } = vi.hoisted(() => ({ host: vi.fn<(props: ZenithAdminProps) => null>(() => null) }));
vi.mock('@zenith/web/admin', () => ({ ZenithAdmin: host }));
afterEach(() => { cleanup(); host.mockClear(); });

describe('public ZenithAdmin entry', () => {
  it('passes the supplied client, route and resource paths to the original app', () => {
    const client = new Client();
    render(<ZenithAdmin client={client} basePath="/console" assetBasePath="/zenith-assets/" />);
    expect(host.mock.calls[0]?.[0]).toMatchObject({ client, basePath: '/console', assetBasePath: '/zenith-assets/' });
  });
});
