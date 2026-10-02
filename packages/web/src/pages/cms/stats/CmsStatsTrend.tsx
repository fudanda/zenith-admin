import { memo, useMemo } from 'react';
import type { CmsStatOverview } from '@arcbase/shared/cms';
import { LineChart, chartOptions, makeLineSpec, useChartPalette } from '@/components/charts';

export default memo(function CmsStatsTrend({ data }: Readonly<{ data: CmsStatOverview['trend'] }>) {
  const palette = useChartPalette();
  const spec = useMemo(() => makeLineSpec({ data, xField: 'date', palette, series: [
    { field: 'pv', name: '浏览量 PV' }, { field: 'uv', name: '访客 UV' }, { field: 'sessions', name: '会话' }, { field: 'reads', name: '有效阅读' }, { field: 'conversions', name: '成功转化' },
  ] }), [data, palette]);
  return <LineChart {...spec} options={chartOptions} height={280} />;
});
