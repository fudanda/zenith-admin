import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Progress, Select, Table, Toast } from '@douyinfe/semi-ui';
import { fileContract, type ManagedFile } from '@zenith/shared/platform';
import { downloadOperation, operation, request, uploadOne } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: ManagedFile[]; total: number; page: number; pageSize: number };
type UploadPolicy = { uploadMaxSizeMb: number; chunkThresholdMb: number; chunkSizeMb: number };

export function FilesPage() {
  const { can } = useAuth(); const cache = useQueryClient(); const input = useRef<HTMLInputElement>(null); const uploadCancel = useRef<AbortController | null>(null);
  const [page, setPage] = useState(1); const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'restricted'>('restricted'); const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false); const [preview, setPreview] = useState<ManagedFile | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const list = useQuery({ queryKey: ['files', page, search], queryFn: () => operation<Paged>(fileContract.list, { query: { page, pageSize: 10, keyword: search } }) });
  const remove = useMutation({ mutationFn: (id: string) => operation<null>(fileContract.remove, { params: { id } }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['files'] }); Toast.success('已删除'); }, onError: error => Toast.error(String(error)) });
  const removeBatch = useMutation({ mutationFn: () => operation<null>(fileContract.removeBatch, { body: { ids: selectedIds } }), onSuccess: () => { setSelectedIds([]); void cache.invalidateQueries({ queryKey: ['files'] }); Toast.success('已批量删除'); }, onError: error => Toast.error(String(error)) });
  const downloadBatch = useMutation({ mutationFn: () => downloadOperation(fileContract.batchDownload, { ids: selectedIds }), onSuccess: blob => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'zenith-files.zip'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, onError: error => Toast.error(String(error)) });
  const startUpload = async (file: File | undefined) => {
    if (!file) return;
    const controller = new AbortController(); uploadCancel.current = controller; setUploading(true); setProgress(0);
    try {
      const policy = await operation<UploadPolicy>(fileContract.uploadPolicy);
      if (policy.uploadMaxSizeMb > 0 && file.size > policy.uploadMaxSizeMb * 1024 * 1024) throw new Error('文件超过上传大小限制');
      if (file.size > Math.min(policy.chunkThresholdMb * 1024 * 1024, 100 * 1024 * 1024)) await uploadChunked(file, visibility, policy.chunkSizeMb, setProgress, controller.signal);
      else await uploadOne<ManagedFile>(file, visibility, setProgress, controller.signal);
      await cache.invalidateQueries({ queryKey: ['files'] }); Toast.success('上传完成');
    } catch (error) { Toast.error(String(error)); }
    finally { uploadCancel.current = null; setUploading(false); setProgress(null); if (input.current) input.current.value = ''; }
  };
  return <><PageHeader title="文件管理" description="本地文件上传、预览和访问控制" actions={can('system:file:upload') ? <div style={{ display: 'flex', gap: 8 }}><Select value={visibility} onChange={value => setVisibility(value as typeof visibility)} optionList={[{ label: '私有', value: 'restricted' }, { label: '公开', value: 'public' }]}/><input ref={input} type="file" hidden onChange={event => void startUpload(event.target.files?.[0])}/><Button theme="solid" loading={uploading} onClick={() => input.current?.click()}>上传文件</Button></div> : null}/>
    {progress !== null && <div className="zenith-card"><Progress percent={progress} showInfo/><Button onClick={() => uploadCancel.current?.abort()}>取消上传</Button></div>}
    <div className="zenith-card"><div style={{ display: 'flex', gap: 8, marginBottom: 16 }}><Input placeholder="文件名或对象键" value={keyword} onChange={setKeyword} onEnterPress={() => { setSearch(keyword); setPage(1); }} style={{ width: 240 }}/><Button onClick={() => { setSearch(keyword); setPage(1); }}>查询</Button>{can('system:file:list') && <Button disabled={selectedIds.length === 0} loading={downloadBatch.isPending} onClick={() => downloadBatch.mutate()}>批量下载</Button>}{can('system:file:delete') && <Button type="danger" disabled={selectedIds.length === 0} loading={removeBatch.isPending} onClick={() => Modal.confirm({ title: `删除选中的 ${selectedIds.length} 个文件？`, content: '删除后无法恢复。', okType: 'danger', onOk: () => removeBatch.mutateAsync() })}>批量删除</Button>}</div>
      <Table<ManagedFile> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} rowSelection={can('system:file:list') ? { selectedRowKeys: selectedIds, onChange: keys => setSelectedIds(keys as string[]) } : undefined} pagination={{ currentPage: page, pageSize: 10, total: list.data?.total ?? 0, onPageChange: setPage }} columns={[
        { title: '文件名', dataIndex: 'originalName' }, { title: '大小', dataIndex: 'size', render: value => `${(Number(value) / 1024).toFixed(1)} KiB` }, { title: '可见性', dataIndex: 'visibility', render: value => value === 'public' ? '公开' : '私有' }, { title: '上传人', dataIndex: 'uploaderName' },
        { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 4 }}><Button theme="borderless" onClick={() => setPreview(row)}>预览</Button><Button theme="borderless" onClick={() => window.open(row.url, '_blank', 'noopener,noreferrer')}>下载</Button>{can('system:file:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除文件「${row.originalName}」？`, onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}</div> },
      ]}/></div>
    <Modal title={preview?.originalName ?? '文件预览'} visible={preview !== null} onCancel={() => setPreview(null)} footer={null} width={800}>{preview && (preview.mimeType?.startsWith('image/') ? <img src={preview.url} alt={preview.originalName} style={{ maxWidth: '100%', maxHeight: 600 }}/> : <div><p>此文件类型请使用下载查看。</p><a href={preview.url} target="_blank" rel="noreferrer">打开文件</a></div>)}</Modal>
  </>;
}

