import { Toast } from '@douyinfe/semi-ui';
import { exportJobContract, type ExportJobFormat, type ExportJobRequestMode } from '@zenith/shared/tasks';
import { urlOf, useApiMutation } from '@/lib/contract-query';
import { request } from '@/utils/request';
import { useState } from 'react';
import { foundationTransferContract } from '@zenith/shared/foundation-transfer';
import { IS_GO_FOUNDATION } from '@/lib/foundation-mode';
import { goTransport } from '@/lib/go-transport';
import { downloadBlob } from '@/utils/download';

interface ExportJobRunOptions {
  entity: string;
  format: ExportJobFormat;
  query: Record<string, unknown>;
  raw?: boolean;
  watermark?: boolean;
  executionMode?: ExportJobRequestMode;
}

export function useExportJobRunner() {
  const exportMutation = useApiMutation(exportJobContract.create);
  const [goPending, setGoPending] = useState<ExportJobFormat | null>(null);

  const runExport = async (options: ExportJobRunOptions) => {
    const { entity, format, query, raw = false, watermark = true, executionMode = 'sync' } = options;
    if (IS_GO_FOUNDATION) {
      if (!['csv','xlsx'].includes(format) || raw) throw new Error('首版支持脱敏 CSV 和 XLSX 导出');
      setGoPending(format);
      try {
        const blob = await goTransport.readBlob(urlOf(foundationTransferContract.export, { params: { entity: foundationTransferContract.export.params.parse({ entity }).entity }, query: { ...query, format: format as 'csv' | 'xlsx' } }));
        downloadBlob(blob, `${entity}.${format}`);
        Toast.success('导出完成');
      } finally { setGoPending(null); }
      return;
    }
    const { job, mode } = await exportMutation.mutateAsync({ body: { entity, format, query, raw, watermark, executionMode } });
    if (job.status === 'success' && job.fileId) {
      await request.download(urlOf(exportJobContract.download, { params: { id: job.id } }), job.filename ?? `${entity}.${format}`);
      Toast.success('导出完成');
      return;
    }
    Toast.success(mode === 'async' ? '导出任务已提交，可在导出中心查看进度' : '导出任务已创建');
  };

  return {
    runExport,
    isPending: goPending !== null || exportMutation.isPending,
    pendingFormat: goPending ?? exportMutation.variables?.body.format ?? null,
  };
}
