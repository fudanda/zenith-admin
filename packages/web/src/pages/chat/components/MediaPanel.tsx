import { Button, Empty, Spin, Typography, List as SemiList } from '@douyinfe/semi-ui';
import { Download, Eye, X } from 'lucide-react';
import DateTimeText from '@/components/DateTimeText';
import { canPreviewFile, getFileTypeIcon } from '@/utils/file-utils';
import type { ChatMessage } from '@arcbase/shared/chat';
import type { Setter } from '../types';
import { openExternalUrl, safeHttpUrl, safeLinkUrl } from '@/utils/safe-url';
import { formatBytes } from '@arcbase/shared/core';

const { Text } = Typography;

/** 右侧媒体库面板：图片/文件/链接三类分页浏览（自 ChatPage 原样搬移） */
export function MediaPanel({
  setShowMediaPanel, mediaType, setMediaType, mediaLoading, mediaItems, openImagePreview,
  handleMediaFilePreview, activeConvId, fetchMediaItems, mediaPage, mediaHasMore,
}: Readonly<{
  setShowMediaPanel: Setter<boolean>;
  mediaType: 'image' | 'file' | 'link';
  setMediaType: Setter<'image' | 'file' | 'link'>;
  mediaLoading: boolean;
  mediaItems: ChatMessage[];
  openImagePreview: (clickedMsg: ChatMessage, allImgs: ChatMessage[]) => Promise<void>;
  handleMediaFilePreview: (item: ChatMessage) => void;
  activeConvId: number | null;
  fetchMediaItems: (convId: number, type: 'image' | 'file' | 'link', p?: number) => Promise<void>;
  mediaPage: number;
  mediaHasMore: boolean;
}>) {
  return (
              <div style={{ width: 320, borderLeft: '1px solid var(--semi-color-border)', display: 'flex', flexDirection: 'column', flexShrink: 0, background: 'var(--surface-card)' }}>
                <div style={{ padding: '12px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', alignItems: 'center', gap: 8 }}>
                  <Text strong style={{ flex: 1, fontSize: 13 }}>媒体文件</Text>
                  <Button size="small" theme="borderless" type="tertiary" icon={<X size={14} />} onClick={() => setShowMediaPanel(false)} />
                </div>
                <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--semi-color-border)', display: 'flex', gap: 8 }}>
                  <Button
                    size="small"
                    theme={mediaType === 'image' ? 'solid' : 'borderless'}
                    type={mediaType === 'image' ? 'primary' : 'tertiary'}
                    onClick={() => setMediaType('image')}
                  >
                    图片
                  </Button>
                  <Button
                    size="small"
                    theme={mediaType === 'file' ? 'solid' : 'borderless'}
                    type={mediaType === 'file' ? 'primary' : 'tertiary'}
                    onClick={() => setMediaType('file')}
                  >
                    文件
                  </Button>
                  <Button
                    size="small"
                    theme={mediaType === 'link' ? 'solid' : 'borderless'}
                    type={mediaType === 'link' ? 'primary' : 'tertiary'}
                    onClick={() => setMediaType('link')}
                  >
                    链接
                  </Button>
                </div>
                <div style={{ flex: 1, overflowY: 'auto', padding: 12 }}>
                  <Spin spinning={mediaLoading && mediaItems.length === 0}>
                    {mediaItems.length === 0 && !mediaLoading && (
                      <Empty description={{ image: '暂无图片消息', file: '暂无文件消息', link: '暂无链接消息' }[mediaType]} imageStyle={{ width: 64 }} style={{ paddingTop: 40 }} />
                    )}
                    {mediaType === 'image' && (
                      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4 }}>
                        {mediaItems.map((item) => (
                          <button
                            key={item.id}
                            type="button"
                            onClick={() => { void openImagePreview(item, mediaItems.filter((m) => m.type === 'image')); }}
                            style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', aspectRatio: '1', overflow: 'hidden', borderRadius: 'var(--semi-border-radius-small)' }}
                          >
                            <img
                              src={safeLinkUrl(item.extra?.asset?.thumbnailUrl ?? item.content)}
                              alt={item.extra?.asset?.name ?? '图片'}
                              style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                            />
                          </button>
                        ))}
                      </div>
                    )}
                    {mediaType === 'file' && (
                      <SemiList
                        split={false}
                        dataSource={mediaItems}
                        renderItem={(item) => {
                          const asset = item.extra?.asset;
                          return (
                            <SemiList.Item
                              key={item.id}
                              style={{ padding: '8px 10px', background: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', marginBottom: 8, overflow: 'hidden' }}
                            >
                              <div style={{ display: 'flex', alignItems: 'center', gap: 8, width: '100%', minWidth: 0 }}>
                                <span style={{ display: 'flex', flexShrink: 0 }}>{getFileTypeIcon(asset?.mimeType, 22, asset?.name)}</span>
                                <div style={{ flex: '1 1 0', minWidth: 0, overflow: 'hidden' }}>
                                  <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {asset?.name ?? '未知文件'}
                                  </Text>
                                  <Text type="tertiary" style={{ fontSize: 11 }}>
                                    {asset?.size ? formatBytes(asset.size) : ''}
                                  </Text>
                                </div>
                                <div style={{ display: 'flex', gap: 2, flexShrink: 0 }}>
                                  {canPreviewFile(asset?.mimeType, asset?.name) && (
                                    <Button
                                      size="small"
                                      theme="borderless"
                                      type="tertiary"
                                      icon={<Eye size={14} />}
                                      title="预览"
                                      onClick={() => { handleMediaFilePreview(item); }}
                                    />
                                  )}
                                  <Button
                                    size="small"
                                    theme="borderless"
                                    type="primary"
                                    icon={<Download size={14} />}
                                    title="下载"
                                    onClick={() => { openExternalUrl(item.content); }}
                                  />
                                </div>
                              </div>
                            </SemiList.Item>
                          );
                        }}
                      />
                    )}
                    {mediaType === 'link' && (
                      <SemiList
                        split={false}
                        dataSource={mediaItems}
                        renderItem={(item) => {
                          const preview = item.extra?.linkPreview;
                          const urlMatch = preview?.url ?? (/(https?:\/\/[^\s]+)/.exec(item.content)?.[1] ?? item.content);
                          return (
                            <SemiList.Item key={item.id} style={{ padding: 0, marginBottom: 8, border: 'none', overflow: 'hidden' }}>
                              <a
                                href={safeHttpUrl(urlMatch)}
                                target="_blank"
                                rel="noopener noreferrer"
                                style={{ display: 'flex', gap: 10, padding: '10px 12px', background: 'var(--semi-color-bg-2)', border: '1px solid var(--semi-color-border)', borderRadius: 'var(--semi-border-radius-medium)', textDecoration: 'none', color: 'inherit', alignItems: 'flex-start', width: '100%', boxSizing: 'border-box', overflow: 'hidden' }}
                              >
                                {preview?.image && (
                                  <img
                                    src={safeHttpUrl(preview.image)}
                                    alt=""
                                    style={{ width: 56, height: 56, objectFit: 'cover', borderRadius: 'var(--semi-border-radius-medium)', flexShrink: 0 }}
                                    onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                  />
                                )}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                  <Text strong style={{ fontSize: 12, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {preview?.title ?? urlMatch}
                                  </Text>
                                  <Text type="tertiary" style={{ fontSize: 11, display: 'block', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', marginTop: 2 }}>
                                    {urlMatch}
                                  </Text>
                                  <div style={{ display: 'flex', alignItems: 'center', gap: 4, marginTop: 4, flexWrap: 'wrap' }}>
                                    {preview?.favicon && (
                                      <img src={safeHttpUrl(preview.favicon)} alt="" style={{ width: 12, height: 12, borderRadius: 'var(--semi-border-radius-small)' }}
                                        onError={(e) => { e.currentTarget.style.display = 'none'; }}
                                      />
                                    )}
                                    <Text type="secondary" style={{ fontSize: 11 }}>{preview?.siteName ?? item.senderName}</Text>
                                    <Text type="tertiary" style={{ fontSize: 11, marginLeft: 'auto' }}><DateTimeText value={item.createdAt} /></Text>
                                  </div>
                                </div>
                              </a>
                            </SemiList.Item>
                          );
                        }}
                      />
                    )}
                    {mediaHasMore && (
                      <div style={{ textAlign: 'center', marginTop: 8 }}>
                        <Button
                          size="small"
                          type="tertiary"
                          theme="borderless"
                          loading={mediaLoading}
                          onClick={() => { if (activeConvId) void fetchMediaItems(activeConvId, mediaType, mediaPage + 1); }}
                        >
                          加载更多
                        </Button>
                      </div>
                    )}
                  </Spin>
                </div>
              </div>
  );
}
