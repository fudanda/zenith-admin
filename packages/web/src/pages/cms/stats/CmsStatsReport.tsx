import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Banner, Button, Select, Toast, Typography } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import { Download } from 'lucide-react';
import { cmsStatContract, type CmsStatMetrics, type CmsStatReportRow } from '@arcbase/shared/cms';
import ConfigurableTable from '@/components/ConfigurableTable';
import { KeywordInput } from '@/components/search-filters';
import { ListSearchToolbar, listTableProps } from '@/components/list-page';
import { createOperationColumn } from '@/components/ResponsiveTableActions';
import { useListSearch } from '@/hooks/useListSearch';
import { useFilterQuery } from '@/hooks/useFilterQuery';
import { usePermission } from '@/hooks/usePermission';
import { api } from '@/lib/contract-query';
import { useCmsStatsReport, cmsStatKeys, type CmsStatsQuery, type CmsStatsReportQuery } from '@/hooks/queries/cms-stats';
import { useCreateCmsEditorialTask } from '@/hooks/queries/cms-operations';
import { downloadBlob } from '@/utils/download';
import { renderEllipsis } from '@/utils/table-columns';
import { useCmsTaskEditor } from '../CmsEditorialTasks';
import { cmsStatsCsv, cmsStatsDimensionLabel, DIMENSION_LABELS, METRIC_LABELS, displayCmsMetric, type CmsStatsDimension } from './cms-stats-presentation';

interface ReportFilters { keyword?: string; sortBy: NonNullable<CmsStatsReportQuery['sortBy']>; sortOrder: 'asc' | 'desc' }
const STANDARD_COLUMNS: (keyof CmsStatMetrics)[] = ['pv', 'uv', 'sessions', 'reads', 'readRate', 'avgActiveMs', 'engagementRate', 'conversions', 'conversionRate'];
const SEARCH_COLUMNS: (keyof CmsStatMetrics)[] = ['searches', 'uv', 'noResultSearches', 'searchClicks', 'searchClickRate', 'reads', 'conversions'];
const MEDIA_COLUMNS: (keyof CmsStatMetrics)[] = ['uv', 'mediaStarts', 'media25', 'media50', 'media75', 'mediaCompletions', 'mediaErrors', 'downloadClicks', 'downloads'];
const PLACEMENT_COLUMNS: (keyof CmsStatMetrics)[] = ['impressions', 'clicks', 'ctr', 'uv', 'conversions'];
const FORM_COLUMNS: (keyof CmsStatMetrics)[] = ['uv', 'formStarts', 'formErrors', 'formCompletions'];
const INTERACTION_COLUMNS: (keyof CmsStatMetrics)[] = ['uv', 'votes', 'comments', 'follows', 'conversions'];

