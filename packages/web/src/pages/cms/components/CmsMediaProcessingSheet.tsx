import { useState } from 'react';
import { Banner, Button, Form, SideSheet, Space, Spin, Tag, Toast, Typography, useFormApi, useFormState } from '@douyinfe/semi-ui';
import type { BodyOf } from '@arcbase/shared/core';
import { cmsResourceContract, type CmsResource } from '@arcbase/shared/cms';
import { useCmsMedia, useCmsMediaTask, useProcessCmsMedia } from '@/hooks/queries/cms-resources';
import { useAsyncTaskAction } from '@/hooks/queries/async-tasks';
import { usePermission } from '@/hooks/usePermission';
import AsyncTaskProgress from '@/components/AsyncTaskProgress';
import { CmsResourcePicker, CmsResourcePreview } from './CmsResourcePicker';
import { formatCmsMediaDuration } from './cms-media';
import './cms-assets.css';

const STATUS_LABELS = { pending: '等待处理', running: '处理中', success: '处理完成', failed: '处理失败', cancelled: '已取消' };
type Values = BodyOf<typeof cmsResourceContract.processMedia>;

function FocalPoint({ resource, disabled }: Readonly<{ resource: CmsResource; disabled: boolean }>) {
  const form = useFormApi();
  const state = useFormState();
  const point = (state.values as Values).focalPoint ?? { x: 0.5, y: 0.5 };
  return <>
    <Form.Slot label="图片焦点">
      <button type="button" className="cms-media-processing__focal" aria-label="点击图片设置焦点" disabled={disabled} onClick={(event) => {
        const rect = event.currentTarget.getBoundingClientRect();
        form.setValue('focalPoint', { x: Math.max(0, Math.min(1, (event.clientX - rect.left) / rect.width)), y: Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) });
      }}>
        <img src={resource.url} alt={resource.name} />
        <span className="cms-media-processing__focus" style={{ left: `${point.x * 100}%`, top: `${point.y * 100}%` }} />
      </button>
      <Typography.Text size="small" type="tertiary">点击原图标记焦点，封面裁切会优先展示这个位置。</Typography.Text>
    </Form.Slot>
    <Space wrap>
      <Form.InputNumber field="focalPoint.x" label="水平位置" min={0} max={1} step={0.05} disabled={disabled} />
      <Form.InputNumber field="focalPoint.y" label="垂直位置" min={0} max={1} step={0.05} disabled={disabled} />
    </Space>
  </>;
}

function SubtitlePicker({ resource, disabled }: Readonly<{ resource: CmsResource; disabled: boolean }>) {
  const [visible, setVisible] = useState(false);
  const [name, setName] = useState<string | null>(null);
  const form = useFormApi();
  const state = useFormState();
  const selected = (state.values as Values).subtitleResourceId;
  return <>
    <Form.Slot label="字幕文件">
      <Space wrap>
        <Button disabled={disabled} onClick={() => setVisible(true)}>选择本站 VTT 字幕</Button>
        {selected ? <><Typography.Text>{name ?? `已关联字幕素材 #${selected}`}</Typography.Text><Button disabled={disabled} theme="borderless" onClick={() => { form.setValue('subtitleResourceId', null); setName(null); }}>清除字幕</Button></> : null}
      </Space>
    </Form.Slot>
    <Form.Input field="subtitleLanguage" label="字幕语言" disabled={disabled} placeholder="zh / en / zh-CN" maxLength={64} rules={[{ pattern: /^[a-z]{2,3}(?:-[A-Za-z0-9]{2,8})*$/, message: '请输入语言代码，如 zh 或 en' }]} />
    <Form.Input field="subtitleLabel" label="字幕名称" disabled={disabled} maxLength={80} rules={[{ required: true, message: '请输入字幕名称' }]} />
    <CmsResourcePicker siteId={resource.siteId} type="document" visible={visible} allowUpload={false} title="选择本站已上传的 VTT 字幕" onCancel={() => setVisible(false)} onSelect={(subtitle) => {
      if (!subtitle.fileId || !/\.vtt$/i.test(subtitle.name)) { Toast.warning('请选择已上传的 .vtt 字幕文件'); return; }
      form.setValue('subtitleResourceId', subtitle.id); setName(subtitle.name); setVisible(false);
    }} />
  </>;
}

