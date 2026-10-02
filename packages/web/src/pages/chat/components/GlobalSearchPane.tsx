import { Button, Empty, Input, Spin, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Search } from 'lucide-react';
import { chatContract } from '@arcbase/shared/chat';
import type { ChatMessageSearchItem } from '@arcbase/shared/chat';
import { api } from '@/lib/contract-query';
import { formatConvTime } from '@/utils/date';
import type { Setter } from '../types';

const { Text } = Typography;

/** 左栏全局搜索面板：搜索框 + 结果列表 + 分页（自 ChatPage 原样搬移） */
export function GlobalSearchPane({
  leftPaneMode, globalSearchKeyword, setGlobalSearchKeyword, setGlobalSearchResults, setGlobalSearchTotal, setGlobalSearchHasSearched,
  setGlobalSearchLoading, globalSearchLoading, globalSearchHasSearched, globalSearchTotal, globalSearchResults, globalSearchPage,
  setGlobalSearchPage, globalSearchConvNames, setGlobalSearchConvNames, onOpenSearchResult,
}: Readonly<{
  leftPaneMode: 'conversations' | 'favorites' | 'globalSearch';
  globalSearchKeyword: string;
  setGlobalSearchKeyword: Setter<string>;
  setGlobalSearchResults: Setter<ChatMessageSearchItem[]>;
  setGlobalSearchTotal: Setter<number>;
  setGlobalSearchHasSearched: Setter<boolean>;
  setGlobalSearchLoading: Setter<boolean>;
  globalSearchLoading: boolean;
  globalSearchHasSearched: boolean;
  globalSearchTotal: number;
  globalSearchResults: ChatMessageSearchItem[];
  globalSearchPage: number;
  setGlobalSearchPage: Setter<number>;
  globalSearchConvNames: Record<string, string>;
  setGlobalSearchConvNames: Setter<Record<string, string>>;
  onOpenSearchResult: (item: ChatMessageSearchItem) => Promise<void>;
}>) {
  return (
    <>
            {leftPaneMode === 'globalSearch' && (
              <div style={{ padding: '8px 12px 0' }}>
                <Input
                  prefix={<Search size={13} />}
                  placeholder="搜索全部消息内容"
                  size="small"
                  value={globalSearchKeyword}
                  onChange={(v) => {
                    setGlobalSearchKeyword(v);
                    if (!v.trim()) {
                      setGlobalSearchResults([]);
                      setGlobalSearchTotal(0);
                      setGlobalSearchHasSearched(false);
                    }
                  }}
                  onEnterPress={async () => {
                    const kw = globalSearchKeyword.trim();
                    if (!kw) return;
                    setGlobalSearchLoading(true);
                    const result = await api(chatContract.globalSearch, { query: { keyword: kw, page: 1, pageSize: 20 } }, { silent: true }).catch(() => null);
                    setGlobalSearchLoading(false);
                    if (result) {
                      setGlobalSearchResults(result.list);
                      setGlobalSearchTotal(result.total);
                      setGlobalSearchPage(1);
                      setGlobalSearchConvNames(result.conversationNames);
                      setGlobalSearchHasSearched(true);
                    }
                  }}
                  showClear
                />
                {globalSearchHasSearched && (
                  <Text type="tertiary" style={{ display: 'block', fontSize: 11, padding: '6px 0 2px' }}>
                    共 {globalSearchTotal} 条结果
                  </Text>
                )}
              </div>
            )}
            {leftPaneMode === 'globalSearch' && globalSearchLoading && (
              <div style={{ display: 'flex', justifyContent: 'center', padding: 20 }}>
                <Spin />
              </div>
            )}
              {leftPaneMode === 'globalSearch' && globalSearchHasSearched && !globalSearchLoading && (
                <SemiList
                  dataSource={globalSearchResults}
                  emptyContent={<Empty description="未找到相关消息" style={{ padding: '30px 0' }} imageStyle={{ width: 60 }} />}
                  split={false}
                  renderItem={(item: ChatMessageSearchItem) => {
                    const convName = globalSearchConvNames[String(item.message.conversationId)] ?? '会话';
                    return (
                      <SemiList.Item
                        key={item.message.id}
                        onClick={() => { void onOpenSearchResult(item); }}
                        style={{ padding: '8px 12px', cursor: 'pointer' }}
                        onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.background = 'var(--semi-color-fill-0)'; }}
                        onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.background = 'transparent'; }}
                        main={(
                          <div style={{ minWidth: 0, width: '100%' }}>
                            <div style={{ display: 'flex', justifyContent: 'space-between', gap: 8, marginBottom: 2 }}>
                              <Text strong style={{ fontSize: 12, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{convName}</Text>
                              <Text type="tertiary" style={{ fontSize: 11, flexShrink: 0 }}>{formatConvTime(item.message.createdAt)}</Text>
                            </div>
                            {item.message.senderName && (
                              <Text type="secondary" style={{ display: 'block', fontSize: 11, marginBottom: 2 }}>{item.message.senderName}</Text>
                            )}
                            <Text type="tertiary" style={{ display: 'block', fontSize: 12, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                              {item.snippet}
                            </Text>
                          </div>
                        )}
                      />
                    );
                  }}
                />
              )}
            {leftPaneMode === 'globalSearch' && globalSearchHasSearched && !globalSearchLoading
              && globalSearchResults.length < globalSearchTotal && (
              <div style={{ padding: '8px 12px', textAlign: 'center' }}>
                <Button
                  size="small"
                  theme="borderless"
                  type="tertiary"
                  loading={globalSearchLoading}
                  onClick={async () => {
                    const kw = globalSearchKeyword.trim();
                    if (!kw) return;
                    const nextPage = globalSearchPage + 1;
                    setGlobalSearchLoading(true);
                    const result = await api(chatContract.globalSearch, { query: { keyword: kw, page: nextPage, pageSize: 20 } }, { silent: true }).catch(() => null);
                    setGlobalSearchLoading(false);
                    if (result) {
                      setGlobalSearchResults((prev) => [...prev, ...result.list]);
                      setGlobalSearchPage(nextPage);
                      setGlobalSearchConvNames((prev) => ({ ...prev, ...result.conversationNames }));
                    }
                  }}
                >
                  加载更多
                </Button>
              </div>
            )}
    </>
  );
}
