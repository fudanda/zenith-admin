import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Progress, Select, Table, Toast } from '@douyinfe/semi-ui';
import { fileContract, type ManagedFile } from '@zenith/shared/platform';
import { operation, uploadOne } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: ManagedFile[]; total: number; page: number; pageSize: number };

export function FilesPage() {
  const { can } = useAuth(); const cache = useQueryClient(); const input = useRef<HTMLInputElement>(null);
  const [page, setPage] = useState(1); const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('');
  const [visibility, setVisibility] = useState<'public' | 'restricted'>('restricted'); const [progress, setProgress] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false); const [preview, setPreview] = useState<ManagedFile | null>(null);
  const list = useQuery({ queryKey: ['files', page, search], queryFn: () => operation<Paged>(fileContract.list, { query: { page, pageSize: 10, keyword: search } }) });
  const remove = useMutation({ mutationFn: (id: string) => operation<null>(fileContract.remove, { params: { id } }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['files'] }); Toast.success('已删除'); }, onError: error => Toast.error(String(error)) });
  const startUpload = async (file: File | undefined) => { if (!file) return; setUploading(true); setProgress(0); try { await uploadOne<ManagedFile>(file, visibility, setProgress); await cache.invalidateQueries({ queryKey: ['files'] }); Toast.success('上传完成'); } catch (error) { Toast.error(String(error)); } finally { setUploading(false); setProgress(null); if (input.current) input.current.value = ''; } };
  return <><PageHeader title="文件管理" description="本地文件上传、预览和访问控制" actions={can('system:file:upload') ? <div style={{ display: 'flex', gap: 8 }}><Select value={visibility} onChange={value => setVisibility(value as typeof visibility)} optionList={[{ label: '私有', value: 'restricted' }, { label: '公开', value: 'public' }]}/><input ref={input} type="file" hidden onChange={event => void startUpload(event.target.files?.[0])}/><Button theme="solid" loading={uploading} onClick={() => input.current?.click()}>上传文件</Button></div> : null}/>
    {progress !== null && <div className="zenith-card"><Progress percent={progress} showInfo/></div>}
    <div className="zenith-card"><div style={{ display: 'flex', gap: 8, marginBottom: 16 }}><Input placeholder="文件名或对象键" value={keyword} onChange={setKeyword} onEnterPress={() => { setSearch(keyword); setPage(1); }} style={{ width: 240 }}/><Button onClick={() => { setSearch(keyword); setPage(1); }}>查询</Button></div>
      <Table<ManagedFile> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} pagination={{ currentPage: page, pageSize: 10, total: list.data?.total ?? 0, onPageChange: setPage }} columns={[
        { title: '文件名', dataIndex: 'originalName' }, { title: '大小', dataIndex: 'size', render: value => `${(Number(value) / 1024).toFixed(1)} KiB` }, { title: '可见性', dataIndex: 'visibility', render: value => value === 'public' ? '公开' : '私有' }, { title: '上传人', dataIndex: 'uploaderName' },
        { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 4 }}><Button theme="borderless" onClick={() => setPreview(row)}>预览</Button><Button theme="borderless" onClick={() => window.open(row.url, '_blank', 'noopener,noreferrer')}>下载</Button>{can('system:file:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除文件「${row.originalName}」？`, onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}</div> },
      ]}/></div>
    <Modal title={preview?.originalName ?? '文件预览'} visible={preview !== null} onCancel={() => setPreview(null)} footer={null} width={800}>{preview && (preview.mimeType?.startsWith('image/') ? <img src={preview.url} alt={preview.originalName} style={{ maxWidth: '100%', maxHeight: 600 }}/> : <div><p>此文件类型请使用下载查看。</p><a href={preview.url} target="_blank" rel="noreferrer">打开文件</a></div>)}</Modal>
  </>;
}
