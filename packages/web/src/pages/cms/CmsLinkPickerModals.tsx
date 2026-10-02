import { useMemo } from 'react';
import { Button, Modal, Tree } from '@douyinfe/semi-ui';
import type { ColumnProps } from '@douyinfe/semi-ui/lib/es/table';
import type { TreeNodeData } from '@douyinfe/semi-ui/lib/es/tree/interface';
import { Home } from 'lucide-react';
import { ConfigurableTable } from '@/components/ConfigurableTable';
import { listTableProps } from '@/components/list-page';
import { CMS_CONTENT_STATUS_LABELS } from '@zenith/shared/cms';
import type { CmsChannel, CmsContentListItem } from '@zenith/shared/cms';
import { cmsContentKeys, useAllCmsSites, useCmsChannelTree, useCmsContentList } from '@/hooks/queries/cms';
import { useIsMobile } from '@/hooks/useMediaQuery';
import { useListSearch } from '@/hooks/useListSearch';
import { ResetButton, SearchButton } from '@/components/toolbar-controls';
import { KeywordInput } from '@/components/search-filters';
import { dateTimeColumn } from '@/utils/table-columns';
import { usePinyinReady } from '@/hooks/usePinyinReady';
import { textMatches } from '@/utils/pinyin';
import { channelsToTree } from './channel-tree';
import { useFilterQuery } from '@/hooks/useFilterQuery';

interface ContentPickerSearchParams {
  keyword: string;
  channelId?: number;
}

const defaultContentPickerSearch: ContentPickerSearchParams = { keyword: '', channelId: undefined };

