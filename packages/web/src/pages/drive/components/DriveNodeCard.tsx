import { useEffect, useState } from 'react';
import { Checkbox, Tooltip } from '@douyinfe/semi-ui';
import { Folder, Lock, Star } from 'lucide-react';
import { formatBytes } from '@arcbase/shared/core';
import type { DriveNode } from '@arcbase/shared/drive';
import { getFileTypeIcon } from '@/utils/file-utils';
import { request } from '@/utils/request';

interface DriveNodeCardProps {
  readonly node: DriveNode;
  readonly selected: boolean;
  readonly onSelect: (id: number, checked: boolean) => void;
  readonly onOpen: (node: DriveNode) => void;
  readonly onContextMenu: (node: DriveNode, point: { x: number; y: number }) => void;
}

/** 缩略图需要带鉴权拉取，转成 object URL 展示 */
function useThumbnail(url: string | null) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!url) { setSrc(null); return; }
    let objectUrl: string | null = null;
    let cancelled = false;
    void request.getBlob(url).then((blob) => {
      if (cancelled || !blob) return;
      objectUrl = URL.createObjectURL(blob);
      setSrc(objectUrl);
    });
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [url]);
  return src;
}

export function DriveNodeCard({ node, selected, onSelect, onOpen, onContextMenu }: DriveNodeCardProps) {
  const thumb = useThumbnail(node.thumbnailUrl);
  const isFolder = node.type === 'folder';
  return (
    <div
      className={`drive-card${selected ? ' drive-card--selected' : ''}`}
      onContextMenu={(e) => { e.preventDefault(); onContextMenu(node, { x: e.clientX, y: e.clientY }); }}
    >
      <button
        type="button"
        className="drive-card__hit"
        aria-label={isFolder ? `打开文件夹 ${node.name}` : `打开 ${node.name}`}
        onClick={(e) => {
          if (e.ctrlKey || e.metaKey || e.shiftKey) { onSelect(node.id, !selected); return; }
          onOpen(node);
        }}
        onDoubleClick={() => onOpen(node)}
      />
      <div className="drive-card__checkbox">
        <Checkbox checked={selected} onChange={() => onSelect(node.id, !selected)} aria-label={`选择 ${node.name}`} />
      </div>
      <div className="drive-card__media">
        {isFolder ? (
          <Folder size={44} className="drive-card__folder-icon" />
        ) : thumb ? (
          <img src={thumb} alt="" className="drive-card__thumb" />
        ) : (
          <span className="drive-card__icon">{getFileTypeIcon(node.mimeType, 40, node.name)}</span>
        )}
        <div className="drive-card__badges">
          {node.isStarred && <Star size={12} fill="currentColor" className="drive-card__badge drive-card__badge--star" />}
          {node.lockedBy && <Lock size={12} className="drive-card__badge drive-card__badge--lock" />}
        </div>
      </div>
      <div className="drive-card__info">
        <Tooltip content={node.name} position="top">
          <div className="drive-card__name">{node.name}</div>
        </Tooltip>
        <div className="drive-card__meta">{isFolder ? '文件夹' : formatBytes(node.size)}</div>
      </div>
    </div>
  );
}
