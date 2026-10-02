import { useCallback, useState } from 'react';
import { Toast } from '@douyinfe/semi-ui';
import { exportJobContract } from '@arcbase/shared/tasks';
import { api, urlOf } from '@/lib/contract-query';
import { ApiError } from '@/lib/query';
import { request } from '@/utils/request';

/** 导出当前会话聊天记录（自 ChatPage 原样搬移：state + handler） */
export function useExportChat() {
  // 导出当前会话聊天记录（走导出中心，xlsx 同步下载）
  const [exportingChat, setExportingChat] = useState(false);
  const handleExportChat = useCallback(async (convId: number) => {
    setExportingChat(true);
    try {
      let result;
      try {
        result = await api(exportJobContract.create, {
          body: { entity: 'chat.messages', format: 'xlsx', query: { conversationId: convId }, raw: false, watermark: true, executionMode: 'sync' },
        });
      } catch (err) {
        // 业务失败已由请求层提示
        if (err instanceof ApiError) return;
        throw err;
      }
      if (!result) { Toast.error('导出失败'); return; }
      const { job, mode } = result;
      if (job.status === 'success' && job.fileId) {
        await request.download(urlOf(exportJobContract.download, { params: { id: job.id } }), job.filename ?? '聊天记录.xlsx');
        Toast.success('导出完成');
        return;
      }
      Toast.success(mode === 'async' ? '导出任务已提交，可在导出中心查看进度' : '导出任务已创建');
    } finally {
      setExportingChat(false);
    }
  }, []);

  return { exportingChat, handleExportChat };
}