/** 内容选择弹窗：左侧栏目树定位，右侧按关键词检索本站内容 */
export function ContentPickerModal({ siteId, visible, onCancel, onSelect, excludeId }: Readonly<{
  siteId: number | undefined;
  visible: boolean;
  onCancel: () => void;
  onSelect: (content: CmsContentListItem) => void;
  excludeId?: number;
}>) {
  // 选择器弹窗固定 10 条 / 页；关键词经「查询」提交，点栏目树则立即应用（applySearch）
  const {
    page, pageSize, buildPagination,
    draftParams, bindKeyword, submittedParams, applySearch,
    handleSearch, handleReset,
  } = useListSearch<ContentPickerSearchParams>({ defaults: defaultContentPickerSearch, listKey: cmsContentKeys.lists, pageSize: 10 });
  const isMobile = useIsMobile();
  const enabled = visible && siteId !== undefined;
  const filterQuery = useFilterQuery({
    keyword: submittedParams.keyword,
    channelId: submittedParams.channelId,
  });
  const listQuery = useCmsContentList(
    { page, pageSize, siteId: siteId ?? 0, ...filterQuery, status: 'published' },
    enabled,
  );
  const rows = (listQuery.data?.list ?? []).filter((c) => c.id !== excludeId);

  const treeQuery = useCmsChannelTree(enabled ? siteId : undefined);
  const sitesQuery = useAllCmsSites();
  const siteName = sitesQuery.data?.find((s) => s.id === siteId)?.name ?? '全部栏目';
  const treeData: TreeNodeData[] = useMemo(() => [{
    key: 'all',
    label: siteName,
    icon: <Home size={14} style={{ marginRight: 4 }} />,
    children: channelsToTree(treeQuery.data ?? []),
  }], [siteName, treeQuery.data]);

  const columns: ColumnProps<CmsContentListItem>[] = [
    { title: '标题', dataIndex: 'title', ellipsis: true },
    {
      title: '状态', dataIndex: 'status', width: 80,
      render: (v: CmsContentListItem['status']) => CMS_CONTENT_STATUS_LABELS[v],
    },
    dateTimeColumn('发布时间', 'publishedAt'),
    {
      title: '操作', width: 68, fixed: 'right',
      render: (_: unknown, record: CmsContentListItem) => (
        <Button theme="borderless" size="small" onClick={() => onSelect(record)}>选择</Button>
      ),
    },
  ];

  return (
    <Modal title="选择内容" visible={visible} onCancel={onCancel} footer={null} width={900} closeOnEsc>
      <div style={{
        display: 'flex',
        flexDirection: isMobile ? 'column' : 'row',
        gap: isMobile ? 12 : 16,
        height: isMobile ? 'auto' : 480,
      }}>
        <div
          style={{
            width: isMobile ? '100%' : 220,
            flexShrink: 0,
            maxHeight: isMobile ? 180 : undefined,
            display: 'flex',
            flexDirection: 'column',
            overflow: 'hidden',
            paddingRight: isMobile ? 0 : 12,
            paddingBottom: isMobile ? 12 : 0,
            borderRight: isMobile ? undefined : '1px solid var(--semi-color-border)',
            borderBottom: isMobile ? '1px solid var(--semi-color-border)' : undefined,
          }}
        >
          <Tree
            treeData={treeData}
            value={submittedParams.channelId ? String(submittedParams.channelId) : 'all'}
            filterTreeNode
            showFilteredOnly
            searchPlaceholder="输入栏目名称"
            defaultExpandAll
            onSelect={(key) => applySearch({ ...draftParams, channelId: key === 'all' ? undefined : Number(key) })}
            style={{ flex: 1, width: '100%', overflow: 'auto' }}
          />
        </div>
        <div style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
            {/* 弹窗内的搜索框跟随剩余宽度自适应 */}
            <KeywordInput placeholder="输入内容标题" {...bindKeyword('keyword')} width="auto" style={{ flex: 1, minWidth: 160 }} />
            <SearchButton onClick={handleSearch} />
            <ResetButton onClick={handleReset} />
          </div>
          {/* 数据源按 excludeId 过滤后覆盖；选择器固定页大小，不显示切换 */}
          <ConfigurableTable
            columnSettingsKey="cms-link-content-picker"
            columns={columns}
            {...listTableProps(listQuery, { bordered: false })}
            dataSource={rows}
            scroll={{ y: isMobile ? 240 : 336 }}
            pagination={{ ...buildPagination(listQuery.data?.total ?? 0), showSizeChanger: false }}
          />
        </div>
      </div>
    </Modal>
  );
}

/** 栏目选择弹窗 */
export function ChannelPickerModal({ siteId, visible, onCancel, onSelect, excludeId }: Readonly<{
  siteId: number | undefined;
  visible: boolean;
  onCancel: () => void;
  onSelect: (channel: CmsChannel) => void;
  excludeId?: number;
}>) {
  const treeQuery = useCmsChannelTree(siteId);
  const treeData = useMemo(() => channelsToTree(treeQuery.data ?? []), [treeQuery.data]);
  const channelById = useMemo(() => {
    const map = new Map<number, CmsChannel>();
    const walk = (nodes: CmsChannel[]) => {
      for (const n of nodes) {
        map.set(n.id, n);
        if (n.children) walk(n.children);
      }
    };
    walk(treeQuery.data ?? []);
    return map;
  }, [treeQuery.data]);
  // 拼音词典就绪后重渲染，补上已输入关键字的拼音命中
  usePinyinReady();

  return (
    <Modal title="选择栏目" visible={visible} onCancel={onCancel} footer={null} width={480} closeOnEsc>
      <Tree
        treeData={treeData}
        filterTreeNode={(input, _node, data) => textMatches(
          String((data as { label?: unknown } | undefined)?.label ?? ''),
          String(input),
        )}
        searchPlaceholder="搜索栏目"
        style={{ maxHeight: 420, overflow: 'auto' }}
        onSelect={(key) => {
          const id = Number(key);
          const channel = channelById.get(id);
          if (channel && id !== excludeId) onSelect(channel);
        }}
      />
    </Modal>
  );
}
