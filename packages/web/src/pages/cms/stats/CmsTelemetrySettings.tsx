import { Banner, Form } from '@douyinfe/semi-ui';
import type { CmsSite } from '@arcbase/shared/cms';
import { EditFormSheet } from '@/components/EditFormModal';
import { FormTimezoneSelect } from '@/components/FormTimezoneSelect';
import { useEditModal } from '@/hooks/useEditModal';
import { useConfigureCmsTelemetry } from '@/hooks/queries/cms-stats';

interface TelemetryValues { enabled: boolean; timeZone: string }
export function useCmsTelemetrySettings() {
  const mutation = useConfigureCmsTelemetry();
  const modal = useEditModal<TelemetryValues & { id: number }, TelemetryValues>({
    entityName: '访问采集',
    save: { isPending: mutation.isPending, mutateAsync: async ({ id, values }) => {
      const saved = await mutation.mutateAsync({ params: { id: id! }, body: values });
      return { id: saved.siteId, enabled: saved.enabled, timeZone: saved.timeZone };
    } },
    successMessage: () => '采集配置已保存，请发布配置使线上页面生效',
  });
  return {
    open: (site: CmsSite) => {
      const settings = site.settings.telemetry as Partial<TelemetryValues> | undefined;
      modal.openEdit({ id: site.id, enabled: settings?.enabled === true, timeZone: settings?.timeZone ?? 'Asia/Shanghai' });
    },
    editor: <EditFormSheet modal={modal} title="访问采集设置" width={520} header={<Banner type="info" description="一个开关管理浏览、搜索、阅读和成功转化采集。保存后需要发布站点配置；预览、爬虫与探针不进入正式运营指标。" />}>
      <Form.Switch field="enabled" label="启用访问采集" />
      <FormTimezoneSelect field="timeZone" label="站点统计时区" extraText="自然日、小时分桶和对比周期均按此时区计算。报表中可以临时选择其他统计时区。" />
    </EditFormSheet>,
  };
}