export default function CmsMediaProcessingSheet({ resource, onClose }: Readonly<{ resource: CmsResource; onClose: () => void }>) {
  const { hasPermission } = usePermission();
  const query = useCmsMedia(resource.id);
  const processing = query.data?.processing;
  const task = useCmsMediaTask(processing?.taskId, resource.id, resource.siteId);
  const submit = useProcessCmsMedia(resource.siteId);
  const cancel = useAsyncTaskAction('cancel');
  const status = task.data?.status ?? processing?.status;
  const active = status === 'pending' || status === 'running';
  const readOnly = !hasPermission('cms:resource:update');
  const blocked = readOnly || active || submit.isPending || !resource.fileId;
  const result = processing?.result ?? resource.media;
  const versionId = query.data?.assetVersionId;
  return <SideSheet title={`媒体处理 · ${resource.name}`} visible width={720} onCancel={onClose} closeOnEsc>
    {query.isError ? <Banner type="danger" description="媒体信息加载失败"><Button onClick={() => void query.refetch()}>重试</Button></Banner> : <Spin spinning={query.isLoading}>
      <Space vertical align="start" spacing="medium" style={{ width: '100%' }}>
        <Typography.Text type="tertiary">处理结果用于新保存的内容修订，已发布内容保持原来的媒体版本。</Typography.Text>
        <Space>{status ? <Tag color={status === 'failed' ? 'red' : status === 'success' ? 'green' : 'blue'}>{STATUS_LABELS[status]}</Tag> : <Tag>尚未处理</Tag>}
          {result?.width && result.height ? <Typography.Text>{result.width} × {result.height}</Typography.Text> : null}
          {result?.duration ? <Typography.Text>时长 {formatCmsMediaDuration(result.duration)}</Typography.Text> : null}
        </Space>
        {task.data ? <AsyncTaskProgress task={task.data} /> : null}
        {(task.data?.errorMessage ?? processing?.errorMessage) ? <Banner type="danger" description={task.data?.errorMessage ?? processing?.errorMessage} /> : null}
        {result?.animated ? <Banner type="info" description="动态图片保留原文件的全部动画帧，本次仅提取媒体信息和保存焦点。" /> : null}
        {!resource.fileId ? <Banner type="warning" description="外部地址不能进行服务器媒体处理，请先上传本站文件。" /> : null}
        {resource.type !== 'image' ? <div className="cms-asset-field__player"><CmsResourcePreview resource={{ ...resource, media: result }} /></div> : null}
        {result?.variants.length ? <Space wrap>{result.variants.map((variant) => <a key={variant.targetWidth} href={variant.url} target="_blank" rel="noreferrer">{variant.targetWidth}px WebP（{variant.width} × {variant.height}）</a>)}</Space> : null}
      </Space>
      {/* A media production command stays open to show progress; it is not a CRUD edit modal. */}
      {query.isSuccess ? <Form<Values> key={`${resource.id}:${versionId ?? 'current'}:${processing?.id ?? 0}`} initValues={{ assetVersionId: versionId ?? undefined,
        focalPoint: processing?.focalPoint ?? result?.focalPoint ?? { x: 0.5, y: 0.5 }, posterTime: processing?.posterTime ?? 0,
        subtitleResourceId: processing?.subtitleResourceId ?? null, subtitleLanguage: processing?.subtitleLanguage ?? 'zh', subtitleLabel: processing?.subtitleLabel ?? '中文字幕' }}
        onSubmit={async (values) => {
          await submit.mutateAsync({ params: { id: resource.id }, body: { ...values, assetVersionId: versionId ?? undefined } });
          Toast.success('媒体处理任务已提交');
        }}>
        {({ formApi }) => <>
          {resource.type === 'image' ? <FocalPoint resource={resource} disabled={blocked} /> : <>
            {resource.type === 'video' ? <Form.InputNumber field="posterTime" label="海报截取时间（秒）" min={0} max={86400} step={1} disabled={blocked} /> : null}
            <SubtitlePicker resource={resource} disabled={blocked} />
          </>}
          <Space style={{ marginTop: 16 }}>
            <Button type="primary" disabled={blocked} loading={submit.isPending} onClick={() => void formApi.submitForm()}>{status === 'failed' || status === 'cancelled' ? '重新处理' : processing ? '应用设置并重新处理' : '开始处理'}</Button>
            {active && processing?.taskId && !readOnly ? <Button loading={cancel.isPending} onClick={() => void cancel.mutateAsync({ params: { id: processing.taskId! } })}>取消处理</Button> : null}
            <Button onClick={() => void query.refetch()}>刷新状态</Button>
          </Space>
        </>}
      </Form> : null}
    </Spin>}
  </SideSheet>;
}
