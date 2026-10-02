import { useState } from 'react';
import { Banner, Card, Select, Typography } from '@douyinfe/semi-ui';
import type { CmsStatOverview } from '@arcbase/shared/cms';
import { StatCard, StatGrid } from '@/components/charts/StatCard';
import type { CmsStatsQuery } from '@/hooks/queries/cms-stats';
import CmsStatsReport from './stats/CmsStatsReport';
import { DIMENSION_LABELS, displayCmsMetric, type CmsStatsDimension } from './stats/cms-stats-presentation';

export default function CmsAttributionPanel({ query, overview }: Readonly<{ query: CmsStatsQuery; overview: CmsStatOverview }>) {
  const [dimension, setDimension] = useState<CmsStatsDimension>('content');
  const metrics = overview.metrics;
  return <>
    <Banner type="info" description="成功转化以服务端已完成的表单、投票、评论和关注为准。内容归因采用同会话最近内容触点；没有有效触点的成功保留在站点总量中。下载交付与点击分别统计。" />
    <StatGrid>
      <StatCard title="成功转化" value={metrics.conversions} sub="按业务成功事件计数" />
      <StatCard title="转化访客 / 浏览访客" value={`${metrics.conversionVisitors} / ${metrics.uv}`} sub="分子属于当前区间浏览访客" />
      <StatCard title="访客转化率" value={displayCmsMetric(metrics, 'conversionRate')} sub="转化访客 ÷ 浏览访客" />
      <StatCard title="表单开始 / 成功 / 失败" value={`${metrics.formStarts} / ${metrics.formCompletions} / ${metrics.formErrors}`} sub="展示行为与服务端成功分开记录" />
      <StatCard title="投票 / 评论 / 关注成功" value={`${metrics.votes} / ${metrics.comments} / ${metrics.follows}`} />
      <StatCard title="下载点击 / 交付" value={`${metrics.downloadClicks} / ${metrics.downloads}`} />
      <StatCard title="媒体启播 / 完成 / 失败" value={`${metrics.mediaStarts} / ${metrics.mediaCompletions} / ${metrics.mediaErrors}`} />
      <StatCard title="曝光点击率" value={displayCmsMetric(metrics, 'ctr')} sub={`${metrics.clicks} 次点击 / ${metrics.impressions} 次曝光；按曝光实例去重`} />
    </StatGrid>
    <Card title="内容归因与互动表现" headerExtraContent={<Select aria-label="互动分析维度" value={dimension} onChange={(value) => setDimension(value as CmsStatsDimension)} optionList={(['content', 'form', 'interaction', 'media', 'placement'] as const).map((value) => ({ value, label: DIMENSION_LABELS[value] }))} />}>
      <Typography.Paragraph type="tertiary">不同目标的开始、失败与成功均单独展示；不把未经验证的点击相加成为转化。比率同时保留分子与分母供核验。</Typography.Paragraph>
      <CmsStatsReport key={dimension} query={query} dimension={dimension} />
    </Card>
  </>;
}
