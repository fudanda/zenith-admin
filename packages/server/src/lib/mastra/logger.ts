import { MastraLogger, buildLogRecordData, exportTrackedException } from '@mastra/core/logger';
import systemLogger from '../logger';
import type { LoggerAdapterContext } from '@mastra/core/logger';

/**
 * Mastra → 系统 pino 主日志的适配器(官方 AdaptableLogger 规范,@mastra/core ≥1.63):
 *
 * - 原生输出:全部转发系统 logger 的 child({ name: 'arcbase-ai' }),统一获得
 *   文件轮转(pino-roll)、NDJSON/pretty 控制台、log-metrics 告警计数与 reqId mixin;
 * - trace 关联:correlation 开启(默认)时把 Mastra AI trace 的 trace_id/span_id
 *   注入记录。per-call 字段覆盖 mixin 同名键 —— AI 链路内 Mastra 值优先于 OTel,
 *   与官方 PinoLogger「trace fields win on conflicts」行为一致,可与 Studio Traces 互查;
 * - observability 导出:export 开启(默认)时同一条记录经 getLogSink() 写观测存储
 *   (mastra_log_events,Studio /logs 数据源)。导出不受系统 pino level 过滤
 *   (适配器契约,与官方 PinoLogger 一致):控制台/文件按系统级别保持干净,
 *   观测存储由 observability logging.level 决定收多少。
 *
 * ⚠️ 顶层静态 import @mastra/core/logger(重依赖):本模块只能经 buildMastra
 * 惰性加载,禁止被启动路径静态引用。
 */

type Level = 'debug' | 'info' | 'warn' | 'error';

/** Mastra 的变参日志实参 → pino merge object(Error 记入 err 走系统序列化器) */
function toMergeObject(args: unknown[]): Record<string, unknown> {
  const merge: Record<string, unknown> = {};
  for (const a of args) {
    if (a instanceof Error) merge.err = a;
    else if (a && typeof a === 'object') Object.assign(merge, a);
    else if (a !== undefined) merge.meta = a;
  }
  return merge;
}

export class ArcBaseMastraLogger extends MastraLogger {
  #ctx?: LoggerAdapterContext;
  /** Mastra 日志的原生落点:系统主 logger 的领域子 logger */
  readonly #pino = systemLogger.child({ name: 'arcbase-ai' });

  constructor() {
    super({ name: 'arcbase-ai' });
  }

  /** 官方适配器钩子:Mastra 初始化时注入观测上下文(correlation/export 开关与 sink) */
  __attachObservability(ctx: LoggerAdapterContext): void {
    this.#ctx = ctx;
  }

  #log(level: Level, message: string, args: unknown[]): void {
    // 原生写入无条件执行(适配器契约:导出与否不影响本地落盘)
    const traceFields = this.#ctx?.options.correlation ? this.#ctx.resolveTraceFields() : undefined;
    this.#pino[level]({ ...traceFields, ...toMergeObject(args) }, message);
    if (this.#ctx?.options.export) {
      try {
        this.#ctx.getLogSink()?.[level](message, buildLogRecordData(args));
      } catch {
        // 观测侧故障不得影响业务日志路径
      }
    }
  }

  debug(message: string, ...args: unknown[]): void {
    this.#log('debug', message, args);
  }

  info(message: string, ...args: unknown[]): void {
    this.#log('info', message, args);
  }

  warn(message: string, ...args: unknown[]): void {
    this.#log('warn', message, args);
  }

  error(message: string, ...args: unknown[]): void {
    this.#log('error', message, args);
  }

  override trackException(error: Error, metadata?: Record<string, unknown>): void {
    exportTrackedException(this.#ctx, error, metadata);
  }
}
