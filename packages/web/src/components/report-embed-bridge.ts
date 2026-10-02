import { useCallback, useEffect, useMemo, useRef } from 'react';
import { REPORT_EMBED_BRIDGE_CHANNEL, REPORT_EMBED_BRIDGE_MAX_MESSAGE_BYTES, REPORT_EMBED_BRIDGE_VERSION, REPORT_EMBED_COMMANDS } from '@arcbase/shared/report';
import type { ReportEmbedCommand, ReportEmbedEvent, ReportEmbedEventName, ReportEmbedFilterValue, ReportEmbedFilterValues, ReportEmbedState } from '@arcbase/shared/report';

const COMMANDS = new Set<string>(REPORT_EMBED_COMMANDS);
const MAX_FILTER_IDS = 100;
const MAX_FILTER_VALUE_LENGTH = 2048;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function serializedSize(value: unknown): number {
  try {
    return new TextEncoder().encode(JSON.stringify(value)).byteLength;
  } catch {
    return Number.POSITIVE_INFINITY;
  }
}

export function isReportEmbedFilterValue(value: unknown): value is ReportEmbedFilterValue {
  if (value === null || typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  if (typeof value === 'string') return value.length <= MAX_FILTER_VALUE_LENGTH;
  return Array.isArray(value)
    && value.length <= MAX_FILTER_IDS
    && value.every((item) => (
      item === null
      || typeof item === 'boolean'
      || (typeof item === 'number' && Number.isFinite(item))
      || (typeof item === 'string' && item.length <= MAX_FILTER_VALUE_LENGTH)
    ));
}

export function sanitizeReportEmbedFilterValues(
  values: Record<string, unknown>,
  allowedFilterIds?: ReadonlySet<string>,
): ReportEmbedFilterValues {
  const sanitized: ReportEmbedFilterValues = {};
  for (const [filterId, value] of Object.entries(values).slice(0, MAX_FILTER_IDS)) {
    if (allowedFilterIds && !allowedFilterIds.has(filterId)) continue;
    if (isReportEmbedFilterValue(value)) sanitized[filterId] = value;
  }
  return sanitized;
}

export function resolveReportEmbedAllowedOrigins(
  configured: readonly string[] | undefined,
  currentOrigin: string,
): string[] {
  const candidates = configured?.length ? configured : [currentOrigin];
  const origins = new Set<string>();
  for (const candidate of candidates) {
    if (!candidate || candidate === '*') continue;
    try {
      const url = new URL(candidate);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') continue;
      if (url.username || url.password || url.search || url.hash || (url.pathname && url.pathname !== '/')) continue;
      origins.add(url.origin);
    } catch {
      // Ignore malformed origins. An empty result disables the bridge.
    }
  }
  return [...origins];
}

export interface ReportEmbedBridgeHandlers {
  getFilterIds: () => readonly string[];
  getReadOnly: () => boolean;
  setFilter: (filterId: string, value: ReportEmbedFilterValue) => void;
  setFilters: (values: ReportEmbedFilterValues) => void;
  resetFilters: () => void;
  refresh: () => void | Promise<void>;
  getState: () => ReportEmbedState;
  exportPng: () => Promise<string | null>;
}

interface AttachReportEmbedBridgeOptions {
  allowedOrigins: readonly string[];
  handlers: ReportEmbedBridgeHandlers;
  targetWindow?: Window;
}

interface EmitReportEmbedEventOptions<T> {
  allowedOrigins: readonly string[];
  event: ReportEmbedEventName;
  payload?: T;
  requestId?: string;
  targetOrigin?: string;
  targetWindow?: Window;
}

export function postReportEmbedEvent<T>({
  allowedOrigins,
  event,
  payload,
  requestId,
  targetOrigin,
  targetWindow = window,
}: EmitReportEmbedEventOptions<T>): void {
  const origins = targetOrigin ? [targetOrigin] : allowedOrigins;
  const message: ReportEmbedEvent<T> = {
    channel: REPORT_EMBED_BRIDGE_CHANNEL,
    version: REPORT_EMBED_BRIDGE_VERSION,
    type: 'event',
    event,
    ...(requestId ? { requestId } : {}),
    ...(payload === undefined ? {} : { payload }),
  };
  for (const origin of new Set(origins)) {
    if (!allowedOrigins.includes(origin)) continue;
    targetWindow.parent.postMessage(message, origin);
  }
}

function parseCommand(value: unknown): { command?: ReportEmbedCommand; error?: string; requestId?: string } {
  if (!isRecord(value) || value.channel !== REPORT_EMBED_BRIDGE_CHANNEL || value.type !== 'command') return {};
  const requestId = typeof value.requestId === 'string' && value.requestId.length <= 128
    ? value.requestId
    : undefined;
  if (serializedSize(value) > REPORT_EMBED_BRIDGE_MAX_MESSAGE_BYTES) return { error: '消息体过大', requestId };
  const allowedKeys = new Set(['channel', 'version', 'type', 'command', 'requestId', 'payload']);
  if (Object.keys(value).some((key) => !allowedKeys.has(key))) return { error: '消息格式无效', requestId };
  if (value.version !== REPORT_EMBED_BRIDGE_VERSION) return { error: '不支持的协议版本', requestId };
  if (typeof value.command !== 'string' || !COMMANDS.has(value.command)) return { error: '不支持的命令', requestId };
  if (value.requestId !== undefined && !requestId) return { error: '请求标识无效' };
  return { command: value as unknown as ReportEmbedCommand, requestId };
}

function validateFilterId(filterId: unknown, allowedIds: ReadonlySet<string>): filterId is string {
  return typeof filterId === 'string'
    && filterId.length > 0
    && filterId.length <= 64
    && allowedIds.has(filterId);
}

function parseFilterValues(payload: unknown, allowedIds: ReadonlySet<string>): ReportEmbedFilterValues | null {
  if (!isRecord(payload) || !isRecord(payload.filters)) return null;
  const entries = Object.entries(payload.filters);
  if (entries.length > MAX_FILTER_IDS) return null;
  const values: ReportEmbedFilterValues = {};
  for (const [filterId, value] of entries) {
    if (!validateFilterId(filterId, allowedIds) || !isReportEmbedFilterValue(value)) return null;
    values[filterId] = value;
  }
  return values;
}

export function attachReportEmbedBridge({
  allowedOrigins,
  handlers,
  targetWindow = window,
}: AttachReportEmbedBridgeOptions): () => void {
  const allowedOriginSet = new Set(allowedOrigins);
  const emit = (event: ReportEmbedEventName, payload: unknown, requestId: string | undefined, origin: string) => {
    postReportEmbedEvent({ allowedOrigins, event, payload, requestId, targetOrigin: origin, targetWindow });
  };

  const onMessage = (messageEvent: MessageEvent) => {
    if (messageEvent.source !== targetWindow.parent || !allowedOriginSet.has(messageEvent.origin)) return;
    const parsed = parseCommand(messageEvent.data);
    if (!parsed.command) {
      if (parsed.error) emit('error', { message: parsed.error }, parsed.requestId, messageEvent.origin);
      return;
    }

    const { command, requestId } = parsed;
    const allowedIds = new Set(handlers.getFilterIds());
    const mutationBlocked = handlers.getReadOnly()
      && (command.command === 'setFilter' || command.command === 'setFilters' || command.command === 'resetFilters');
    if (mutationBlocked) {
      emit('error', { message: '当前嵌入为只读模式' }, requestId, messageEvent.origin);
      return;
    }

    const run = async () => {
      switch (command.command) {
        case 'setFilter': {
          if (!isRecord(command.payload)
            || Object.keys(command.payload).some((key) => key !== 'filterId' && key !== 'value')
            || !validateFilterId(command.payload.filterId, allowedIds)
            || !isReportEmbedFilterValue(command.payload.value)) {
            throw new Error('筛选命令无效');
          }
          handlers.setFilter(command.payload.filterId, command.payload.value);
          emit('stateSnapshot', handlers.getState(), requestId, messageEvent.origin);
          break;
        }
        case 'setFilters': {
          if (!isRecord(command.payload) || Object.keys(command.payload).some((key) => key !== 'filters')) {
            throw new Error('筛选命令无效');
          }
          const values = parseFilterValues(command.payload, allowedIds);
          if (!values) throw new Error('筛选命令无效');
          handlers.setFilters(values);
          emit('stateSnapshot', handlers.getState(), requestId, messageEvent.origin);
          break;
        }
        case 'resetFilters':
          if (command.payload !== undefined) throw new Error('命令格式无效');
          handlers.resetFilters();
          emit('stateSnapshot', handlers.getState(), requestId, messageEvent.origin);
          break;
        case 'refresh':
          if (command.payload !== undefined) throw new Error('命令格式无效');
          await handlers.refresh();
          emit('stateSnapshot', handlers.getState(), requestId, messageEvent.origin);
          break;
        case 'getState':
          if (command.payload !== undefined) throw new Error('命令格式无效');
          emit('stateSnapshot', handlers.getState(), requestId, messageEvent.origin);
          break;
        case 'exportPng': {
          if (command.payload !== undefined) throw new Error('命令格式无效');
          const dataUrl = await handlers.exportPng();
          emit('exportReady', { dataUrl }, requestId, messageEvent.origin);
          break;
        }
      }
    };
    void run().catch((error: unknown) => {
      emit('error', { message: error instanceof Error ? error.message : '命令执行失败' }, requestId, messageEvent.origin);
    });
  };

  targetWindow.addEventListener('message', onMessage);
  return () => targetWindow.removeEventListener('message', onMessage);
}

interface UseReportEmbedBridgeOptions extends ReportEmbedBridgeHandlers {
  allowedOrigins?: readonly string[];
}

export function useReportEmbedBridge(options: UseReportEmbedBridgeOptions) {
  const latest = useRef(options);
  latest.current = options;
  const originKey = JSON.stringify(options.allowedOrigins ?? []);
  const allowedOrigins = useMemo(
    () => resolveReportEmbedAllowedOrigins(options.allowedOrigins, window.location.origin),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable value key prevents array identity churn
    [originKey],
  );
  const allowedOriginsKey = JSON.stringify(allowedOrigins);

  useEffect(() => attachReportEmbedBridge({
    allowedOrigins,
    handlers: {
      getFilterIds: () => latest.current.getFilterIds(),
      getReadOnly: () => latest.current.getReadOnly(),
      setFilter: (filterId, value) => latest.current.setFilter(filterId, value),
      setFilters: (values) => latest.current.setFilters(values),
      resetFilters: () => latest.current.resetFilters(),
      refresh: () => latest.current.refresh(),
      getState: () => latest.current.getState(),
      exportPng: () => latest.current.exportPng(),
    },
  }), [allowedOrigins, allowedOriginsKey]);

  const emit = useCallback(<T,>(
    event: ReportEmbedEventName,
    payload?: T,
    requestId?: string,
    targetOrigin?: string,
  ) => {
    postReportEmbedEvent({ allowedOrigins, event, payload, requestId, targetOrigin });
  }, [allowedOrigins]);

  return useMemo(() => ({ allowedOrigins, emit }), [allowedOrigins, emit]);
}
