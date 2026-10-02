import type { ReportWidgetType } from './types';

export const REPORT_EMBED_BRIDGE_CHANNEL = 'arcbase.report.embed' as const;
export const REPORT_EMBED_BRIDGE_VERSION = '1.0' as const;
export const REPORT_EMBED_BRIDGE_MAX_MESSAGE_BYTES = 64 * 1024;

export const REPORT_EMBED_COMMANDS = [
  'setFilter',
  'setFilters',
  'resetFilters',
  'refresh',
  'getState',
  'exportPng',
] as const;

export const REPORT_EMBED_EVENTS = [
  'loaded',
  'error',
  'filterChanged',
  'widgetClicked',
  'drilldown',
  'exportReady',
  'stateSnapshot',
] as const;

export type ReportEmbedCommandName = typeof REPORT_EMBED_COMMANDS[number];
export type ReportEmbedEventName = typeof REPORT_EMBED_EVENTS[number];

export type ReportEmbedFilterValue = string | number | boolean | null | Array<string | number | boolean | null>;
export type ReportEmbedFilterValues = Record<string, ReportEmbedFilterValue | undefined>;

export interface ReportEmbedState {
  dashboardId?: number;
  dashboardName?: string;
  loaded: boolean;
  loading: boolean;
  error?: string | null;
  readOnly: boolean;
  filterValues: ReportEmbedFilterValues;
}

export interface ReportEmbedFilterChangePayload {
  filterId?: string;
  value?: ReportEmbedFilterValue;
  filterValues: ReportEmbedFilterValues;
}

export interface ReportEmbedSelectedValue {
  field?: string;
  value: ReportEmbedFilterValue;
}

export interface ReportEmbedWidgetClickPayload {
  widgetId: string;
  widgetTitle: string;
  widgetType: ReportWidgetType;
  selected?: ReportEmbedSelectedValue;
}

export interface ReportEmbedDrilldownPayload extends ReportEmbedWidgetClickPayload {
  drilldownType: 'fields' | 'dashboard' | 'url';
  targetDashboardId?: number;
  paramName?: string;
}

export interface ReportEmbedCommand {
  channel: typeof REPORT_EMBED_BRIDGE_CHANNEL;
  version: typeof REPORT_EMBED_BRIDGE_VERSION;
  type: 'command';
  command: ReportEmbedCommandName;
  requestId?: string;
  payload?: unknown;
}

export interface ReportEmbedEvent<T = unknown> {
  channel: typeof REPORT_EMBED_BRIDGE_CHANNEL;
  version: typeof REPORT_EMBED_BRIDGE_VERSION;
  type: 'event';
  event: ReportEmbedEventName;
  requestId?: string;
  payload?: T;
}
