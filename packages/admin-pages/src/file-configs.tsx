import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { fileStorageConfigContract, type FileStorageConfig } from '@zenith/shared/platform';
import { operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: FileStorageConfig[]; total: number; page: number; pageSize: number };
type Form = { name: string; localRootPath: string; status: 'enabled' | 'disabled'; isDefault: boolean; remark: string };
const blank: Form = { name: '', localRootPath: '', status: 'enabled', isDefault: false, remark: '' };

export function FileConfigsPage() {
  const { can } = useAuth(); const cache = useQueryClient();
  const [page, setPage] = useState(1); const [editing, setEditing] = useState<FileStorageConfig | null>(null);
  const [open, setOpen] = useState(false); const [form, setForm] = useState<Form>(blank);
  const list = useQuery({ queryKey: ['file-configs', page], queryFn: () => operation<Paged>(fileStorageConfigContract.list, { query: { page, pageSize: 10 } }) });
  const body = () => ({ ...form, provider: 'local', urlStrategy: 'proxy', objectAcl: 'default', presignedExpirySeconds: 3600, remark: form.remark || null });
  const save = useMutation({ mutationFn: () => editing ? operation<FileStorageConfig>(fileStorageConfigContract.update, { id: editing.id, body: body() }) : operation<FileStorageConfig>(fileStorageConfigContract.create, { body: body() }), onSuccess: () => { setOpen(false); void cache.invalidateQueries({ queryKey: ['file-configs'] }); Toast.success('保存成功'); }, onError: error => Toast.error(String(error)) });
  const remove = useMutation({ mutationFn: (id: number) => operation<null>(fileStorageConfigContract.remove, { id }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['file-configs'] }); Toast.success('已删除'); }, onError: error => Toast.error(String(error)) });
  const makeDefault = useMutation({ mutationFn: (id: number) => operation<FileStorageConfig>(fileStorageConfigContract.setDefault, { id }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['file-configs'] }); Toast.success('默认存储已更新'); }, onError: error => Toast.error(String(error)) });
  const test = useMutation({ mutationFn: () => operation<unknown>(fileStorageConfigContract.test, { body: body() }), onSuccess: () => Toast.success('目录可写'), onError: error => Toast.error(String(error)) });
  return <><PageHeader title="文件存储配置" description="首版支持本地磁盘，上传前请设置可写的默认目录" actions={can('system:file:config:create') ? <Button theme="solid" onClick={() => { setEditing(null); setForm(blank); setOpen(true); }}>新增配置</Button> : null}/>
    <div className="zenith-card"><Table<FileStorageConfig> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} pagination={{ currentPage: page, pageSize: 10, total: list.data?.total ?? 0, onPageChange: setPage }} columns={[
      { title: '名称', dataIndex: 'name' }, { title: '目录', dataIndex: 'localRootPath' }, { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' }, { title: '默认', dataIndex: 'isDefault', render: value => value ? '是' : '否' },
      { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 4 }}>{can('system:file:config:update') && <Button theme="borderless" onClick={() => { setEditing(row); setForm({ name: row.name, localRootPath: row.localRootPath ?? '', status: row.status, isDefault: row.isDefault, remark: row.remark ?? '' }); setOpen(true); }}>编辑</Button>}{can('system:file:config:default') && !row.isDefault && row.status === 'enabled' && <Button theme="borderless" onClick={() => makeDefault.mutate(row.id)}>设为默认</Button>}{can('system:file:config:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除配置「${row.name}」？`, onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}</div> },
    ]}/></div>
    <Modal title={editing ? '编辑本地存储' : '新增本地存储'} visible={open} onCancel={() => setOpen(false)} onOk={() => save.mutate()} okButtonProps={{ loading: save.isPending }} footer={undefined}><div style={{ display: 'grid', gap: 12 }}>
      <div className="zenith-form-row"><label>名称</label><Input value={form.name} onChange={name => setForm({ ...form, name })}/></div>
      <div className="zenith-form-row"><label>存储目录</label><Input value={form.localRootPath} onChange={localRootPath => setForm({ ...form, localRootPath })} placeholder="绝对路径"/></div>
      <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value => setForm({ ...form, status: value as Form['status'] })} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
      <div className="zenith-form-row"><label>备注</label><Input value={form.remark} onChange={remark => setForm({ ...form, remark })}/></div>
      {!editing && <Button onClick={() => test.mutate()} loading={test.isPending}>测试目录</Button>}
    </div></Modal>
  </>;
}
