import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LoggerAdapterContext } from '@mastra/core/logger';

/**
 * ArcBaseMastraLogger:Mastra → 系统 pino 适配器(官方 AdaptableLogger 规范)。
 * 断言三条独立路径:原生写入(无条件)、trace 关联(correlation)、观测导出(export)。
 */

const childCalls: Array<{ level: string; merge: Record<string, unknown>; message: string }> = [];

vi.mock('../logger', () => {
  const record = (level: string) => (merge: Record<string, unknown>, message: string) => {
    childCalls.push({ level, merge, message });
  };
  return {
    default: {
      child: vi.fn(() => ({
        debug: record('debug'),
        info: record('info'),
        warn: record('warn'),
        error: record('error'),
      })),
    },
  };
});

const { ArcBaseMastraLogger } = await import('./logger');

interface SinkCall { level: string; message: string; data: Record<string, unknown> | undefined }

function makeCtx(opts: { correlation: boolean; export: boolean }, sinkCalls: SinkCall[]): LoggerAdapterContext {
  const entry = (level: string) => (message: string, data?: Record<string, unknown>) => {
    sinkCalls.push({ level, message, data });
  };
  return {
    resolveTraceFields: () => ({ trace_id: 'trace-1', span_id: 'span-1' }),
    getLogSink: () => ({ debug: entry('debug'), info: entry('info'), warn: entry('warn'), error: entry('error') }),
    options: opts,
  };
}

beforeEach(() => {
  childCalls.length = 0;
});

describe('ArcBaseMastraLogger', () => {
  it('未接入观测上下文时仍原生写入系统 logger(无 trace 字段、不导出)', () => {
    const logger = new ArcBaseMastraLogger();
    logger.info('hello', { foo: 1 });
    expect(childCalls).toEqual([{ level: 'info', merge: { foo: 1 }, message: 'hello' }]);
  });

  it('correlation 开启时注入 trace_id/span_id,且 per-call 字段覆盖语义保留', () => {
    const sinkCalls: SinkCall[] = [];
    const logger = new ArcBaseMastraLogger();
    logger.__attachObservability(makeCtx({ correlation: true, export: false }, sinkCalls));
    logger.warn('careful', { foo: 'bar' });
    expect(childCalls[0]).toEqual({
      level: 'warn',
      merge: { trace_id: 'trace-1', span_id: 'span-1', foo: 'bar' },
      message: 'careful',
    });
    expect(sinkCalls).toHaveLength(0); // export 关闭:不写观测
  });

  it('export 开启时同一条记录写观测 sink;correlation 关闭时原生无 trace 字段', () => {
    const sinkCalls: SinkCall[] = [];
    const logger = new ArcBaseMastraLogger();
    logger.__attachObservability(makeCtx({ correlation: false, export: true }, sinkCalls));
    logger.debug('probe', { step: 'x' });
    expect(childCalls[0]).toEqual({ level: 'debug', merge: { step: 'x' }, message: 'probe' });
    expect(sinkCalls).toEqual([{ level: 'debug', message: 'probe', data: { step: 'x' } }]);
  });

  it('Error 实参记入 err 键(走系统 err 序列化器)', () => {
    const logger = new ArcBaseMastraLogger();
    const boom = new Error('boom');
    logger.error('failed', boom);
    expect(childCalls[0].merge.err).toBe(boom);
  });

  it('观测 sink 抛错不影响原生日志路径', () => {
    const logger = new ArcBaseMastraLogger();
    const ctx = makeCtx({ correlation: false, export: true }, []);
    ctx.getLogSink = () => {
      throw new Error('sink down');
    };
    logger.__attachObservability(ctx);
    expect(() => logger.info('still fine')).not.toThrow();
    expect(childCalls).toHaveLength(1);
  });
});
