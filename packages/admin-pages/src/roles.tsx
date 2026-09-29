import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Table, Toast } from '@douyinfe/semi-ui';
import { roleContract, menuContract, userContract, departmentContract, type Role, type Menu, type Department } from '@zenith/shared/identity';
import { downloadOperation, operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: Role[]; total: number; page: number; pageSize: number };
type Form = { name: string; code: string; description: string; status: 'enabled' | 'disabled'; dataScope: Role['dataScope']; deptScopeIds: number[] };
const blank: Form = { name: '', code: '', description: '', status: 'enabled', dataScope: 'all', deptScopeIds: [] };

export function RolesPage() {
  const { can } = useAuth(); const cache = useQueryClient();
  const [page, setPage] = useState(1); const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('');
  const [status, setStatus] = useState(''); const [startTime, setStartTime] = useState(''); const [endTime, setEndTime] = useState('');
  const [range, setRange] = useState({ startTime: '', endTime: '' });
  const [editing, setEditing] = useState<Role | null>(null); const [open, setOpen] = useState(false); const [form, setForm] = useState<Form>(blank);
  const [assigning, setAssigning] = useState<Role | null>(null); const [menuIds, setMenuIds] = useState<number[]>([]);
  const [memberRole, setMemberRole] = useState<Role | null>(null); const [userIds, setUserIds] = useState<number[]>([]);
  const rows = useQuery({ queryKey: ['roles', page, search, status, range], queryFn: () => operation<Paged>(roleContract.list, { query: { page, pageSize: 10, keyword: search, status, ...range } }) });
  const exportCsv = useMutation({ mutationFn: () => downloadOperation(roleContract.exportCsv, { query: { keyword: search, status, ...range } }), onSuccess: blob => {
    const url = URL.createObjectURL(blob); const link = document.createElement('a'); link.href = url; link.download = 'roles.csv'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 60_000);
  }, onError: error => Toast.error(String(error)) });
  const menus = useQuery({ queryKey: ['menus-flat'], queryFn: () => operation<Menu[]>(menuContract.flat), enabled: assigning !== null && can('system:menu:list') });
  const departments = useQuery({ queryKey: ['departments'], queryFn: () => operation<Department[]>(departmentContract.flat), enabled: open && can('system:department:list') });
  const users = useQuery({ queryKey: ['users-all'], queryFn: () => operation<{ id: number; nickname: string; username: string }[]>(userContract.all), enabled: memberRole !== null });
  const members = useQuery({ queryKey: ['role-users', memberRole?.id], queryFn: () => operation<{ id: number }[]>(roleContract.users, { id: memberRole!.id }), enabled: memberRole !== null });
  const save = useMutation({ mutationFn: () => {
    const body = { ...form, description: form.description || undefined };
    const parsed = (editing ? roleContract.update.body : roleContract.create.body)?.safeParse(body);
    if (parsed && !parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '角色信息无效');
    return editing ? operation<Role>(roleContract.update, { id: editing.id, body }) : operation<Role>(roleContract.create, { body });
  }, onSuccess: () => { setOpen(false); void cache.invalidateQueries({ queryKey: ['roles'] }); Toast.success('保存成功'); }, onError: error => Toast.error(String(error)) });
  const remove = useMutation({ mutationFn: (id: number) => operation<null>(roleContract.remove, { id }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['roles'] }); Toast.success('已删除'); }, onError: error => Toast.error(String(error)) });
  const assignMenus = useMutation({ mutationFn: () => operation<null>(roleContract.assignMenus, { id: assigning!.id, body: { menuIds } }), onSuccess: () => { setAssigning(null); void cache.invalidateQueries({ queryKey: ['roles'] }); Toast.success('权限已更新'); }, onError: error => Toast.error(String(error)) });
  const assignUsers = useMutation({ mutationFn: () => operation<null>(roleContract.assignUsers, { id: memberRole!.id, body: { userIds } }), onSuccess: () => { setMemberRole(null); void cache.invalidateQueries({ queryKey: ['roles'] }); Toast.success('成员已更新'); }, onError: error => Toast.error(String(error)) });
  const edit = (row: Role) => { setEditing(row); setForm({ name: row.name, code: row.code, description: row.description ?? '', status: row.status, dataScope: row.dataScope, deptScopeIds: row.deptScopeIds ?? [] }); setOpen(true); };
  const openMembers = async (row: Role) => { setMemberRole(row); setUserIds([]); try { const list = await operation<{ id: number }[]>(roleContract.users, { id: row.id }); setUserIds(list.map(item => item.id)); } catch (error) { Toast.error(String(error)); } };
  const applyFilters = () => { setSearch(keyword); setRange({ startTime, endTime }); setPage(1); };
  return <><PageHeader title="角色管理" description="配置角色、数据范围和菜单权限" actions={can('system:role:create') ? <Button theme="solid" onClick={() => { setEditing(null); setForm(blank); setOpen(true); }}>新增角色</Button> : null}/>
    <div className="zenith-card"><div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
      <Input placeholder="名称或编码" value={keyword} onChange={setKeyword} onEnterPress={applyFilters} style={{ width: 200 }}/>
      <Select value={status} onChange={value => { setStatus(String(value)); setPage(1); }} style={{ width: 120 }} optionList={[{ label: '全部状态', value: '' }, { label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/>
      <Input placeholder="开始 YYYY-MM-DD" value={startTime} onChange={setStartTime} style={{ width: 160 }}/>
      <Input placeholder="结束 YYYY-MM-DD" value={endTime} onChange={setEndTime} style={{ width: 160 }}/>
      <Button onClick={applyFilters}>查询</Button><Button onClick={() => { setKeyword(''); setSearch(''); setStatus(''); setStartTime(''); setEndTime(''); setRange({ startTime: '', endTime: '' }); setPage(1); }}>重置</Button>
      {can('system:role:list') && <Button loading={exportCsv.isPending} onClick={() => exportCsv.mutate()}>导出 CSV</Button>}
    </div>
      {rows.isError && <p role="alert">{String(rows.error)}</p>}
      <Table<Role> rowKey="id" dataSource={rows.data?.list ?? []} loading={rows.isLoading} pagination={{ currentPage: page, pageSize: 10, total: rows.data?.total ?? 0, onPageChange: setPage }} columns={[
        { title: '角色', dataIndex: 'name' }, { title: '编码', dataIndex: 'code' }, { title: '数据范围', dataIndex: 'dataScope' }, { title: '用户数', dataIndex: 'userCount' }, { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' },
        { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 4 }}>{can('system:role:update') && <Button theme="borderless" onClick={() => edit(row)}>编辑</Button>}{can('system:role:assign') && <Button theme="borderless" onClick={() => { setAssigning(row); setMenuIds(row.menuIds ?? []); }}>菜单权限</Button>}{can('system:role:assign') && <Button theme="borderless" onClick={() => void openMembers(row)}>分配用户</Button>}{can('system:role:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除角色「${row.name}」？`, onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}</div> },
      ]}/></div>
    <Modal title={editing ? '编辑角色' : '新增角色'} visible={open} onCancel={() => setOpen(false)} onOk={() => save.mutate()} okButtonProps={{ loading: save.isPending }}><div style={{ display: 'grid', gap: 12 }}>
      <div className="zenith-form-row"><label>名称</label><Input value={form.name} onChange={name => setForm({ ...form, name })}/></div>
      <div className="zenith-form-row"><label>编码</label><Input value={form.code} onChange={code => setForm({ ...form, code })}/></div>
      <div className="zenith-form-row"><label>说明</label><Input value={form.description} onChange={description => setForm({ ...form, description })}/></div>
      <div className="zenith-form-row"><label>数据范围</label><Select value={form.dataScope} onChange={value => setForm({ ...form, dataScope: value as Form['dataScope'] })} optionList={['all', 'custom', 'dept_only', 'dept', 'self'].map(value => ({ label: value, value }))}/></div>
      {form.dataScope === 'custom' && <div className="zenith-form-row"><label>授权部门</label><Select multiple filter value={form.deptScopeIds} onChange={value => setForm({ ...form, deptScopeIds: (value as number[]) ?? [] })} optionList={(departments.data ?? []).map(row => ({ label: row.name, value: row.id }))}/></div>}
      <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value => setForm({ ...form, status: value as Form['status'] })} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
    </div></Modal>
    <Modal title={`菜单权限 · ${assigning?.name ?? ''}`} visible={assigning !== null} onCancel={() => setAssigning(null)} onOk={() => assignMenus.mutate()} okButtonProps={{ loading: assignMenus.isPending, disabled: !can('system:menu:list') }}><Select multiple filter value={menuIds} onChange={value => setMenuIds((value as number[]) ?? [])} style={{ width: '100%' }} optionList={(menus.data ?? []).map(row => ({ label: `${row.type === 'button' ? '操作' : '页面'} · ${row.title}`, value: row.id }))}/></Modal>
    <Modal title={`分配用户 · ${memberRole?.name ?? ''}`} visible={memberRole !== null} onCancel={() => setMemberRole(null)} onOk={() => assignUsers.mutate()} okButtonProps={{ loading: assignUsers.isPending }}><Select multiple filter value={userIds} onChange={value => setUserIds((value as number[]) ?? [])} style={{ width: '100%' }} optionList={(users.data ?? []).map(row => ({ label: `${row.nickname} (${row.username})`, value: row.id }))}/>{members.isLoading && <p>正在加载成员…</p>}</Modal>
  </>;
}