async function uploadChunked(file: File, visibility: 'public' | 'restricted', chunkSizeMb: number, onProgress: (percent: number) => void, signal: AbortSignal): Promise<ManagedFile> {
  type UploadInit = { uploadId: string; chunkSize: number; totalChunks: number; received: number[] };
  type UploadStatus = UploadInit & { status: string };
  const storageKey = `zenith-upload:${file.name}:${file.size}:${file.lastModified}:${visibility}`;
  let session: UploadInit | undefined;
  const oldId = sessionStorage.getItem(storageKey);
  if (oldId) {
    try {
      const status = await operation<UploadStatus>(fileContract.uploadStatus, { params: { uploadId: oldId } });
      if (status.status === 'uploading' && status.totalChunks === Math.ceil(file.size / status.chunkSize)) session = status;
    } catch { /* Expired or revoked session: initialize a new upload. */ }
  }
  if (!session) {
    sessionStorage.removeItem(storageKey);
    session = await operation<UploadInit>(fileContract.uploadInit, { body: { fileName: file.name, fileSize: file.size, mimeType: file.type, chunkSize: chunkSizeMb * 1024 * 1024, visibility } });
    sessionStorage.setItem(storageKey, session.uploadId);
  }
  const current = session;
  const received = new Set(current.received);
  let uploadedBytes = [...received].reduce((sum, index) => sum + Math.min(current.chunkSize, file.size - index * current.chunkSize), 0);
  onProgress(file.size ? Math.round(uploadedBytes * 100 / file.size) : 0);
  try {
    for (let index = 0; index < current.totalChunks; index++) {
      if (received.has(index)) continue;
      if (signal.aborted) throw new DOMException('上传已取消', 'AbortError');
      const start = index * current.chunkSize;
      const chunk = file.slice(start, Math.min(start + current.chunkSize, file.size));
      const form = new FormData(); form.set('uploadId', current.uploadId); form.set('index', String(index)); form.set('chunk', chunk, file.name);
      await request(fileContract.uploadChunk.fullPath.replace(/^\/api/, ''), { method: 'POST', body: form, signal });
      uploadedBytes += chunk.size;
      onProgress(file.size ? Math.round(uploadedBytes * 100 / file.size) : 100);
    }
    const result = await operation<ManagedFile>(fileContract.uploadComplete, { body: { uploadId: current.uploadId } });
    sessionStorage.removeItem(storageKey);
    return result;
  } catch (error) {
    if (signal.aborted) {
      try { await operation(fileContract.uploadAbort, { params: { uploadId: current.uploadId } }); } catch { /* Expiry cleanup will retry. */ }
      sessionStorage.removeItem(storageKey);
    }
    throw error;
  }
}
