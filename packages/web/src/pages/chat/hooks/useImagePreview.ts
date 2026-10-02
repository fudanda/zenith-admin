import { useCallback } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { fetchManagedFileBlob } from '@/utils/file-utils';
import { createDisplayableImageUrl } from '@/utils/image-decode';
import type { ChatMessage } from '@zenith/shared/chat';
import type { Setter } from '../types';

/** 图片点击预览：blob 会话式加载 + 预览列表填充（自 ChatPage 原样搬移） */
export function useImagePreview({
  previewSessionRef, previewBlobUrlsRef, setPreviewSrcList, setPreviewCurrentIndex, setPreviewVisible,
}: {
  previewSessionRef: React.RefObject<number>;
  previewBlobUrlsRef: React.RefObject<string[]>;
  setPreviewSrcList: Setter<string[]>;
  setPreviewCurrentIndex: Setter<number>;
  setPreviewVisible: Setter<boolean>;
}) {
  const cleanupPreviewBlobs = useCallback(() => {
    previewBlobUrlsRef.current.forEach((u) => { if (u) URL.revokeObjectURL(u); });
    previewBlobUrlsRef.current = [];
  }, [previewBlobUrlsRef]);

  const openImagePreview = useCallback(async (clickedMsg: ChatMessage, allImgs: ChatMessage[]) => {
    const session = ++previewSessionRef.current;
    const clickedIndex = allImgs.findIndex((m) => m.id === clickedMsg.id);
    if (clickedIndex < 0) return;
    cleanupPreviewBlobs();
    try {
      const clickedBlob = await fetchManagedFileBlob(clickedMsg.content);
      if (previewSessionRef.current !== session) return;
      const clickedAsset = clickedMsg.extra?.asset;
      const clickedUrl = await createDisplayableImageUrl(clickedBlob, clickedAsset?.mimeType, clickedAsset?.name);
      if (previewSessionRef.current !== session) {
        URL.revokeObjectURL(clickedUrl);
        return;
      }
      previewBlobUrlsRef.current[clickedIndex] = clickedUrl;
      const initialUrls = allImgs.map((_, i) => (i === clickedIndex ? clickedUrl : ''));
      setPreviewSrcList([...initialUrls]);
      setPreviewCurrentIndex(clickedIndex);
      setPreviewVisible(true);
      // 后台加载其余图片
      for (const [i, imgMsg] of allImgs.entries()) {
        if (i === clickedIndex) continue;
        try {
          const blob = await fetchManagedFileBlob(imgMsg.content);
          if (previewSessionRef.current !== session) break;
          const asset = imgMsg.extra?.asset;
          const url = await createDisplayableImageUrl(blob, asset?.mimeType, asset?.name);
          if (previewSessionRef.current !== session) {
            URL.revokeObjectURL(url);
            break;
          }
          previewBlobUrlsRef.current[i] = url;
          setPreviewSrcList((prev) => { const copy = [...prev]; copy[i] = url; return copy; });
        } catch { /* skip failed */ }
      }
    } catch { Toast.error('图片加载失败'); }
  }, [cleanupPreviewBlobs, previewBlobUrlsRef, previewSessionRef, setPreviewCurrentIndex, setPreviewSrcList, setPreviewVisible]);

  return { cleanupPreviewBlobs, openImagePreview };
}
