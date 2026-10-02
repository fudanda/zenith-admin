import { describe, expect, it } from 'vitest';
import { cmsStatsQuery } from '@arcbase/shared/cms';
import { resolveCmsStatsWindow } from './cms-stats-window';

const scope = (values: Record<string, unknown>, now='2026-09-28T10:00:00Z') => resolveCmsStatsWindow(cmsStatsQuery.parse({ siteId: 1,...values }),new Date(now));
describe('CMS reporting calendar and time-zone boundaries',()=>{
  it('turns local inclusive dates into exact half-open UTC instants',()=>{
    expect(scope({startTime:'2026-09-27',endTime:'2026-09-27'})).toMatchObject({startTime:'2026-09-26T16:00:00.000Z',endTime:'2026-09-27T16:00:00.000Z',timeZone:'Asia/Shanghai'});
  });
  it('honors daylight saving transitions without assuming every day is 24 hours',()=>{
    const spring=scope({startTime:'2026-03-08',endTime:'2026-03-08',timeZone:'America/New_York'});
    expect(spring).toMatchObject({startTime:'2026-03-08T05:00:00.000Z',endTime:'2026-03-09T04:00:00.000Z'});
    expect(Date.parse(spring.endTime)-Date.parse(spring.startTime)).toBe(23*3600000);
  });
  it('keeps range endpoints and the previous-period duration explicit',()=>{
    const row=scope({startTime:'2026-09-26',endTime:'2026-09-27'});
    expect(row.comparisonEnd).toBe(row.startTime);
    expect(Date.parse(row.startTime)-Date.parse(row.comparisonStart!)).toBe(Date.parse(row.endTime)-Date.parse(row.startTime));
  });
  it('rejects invalid dates, partial ranges, future-only ranges and invalid zones',()=>{
    expect(()=>scope({startTime:'2026-02-30',endTime:'2026-03-01'})).toThrow('统计日期无效');
    expect(()=>scope({startTime:'2026-09-20'})).toThrow('同时选择');
    expect(()=>scope({startTime:'2027-01-01',endTime:'2027-01-02'})).toThrow('有效统计区间');
    expect(()=>scope({timeZone:'not/a-zone'})).toThrow();
  });
  it('does not invent a previous period when comparison is disabled',()=>{
    expect(scope({compare:'none'})).toMatchObject({comparisonStart:null,comparisonEnd:null});
  });
  it('pins the reporting endpoint to the snapshot and rejects a future watermark',()=>{
    expect(scope({days:1,watermark:'2026-09-28T08:00:00Z'})).toMatchObject({endTime:'2026-09-28T08:00:00.000Z',watermark:'2026-09-28T08:00:00.000Z'});
    expect(()=>scope({watermark:'2026-09-28T11:00:00Z'})).toThrow('过去时间');
  });
});
