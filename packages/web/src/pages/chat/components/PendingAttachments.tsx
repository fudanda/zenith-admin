import { Button } from '@douyinfe/semi-ui';
import { X } from 'lucide-react';
import { getFileTypeIcon } from '@/utils/file-utils';
import type { PendingFile, PendingImage, Setter } from '../types';
import { formatBytes } from '@arcbase/shared/core';

/** 待发送附件条：图片缩略图 + 文件卡片（自 ChatPage 原样搬移） */
export function PendingAttachments({
  pendingImages, pendingFiles, setPreviewSrcList, setPreviewCurrentIndex, setPreviewVisible, handleRemovePendingImage,
  handleRemovePendingFile,
}: Readonly<{
  pendingImages: PendingImage[];
  pendingFiles: PendingFile[];
  setPreviewSrcList: Setter<string[]>;
  setPreviewCurrentIndex: Setter<number>;
  setPreviewVisible: Setter<boolean>;
  handleRemovePendingImage: (id: string) => void;
  handleRemovePendingFile: (id: string) => void;
}>) {
  return (
    <>
            {pendingImages.length > 0 && (
              <div
                style={{
                  display: 'flex',
                  gap: 8,
                  marginBottom: 8,
                  flexWrap: 'wrap',
                  alignItems: 'center',
                }}
              >
                {pendingImages.map((item, idx) => (
                  <div key={item.id} style={{ position: 'relative', width: 64, height: 64 }}>
                    <button
                      type="button"
                      onClick={() => {
                        setPreviewSrcList(pendingImages.map((img) => img.previewUrl));
                        setPreviewCurrentIndex(idx);
                        setPreviewVisible(true);
                      }}
                      style={{ border: 'none', background: 'transparent', padding: 0, cursor: 'pointer', width: '100%', height: '100%', display: 'block', borderRadius: 'var(--semi-border-radius-medium)', overflow: 'hidden' }}
                    >
                      <img
                        src={item.previewUrl}
                        alt={item.file.name}
                        style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }}
                      />
                    </button>
                    <Button
                      size="small"
                      theme="solid"
                      type="danger"
                      onClick={() => handleRemovePendingImage(item.id)}
                      style={{
                        position: 'absolute',
                        top: -6,
                        right: -6,
                        minWidth: 20,
                        height: 20,
                        padding: 0,
                        borderRadius: '50%',
                        lineHeight: '20px',
                      }}
                    >
                      ×
                    </Button>
                  </div>
                ))}
              </div>
            )}

            {pendingFiles.length > 0 && (
              <div style={{ display: 'flex', gap: 6, marginBottom: 8, flexWrap: 'wrap', alignItems: 'center' }}>
                {pendingFiles.map((item) => (
                  <div
                    key={item.id}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 6,
                      padding: '4px 8px',
                      background: 'var(--semi-color-fill-0)',
                      borderRadius: 'var(--semi-border-radius-medium)',
                      border: '1px solid var(--semi-color-border)',
                      maxWidth: 220,
                      position: 'relative',
                    }}
                  >
                    <span style={{ display: 'flex', flexShrink: 0 }}>{getFileTypeIcon(item.file.type, 18, item.file.name)}</span>
                    <div style={{ minWidth: 0, flex: 1 }}>
                      <div style={{ fontSize: 12, fontWeight: 500, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{item.file.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--semi-color-text-3)' }}>{formatBytes(item.file.size)}</div>
                    </div>
                    <Button
                      size="small"
                      theme="borderless"
                      type="danger"
                      onClick={() => handleRemovePendingFile(item.id)}
                      style={{ padding: '0 2px', height: 'auto', minWidth: 'auto', flexShrink: 0 }}
                    >
                      <X size={12} />
                    </Button>
                  </div>
                ))}
              </div>
            )}
    </>
  );
}