export default function CmsStatsReport({ query: scopeQuery, dimension, onDrill }: Readonly<{
  query: CmsStatsQuery; dimension: CmsStatsDimension; onDrill?: (dimension: CmsStatsDimension, key: string) => void;
}>) {
  const columnsToShow = dimension === 'search' ? SEARCH_COLUMNS : dimension === 'media' ? MEDIA_COLUMNS : dimension === 'placement' ? PLACEMENT_COLUMNS : dimension === 'form' ? FORM_COLUMNS : dimension === 'interaction' ? INTERACTION_COLUMNS : STANDARD_COLUMNS;
  const defaultSort = dimension === 'search' ? 'searches' : dimension === 'media' ? 'mediaStarts' : dimension === 'placement' ? 'impressions' : ['form', 'interaction'].includes(dimension) ? 'conversions' : 'pv';
  const { watermark: _watermark, ...scopeFilters } = scopeQuery;
  const search = useListSearch<ReportFilters>({ defaults: { sortBy: defaultSort, sortOrder: 'desc' }, listKey: cmsStatKeys.report, resetKey: JSON.stringify(scopeFilters) });
  const reportQuery = useFilterQuery({ ...scopeQuery, ...search.submittedParams, dimension });
  const report = useCmsStatsReport({ ...reportQuery, siteId: scopeQuery.siteId, page: search.page, pageSize: search.pageSize });
  const [exporting, setExporting] = useState(false);
  const { hasPermission } = usePermission();
  const createTask = useCreateCmsEditorialTask();
  const editor = useCmsTaskEditor(scopeQuery.siteId);
  const sortFields: NonNullable<CmsStatsReportQuery['sortBy']>[] = ['pv', 'uv', 'sessions', 'reads', 'activeMs', 'conversions', 'searches', 'noResultSearches', 'searchClicks', 'downloads', 'impressions', 'clicks', 'mediaStarts', 'mediaErrors'];
  /** 指标列宽跟随标题长度：6 字及以上（搜索结果点击、区间访客 UV…）给 140，避免表头换行。 */
  const metricColumnWidth = (field: keyof CmsStatMetrics) => field === 'avgActiveMs' ? 160 : METRIC_LABELS[field].length >= 6 ? 140 : 115;
  const columns: ColumnProps<CmsStatReportRow>[] = [
    { title: DIMENSION_LABELS[dimension], dataIndex: 'label', minWidth: 220, render: (label: string, row) => dimension === 'content' && /^\d+$/u.test(row.key) ? <Link to={`/cms/contents/edit?id=${row.key}&siteId=${scopeQuery.siteId}`}>{label}</Link> : renderEllipsis(cmsStatsDimensionLabel(dimension, row.key, label)) },
    ...columnsToShow.map((field): ColumnProps<CmsStatReportRow> => ({ title: METRIC_LABELS[field], dataIndex: field, width: metricColumnWidth(field), align: 'right', render: (_value: number, row) => displayCmsMetric(row, field) })),
  ];
  const drillable = ['content', 'channel', 'author', 'contentType', 'release', 'source', 'device'].includes(dimension);
  if (drillable || dimension === 'search') columns.push(createOperationColumn<CmsStatReportRow>({ width: dimension === 'search' ? 150 : 110, desktopInlineKeys: ['drill', 'task'], actions: (row) => {
    if (dimension === 'search') return row.noResultSearches > 0 && hasPermission('cms:editorial-task:manage') ? [{ key: 'task', label: '转为编辑事项', disabled: createTask.isPending, onClick: async () => {
      const task = await createTask.mutateAsync({ body: { siteId: scopeQuery.siteId, title: `补充内容：${row.label}`, description: `读者搜索“${row.label}”出现 ${row.noResultSearches} 次无结果。`, source: 'search', sourceKeyword: row.label } });
      Toast.success('已打开对应编辑事项'); editor.openEdit(task);
    } }] : [];
    return onDrill && row.key !== 'unknown' && row.key !== '' ? [{ key: 'drill', label: '按此项筛选', onClick: () => onDrill(dimension, row.key) }] : [];
  } }));
  async function exportReport() {
    if (exporting) return;
    setExporting(true);
    try {
      const rows: (string | number)[][] = [[DIMENSION_LABELS[dimension], ...columnsToShow.map((field) => METRIC_LABELS[field])]];
      let page = 1; let total = 0;
      do {
        const data = await api(cmsStatContract.report, { query: { ...reportQuery, siteId: scopeQuery.siteId, page, pageSize: 100 } });
        total = data.total;
        rows.push(...data.list.map((row) => [cmsStatsDimensionLabel(dimension, row.key, row.label), ...columnsToShow.map((field) => displayCmsMetric(row, field))]));
        if (!data.list.length) break;
        page += 1;
      } while (rows.length - 1 < total);
      downloadBlob(new Blob([cmsStatsCsv(rows)], { type: 'text/csv;charset=utf-8' }), `访问统计-${DIMENSION_LABELS[dimension]}.csv`);
      Toast.success(`已导出 ${rows.length - 1} 条统计记录`);
    } catch {
      // 请求层已展示错误；未完成的导出不下载部分文件。
    } finally { setExporting(false); }
  }
  return <>
    <ListSearchToolbar onSearch={search.handleSearch} onReset={search.handleReset}
      keyword={<KeywordInput {...search.bindKeyword('keyword')} placeholder={`搜索${DIMENSION_LABELS[dimension]}名称`} />}
      filters={<><Select aria-label="排序指标" {...search.bind('sortBy', (value: unknown) => value as ReportFilters['sortBy'])} optionList={sortFields.map((value) => ({ value, label: `按${METRIC_LABELS[value]}` }))} /><Select aria-label="排序方向" {...search.bind('sortOrder', (value: unknown) => value as ReportFilters['sortOrder'])} optionList={[{ value: 'desc', label: '从高到低' }, { value: 'asc', label: '从低到高' }]} /></>}
      actions={<Button icon={<Download size={14} />} loading={exporting} disabled={!report.data?.total || report.isError} onClick={() => void exportReport()}>导出全部结果</Button>} />
    {report.isError ? <Banner type="danger" description={`排行查询失败：${report.error.message}${report.data ? '。下方保留上次成功结果。' : ''}`} /> : null}
    {['search', 'media', 'placement', 'form', 'interaction'].includes(dimension) ? <Typography.Paragraph type="tertiary">此维度的 UV 是发生对应行为的访客数；详情浏览和搜索、媒体、版位行为分别计量，不将点击等同于服务端成功。</Typography.Paragraph> : null}
    <ConfigurableTable columnSettingsKey={`cms-statistics-${dimension}`} columns={columns} {...listTableProps(report, { rowKey: 'key', pagination: search.buildPagination, empty: report.isError ? '查询失败，请刷新重试' : '当前筛选下暂无对应事件' })} />
    {editor.editor}
  </>;
}
