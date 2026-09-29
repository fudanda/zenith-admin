import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Toast } from '@douyinfe/semi-ui';
import { settingsContract, type SettingsEnvelope } from '@zenith/shared/settings';
import { ApiError, operation } from '@zenith/admin-client';
import { PageHeader } from '@zenith/admin-ui';

type Field = 'uploadMaxSizeMb' | 'chunkThresholdMb' | 'chunkSizeMb';

export function FileSettingsPage() {
  const cache = useQueryClient();
  const settings = useQuery({ queryKey: ['settings', 'files'], queryFn: () => operation<SettingsEnvelope<'files'>>(settingsContract.getFiles) });
  const [form, setForm] = useState<Record<Field, string>>({ uploadMaxSizeMb: '0', chunkThresholdMb: '5', chunkSizeMb: '5' });
  useEffect(() => {
    if (!settings.data) return;
    const { uploadMaxSizeMb, chunkThresholdMb, chunkSizeMb } = settings.data.effective;
    setForm({ uploadMaxSizeMb: String(uploadMaxSizeMb), chunkThresholdMb: String(chunkThresholdMb), chunkSizeMb: String(chunkSizeMb) });
  }, [settings.data]);
  const save = useMutation({
    mutationFn: async () => {
      if (!settings.data) throw new Error('设置尚未加载');
      const values = Object.fromEntries(Object.entries(form).map(([key, value]) => [key, Number(value)])) as Record<Field, number>;
      if (Object.values(values).some(value => !Number.isInteger(value)) || values.uploadMaxSizeMb < 0 || values.uploadMaxSizeMb > 102400 || values.chunkThresholdMb < 1 || values.chunkThresholdMb > 32 || values.chunkSizeMb < 5 || values.chunkSizeMb > 32) {
        throw new Error('请输入有效的整数：大小 0–102400 MB、阈值 1–32 MB、分片 5–32 MB');
      }
      return operation<SettingsEnvelope<'files'>>(settingsContract.updateFiles, { body: { version: settings.data.version, data: { ...settings.data.effective, ...values } } });
    },
    onSuccess: () => { void cache.invalidateQueries({ queryKey: ['settings', 'files'] }); void cache.invalidateQueries({ queryKey: ['files', 'upload-policy'] }); Toast.success('上传设置已生效'); },
    onError: error => { if (error instanceof ApiError && error.status === 409) void settings.refetch(); Toast.error(String(error)); },
  });
  const field = (key: Field, title: string, description: string) => <div className="zenith-form-row" key={key}><label>{title}</label><Input value={form[key]} onChange={value => setForm(current => ({ ...current, [key]: value }))} suffix="MB"/><div style={{ color: 'var(--semi-color-text-2)', fontSize: 12 }}>{description}</div></div>;
  return <><PageHeader title="文件上传设置" description="平台级策略；保存后新上传请求立即使用最新值"/>
    <div className="zenith-card" style={{ maxWidth: 660, display: 'grid', gap: 18 }}>
      {settings.isLoading && <p>加载中…</p>}{settings.isError && <p>读取失败：{String(settings.error)}</p>}
      {settings.data && <><div>当前版本：{settings.data.version}</div>
        {field('uploadMaxSizeMb', '单文件大小上限', '0 表示无业务上限；单请求上传仍受 100 MB 传输限制，更大文件自动分片。')}
        {field('chunkThresholdMb', '分片上传阈值', '文件大于此值时使用断点续传。')}
        {field('chunkSizeMb', '分片大小', '服务端最终裁定的最小分片大小。')}
        <div><Button theme="solid" loading={save.isPending} onClick={() => save.mutate()}>保存设置</Button></div>
      </>}
    </div>
  </>;
}
