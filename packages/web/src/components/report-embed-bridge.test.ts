import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { REPORT_EMBED_BRIDGE_CHANNEL, REPORT_EMBED_BRIDGE_VERSION } from '@arcbase/shared/report';
import type { ReportEmbedCommandName, ReportEmbedFilterValues } from '@arcbase/shared/report';
import { attachReportEmbedBridge, type ReportEmbedBridgeHandlers } from './report-embed-bridge';

const HOST_ORIGIN = 'https://host.example';

function command(commandName: ReportEmbedCommandName, payload?: unknown, requestId = 'req-1') {
  return {
    channel: REPORT_EMBED_BRIDGE_CHANNEL,
    version: REPORT_EMBED_BRIDGE_VERSION,
    type: 'command',
    command: commandName,
    requestId,
    ...(payload === undefined ? {} : { payload }),
  };
}

function dispatch(data: unknown, origin = HOST_ORIGIN, source: MessageEventSource | null = window.parent) {
  window.dispatchEvent(new MessageEvent('message', { data, origin, source }));
}

function handlers(overrides: Partial<ReportEmbedBridgeHandlers> = {}): ReportEmbedBridgeHandlers {
  return {
    getFilterIds: () => ['region'],
    getReadOnly: () => false,
    setFilter: vi.fn(),
    setFilters: vi.fn(),
    resetFilters: vi.fn(),
    refresh: vi.fn(),
    getState: () => ({
      loaded: true,
      loading: false,
      readOnly: false,
      filterValues: { region: 'east' },
    }),
    exportPng: vi.fn().mockResolvedValue('data:image/png;base64,safe'),
    ...overrides,
  };
}

describe('report embed postMessage bridge', () => {
  let postMessage: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    postMessage = vi.spyOn(window.parent, 'postMessage').mockImplementation(() => undefined);
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('accepts a versioned command only from the parent and replies to the validated request origin', () => {
    const bridgeHandlers = handlers();
    const cleanup = attachReportEmbedBridge({ allowedOrigins: [HOST_ORIGIN], handlers: bridgeHandlers });

    dispatch(command('setFilter', { filterId: 'region', value: 'west' }));

    expect(bridgeHandlers.setFilter).toHaveBeenCalledWith('region', 'west');
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'event', event: 'stateSnapshot', requestId: 'req-1' }),
      HOST_ORIGIN,
    );
    cleanup();
  });

  it('ignores non-parent sources and origins outside the exact allowlist', () => {
    const bridgeHandlers = handlers();
    const cleanup = attachReportEmbedBridge({ allowedOrigins: [HOST_ORIGIN], handlers: bridgeHandlers });

    dispatch(command('refresh'), HOST_ORIGIN, null);
    dispatch(command('refresh'), 'https://evil.example');

    expect(bridgeHandlers.refresh).not.toHaveBeenCalled();
    expect(postMessage).not.toHaveBeenCalled();
    cleanup();
  });

  it('rejects unknown filter ids, nested values, oversized shapes and read-only mutations', async () => {
    const setFilters = vi.fn<(values: ReportEmbedFilterValues) => void>();
    const bridgeHandlers = handlers({ setFilters });
    const cleanupWritable = attachReportEmbedBridge({ allowedOrigins: [HOST_ORIGIN], handlers: bridgeHandlers });

    dispatch(command('setFilters', { filters: { secret: 'x' } }, 'bad-id'));
    dispatch(command('setFilters', { filters: { region: { rawRow: 'forbidden' } } }, 'bad-shape'));
    dispatch({
      ...command('refresh', undefined, 'large'),
      padding: 'x'.repeat(70_000),
    });

    expect(setFilters).not.toHaveBeenCalled();
    await vi.waitFor(() => {
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'error', requestId: 'bad-id' }),
        HOST_ORIGIN,
      );
      expect(postMessage).toHaveBeenCalledWith(
        expect.objectContaining({ event: 'error', requestId: 'bad-shape' }),
        HOST_ORIGIN,
      );
    });
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'error', requestId: 'large' }),
      HOST_ORIGIN,
    );
    cleanupWritable();

    postMessage.mockClear();
    const readOnlyHandlers = handlers({ getReadOnly: () => true });
    const cleanupReadOnly = attachReportEmbedBridge({ allowedOrigins: [HOST_ORIGIN], handlers: readOnlyHandlers });
    dispatch(command('setFilter', { filterId: 'region', value: 'west' }, 'readonly'));

    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'error', requestId: 'readonly' }),
      HOST_ORIGIN,
    );
    expect(readOnlyHandlers.setFilter).not.toHaveBeenCalled();
    cleanupReadOnly();
  });

  it('correlates export/state responses and removes its listener during cleanup', async () => {
    const bridgeHandlers = handlers();
    const cleanup = attachReportEmbedBridge({ allowedOrigins: [HOST_ORIGIN], handlers: bridgeHandlers });

    dispatch(command('exportPng', undefined, 'export-7'));
    await vi.waitFor(() => expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'exportReady', requestId: 'export-7' }),
      HOST_ORIGIN,
    ));

    postMessage.mockClear();
    cleanup();
    dispatch(command('getState', undefined, 'after-cleanup'));
    expect(postMessage).not.toHaveBeenCalled();
  });
});
