import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { positionContract, userContract, type Position } from '@zenith/shared/identity';
import { downloadOperation, operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type PositionForm = { name: string; code: string; sort: number; status: 'enabled' | 'disabled'; remark: string };
type Paged = { list: Position[]; total: number; page: number; pageSize: number };
const emptyForm: PositionForm = { name: '', code: '', sort: 0, status: 'enabled', remark: '' };

export function PositionsPage() {
  const { can } = useAuth(); const queryClient = useQueryClient();
  const [page, setPage] = useState(1); const [pageSize, setPageSize] = useState(10);
  const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('');
  const [status, setStatus] = useState(''); const [editing, setEditing] = useState<Position | null>(null);
  const [open, setOpen] = useState(false); const [form, setForm] = useState<PositionForm>(emptyForm);
  const [memberPosition, setMemberPosition] = useState<Position | null>(null); const [memberIds,setMemberIds] = useState<number[]>([]);
  const list = useQuery({ queryKey: ['positions', page, pageSize, search, status], queryFn: () => operation<Paged>(positionContract.list, { query: { page, pageSize, keyword: search, status } }) });
  const exportCsv = useMutation({ mutationFn: () => downloadOperation(positionContract.exportCsv, { query: { keyword: search, status } }), onSuccess: blob => {
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href = url; link.download = 'positions.csv'; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, onError: error => Toast.error(String(error)) });
  const members = useQuery({ queryKey: ['position-members', memberPosition?.id], queryFn: () => operation<{id:number}[]>(positionContract.members,{id:memberPosition!.id}), enabled: memberPosition !== null });
  const users = useQuery({ queryKey: ['users-all'], queryFn: () => operation<{id:number;nickname:string;username:string}[]>(userContract.all), enabled: memberPosition !== null });
  useEffect(() => { if (members.data) setMemberIds(members.data.map(item=>item.id)); }, [members.data]);
  const save = useMutation({ mutationFn: async () => {
    const parsed = (editing ? positionContract.update.body : positionContract.create.body)?.safeParse(form);
    if (parsed && !parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '表单无效');
    return editing ? operation<Position>(positionContract.update, { id: editing.id, body: form }) : operation<Position>(positionContract.create, { body: form });
  }, onSuccess: () => { setOpen(false); void queryClient.invalidateQueries({ queryKey: ['positions'] }); Toast.success('保存成功'); }, onError: error => Toast.error(String(error)) });
  const remove = useMutation({ mutationFn: (id: number) => operation<null>(positionContract.remove, { id }), onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['positions'] }); Toast.success('删除成功'); }, onError: error => Toast.error(String(error)) });
  const saveMembers = useMutation({ mutationFn: () => operation<null>(positionContract.setMembers,{id:memberPosition!.id,body:{userIds:memberIds}}), onSuccess: () => { setMemberPosition(null); void queryClient.invalidateQueries({queryKey:['positions']});void queryClient.invalidateQueries({queryKey:['position-members']});Toast.success('成员已更新'); }, onError: error=>Toast.error(String(error)) });
  const startCreate = () => { setEditing(null); setForm(emptyForm); setOpen(true); };
  const startEdit = (position: Position) => { setEditing(position); setForm({ name: position.name, code: position.code, sort: position.sort, status: position.status, remark: position.remark ?? '' }); setOpen(true); };
  const askDelete = (position: Position) => Modal.confirm({ title: `删除岗位「${position.name}」？`, content: '删除后无法恢复。', okType: 'danger', onOk: () => remove.mutateAsync(position.id) });
  return <>
    <PageHeader title="岗位管理" description="维护组织岗位与状态" actions={can('system:position:create') ? <Button theme="solid" onClick={startCreate}>新增岗位</Button> : null}/>
    <div className="zenith-card">
      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <Input placeholder="搜索名称 / 编码" value={keyword} onChange={setKeyword} onEnterPress={() => { setSearch(keyword); setPage(1); }} style={{ width: 230 }}/>
        <Select value={status} onChange={value => { setStatus(String(value)); setPage(1); }} style={{ width: 130 }} optionList={[{ label: '全部状态', value: '' }, { label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/>
        <Button onClick={() => { setSearch(keyword); setPage(1); }}>查询</Button>
        <Button onClick={() => { setKeyword(''); setSearch(''); setStatus(''); setPage(1); }}>重置</Button>
        {can('system:position:list') && <Button loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>导出 CSV</Button>}
      </div>
      <Table<Position> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} pagination={{ currentPage: page, pageSize, total: list.data?.total ?? 0, onPageChange: setPage, onPageSizeChange: setPageSize }} columns={[
        { title: '岗位名称', dataIndex: 'name' }, { title: '编码', dataIndex: 'code' }, { title: '排序', dataIndex: 'sort' },
        { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' },
        { title: '创建时间', dataIndex: 'createdAt', render: value => new Date(String(value)).toLocaleString() },
        { title: '成员', dataIndex: 'userCount', render: value => Number(value) },
        { title: '操作', render: (_, position) => <div style={{ display: 'flex', gap: 8 }}>{can('system:position:update') && <Button theme="borderless" onClick={() => startEdit(position)}>编辑</Button>}{can('system:position:update') && <Button theme="borderless" onClick={() => setMemberPosition(position)}>分配成员</Button>}{can('system:position:delete') && <Button theme="borderless" type="danger" onClick={() => askDelete(position)}>删除</Button>}</div> },
      ]}/>
    </div>
    <Modal title={editing ? '编辑岗位' : '新增岗位'} visible={open} onCancel={() => setOpen(false)} onOk={() => save.mutate()} okButtonProps={{ loading: save.isPending }}>
      <div style={{ display: 'grid', gap: 14 }}>
        <div className="zenith-form-row"><label>岗位名称</label><Input value={form.name} onChange={name => setForm({ ...form, name })}/></div>
        <div className="zenith-form-row"><label>岗位编码</label><Input value={form.code} onChange={code => setForm({ ...form, code })}/></div>
        <div className="zenith-form-row"><label>排序</label><Input type="number" value={String(form.sort)} onChange={sort => setForm({ ...form, sort: Number(sort) })}/></div>
        <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value => setForm({ ...form, status: value as PositionForm['status'] })} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
        <div className="zenith-form-row"><label>备注</label><Input value={form.remark} onChange={remark => setForm({ ...form, remark })}/></div>
      </div>
    </Modal>
    <Modal title={`分配成员 · ${memberPosition?.name ?? ''}`} visible={memberPosition !== null} onCancel={() => setMemberPosition(null)} onOk={() => saveMembers.mutate()} okButtonProps={{loading:saveMembers.isPending}}>
      <p>选择岗位成员，保存后立即生效。</p>
      <Select multiple filter value={memberIds} onChange={values => setMemberIds((values as number[]) ?? [])} style={{width:'100%'}} optionList={(users.data ?? []).map(item=>({label:`${item.nickname} (${item.username})`,value:item.id}))}/>
    </Modal>
  </>;
}
