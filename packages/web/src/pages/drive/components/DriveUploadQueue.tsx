import { useState } from 'react';
import { Button, Checkbox, Modal, Progress, Tag, Typography } from '@douyinfe/semi-ui';
import { CheckCircle2, ChevronDown, ChevronUp, CircleX, Loader2, X, Zap } from 'lucide-react';
import { formatBytes } from '@arcbase/shared/core';
import type { UploadConflict, UploadItem } from '../hooks/useDriveUploader';

interface DriveUploadQueueProps {
  readonly items: UploadItem[];
  readonly activeCount: number;
  readonly conflict: UploadConflict | null;
  readonly onCancel: (id: string) => void;
  readonly onClear: () => void;
}

function statusLabel(item: UploadItem) {
  switch (item.status) {
    case 'pending': return '等待中';
    case 'hashing': return '计算校验…';
    case 'uploading': return `${item.percent}%`;
    case 'done': return item.instant ? '秒传' : '完成';
    case 'skipped': return '已跳过';
    case 'cancelled': return '已取消';
    case 'error': return item.error ?? '失败';
    default: return '';
  }
}

/** 右下角浮动上传队列 + 同名冲突询问弹窗 */
export function DriveUploadQueue({ items, activeCount, conflict, onCancel, onClear }: DriveUploadQueueProps) {
  const [collapsed, setCollapsed] = useState(false);
  const [applyAll, setApplyAll] = useState(false);

  return (
    <>
      {items.length > 0 && (
        <div className="drive-upload-queue" role="region" aria-label="上传队列">
          <div className="drive-upload-queue__header">
            <Typography.Text strong>
              {activeCount > 0 ? `正在上传 ${activeCount} 个文件` : `上传完成（${items.length}）`}
            </Typography.Text>
            <div className="drive-upload-queue__header-actions">
              <Button size="small" theme="borderless" type="tertiary" icon={collapsed ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
                aria-label={collapsed ? '展开' : '收起'} onClick={() => setCollapsed((v) => !v)} />
              <Button size="small" theme="borderless" type="tertiary" icon={<X size={14} />} aria-label="清空已完成" onClick={onClear} disabled={activeCount > 0 && items.length === activeCount} />
            </div>
          </div>
          {!collapsed && (
            <ul className="drive-upload-queue__list">
              {items.map((item) => (
                <li key={item.id} className={`drive-upload-queue__item drive-upload-queue__item--${item.status}`}>
                  <div className="drive-upload-queue__item-main">
                    <Typography.Text ellipsis={{ showTooltip: true }} className="drive-upload-queue__name">{item.file.name}</Typography.Text>
                    <span className="drive-upload-queue__meta">{formatBytes(item.file.size)}</span>
                  </div>
                  <div className="drive-upload-queue__item-side">
                    {item.status === 'uploading' && <Progress percent={item.percent} size="small" style={{ width: 72 }} aria-label="上传进度" />}
                    {(item.status === 'pending' || item.status === 'hashing') && <Loader2 size={14} className="drive-upload-queue__spin" />}
                    {item.status === 'done' && (item.instant ? <Tag color="green" size="small" prefixIcon={<Zap size={12} />}>秒传</Tag> : <CheckCircle2 size={14} color="var(--semi-color-success)" />)}
                    {(item.status === 'error' || item.status === 'cancelled' || item.status === 'skipped') && (
                      <Typography.Text type={item.status === 'error' ? 'danger' : 'tertiary'} size="small" ellipsis={{ showTooltip: true }} style={{ maxWidth: 120 }}>{statusLabel(item)}</Typography.Text>
                    )}
                    {(item.status === 'pending' || item.status === 'hashing' || item.status === 'uploading') && (
                      <Button size="small" theme="borderless" type="tertiary" icon={<CircleX size={14} />} aria-label="取消" onClick={() => onCancel(item.id)} />
                    )}
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <Modal
        visible={!!conflict}
        title="同名文件已存在"
        closeOnEsc
        onCancel={() => conflict?.resolve(null)}
        footer={(
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <Checkbox checked={applyAll} onChange={(e) => setApplyAll(!!e.target.checked)}>对本批次其余冲突应用相同选择</Checkbox>
            <div style={{ display: 'flex', gap: 8 }}>
              <Button type="tertiary" onClick={() => conflict?.resolve(null)}>跳过</Button>
              <Button onClick={() => conflict?.resolve({ policy: 'version', applyAll })}>覆盖为新版本</Button>
              <Button type="primary" theme="solid" onClick={() => conflict?.resolve({ policy: 'rename', applyAll })}>保留两者</Button>
            </div>
          </div>
        )}
      >
        <Typography.Paragraph>
          目标目录已存在「{conflict?.fileName}」。「保留两者」会自动重命名新文件；「覆盖为新版本」把上传内容作为该文件的新版本，历史版本仍可回滚。
        </Typography.Paragraph>
      </Modal>
    </>
  );
}
