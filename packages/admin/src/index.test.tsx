import { cleanup, render } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { Client } from '@arcbase/client';
import { ArcBaseAdmin } from './index';
import type { ArcBaseAdminProps } from './index';

const { host } = vi.hoisted(() => ({ host: vi.fn<(props: ArcBaseAdminProps) => null>(() => null) }));
vi.mock('@arcbase/web/admin', () => ({ ArcBaseAdmin: host }));
afterEach(() => { cleanup(); host.mockClear(); });

describe('public ArcBaseAdmin entry', () => {
  it('passes the supplied client, route and resource paths to the original app', () => {
    const client = new Client();
    render(<ArcBaseAdmin client={client} basePath="/console" assetBasePath="/arcbase-assets/" />);
    expect(host.mock.calls[0]?.[0]).toMatchObject({ client, basePath: '/console', assetBasePath: '/arcbase-assets/' });
  });
});
