import dayjs from 'dayjs';
import utc from 'dayjs/plugin/utc.js';
import timezone from 'dayjs/plugin/timezone.js';
import { HTTPException } from 'hono/http-exception';
import type { QueryOutputOf } from '@arcbase/shared/core';
import { cmsStatContract, isCmsStatTimeZone, type CmsStatScope } from '@arcbase/shared/cms';

dayjs.extend(utc); dayjs.extend(timezone);
export type CmsStatsQuery = QueryOutputOf<typeof cmsStatContract.overview>;
export function resolveCmsStatsWindow(q: CmsStatsQuery, now = new Date()): CmsStatScope {
  if (q.watermark) {
    const point = new Date(q.watermark);
    if (!Number.isFinite(point.getTime()) || point > now) throw new HTTPException(400, { message: '统计快照时间必须是有效的过去时间' });
    now = point;
  }
  const zone = q.timeZone;
  if (!isCmsStatTimeZone(zone)) throw new HTTPException(400, { message: '请选择有效的 IANA 时区' });
  const localToday = dayjs(now).tz(zone).format('YYYY-MM-DD');
  const shift = (date: string, days: number) => dayjs.utc(date).add(days, 'day').format('YYYY-MM-DD');
  const parse = (value: string, end: boolean): Date => {
    const parsed = dayjs.tz(value, zone);
    const format = value.length === 10 ? 'YYYY-MM-DD' : 'YYYY-MM-DD HH:mm:ss';
    if (!parsed.isValid() || parsed.format(format) !== value) throw new HTTPException(400, { message: '统计日期无效' });
    return end && value.length === 10 ? dayjs.tz(shift(value, 1), zone).toDate() : parsed.toDate();
  };
  if (Boolean(q.startTime) !== Boolean(q.endTime)) throw new HTTPException(400, { message: '请同时选择统计开始和结束日期' });
  const start = q.startTime ? parse(q.startTime, false) : parse(shift(localToday, 1 - q.days), false);
  const requestedEnd = q.endTime ? parse(q.endTime, true) : now;
  const end = new Date(Math.min(requestedEnd.getTime(), now.getTime()));
  const duration = end.getTime() - start.getTime();
  if (duration <= 0 || duration > 91 * 86400000) throw new HTTPException(400, { message: '请选择不超过 90 天且已经开始的有效统计区间' });
  const localDays = dayjs.utc(dayjs(end).tz(zone).format('YYYY-MM-DD')).diff(dayjs.utc(dayjs(start).tz(zone).format('YYYY-MM-DD')), 'day');
  if (localDays > 90) throw new HTTPException(400, { message: '统计区间不能超过 90 天' });
  let comparisonStart: Date | null = null; let comparisonEnd: Date | null = null;
  if (q.compare === 'previous_period') { comparisonStart = new Date(start.getTime() - duration); comparisonEnd = start; }
  if (q.compare === 'previous_year') {
    comparisonStart = dayjs.tz(dayjs(start).tz(zone).subtract(1, 'year').format('YYYY-MM-DD HH:mm:ss'), zone).toDate();
    comparisonEnd = dayjs.tz(dayjs(end).tz(zone).subtract(1, 'year').format('YYYY-MM-DD HH:mm:ss'), zone).toDate();
  }
  return { startTime: start.toISOString(), endTime: end.toISOString(), timeZone: zone, granularity: q.granularity ?? 'day', comparisonStart: comparisonStart?.toISOString() ?? null, comparisonEnd: comparisonEnd?.toISOString() ?? null, watermark: now.toISOString() };
}
