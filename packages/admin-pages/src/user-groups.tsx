import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Input, Modal, Select, Switch, Table, Toast } from '@douyinfe/semi-ui';
import { userGroupContract, roleContract, userContract, departmentContract, positionContract, type UserGroup, type Role, type User, type Department, type Position, type UserGroupMemberRule } from '@zenith/shared/identity';
import { operation } from '@zenith/admin-client';
import { useAuth } from '@zenith/admin-core';
import { PageHeader } from '@zenith/admin-ui';

type Paged = { list: UserGroup[]; total: number; page: number; pageSize: number };
type Form = { name: string; code: string; description: string; status: 'enabled' | 'disabled'; memberMode: 'static' | 'dynamic'; memberRule: UserGroupMemberRule; roleIds: number[]; userIds: number[] };
const emptyRule = (): UserGroupMemberRule => ({ departmentIds: [], includeSubDepartments: false, positionIds: [], includeUserIds: [], excludeUserIds: [] });
const blank = (): Form => ({ name: '', code: '', description: '', status: 'enabled', memberMode: 'static', memberRule: emptyRule(), roleIds: [], userIds: [] });

export function UserGroupsPage() {
  const { can } = useAuth(); const cache = useQueryClient();
  const [page, setPage] = useState(1); const [keyword, setKeyword] = useState(''); const [search, setSearch] = useState('');
  const [editing, setEditing] = useState<UserGroup | null>(null); const [open, setOpen] = useState(false); const [form, setForm] = useState<Form>(blank);
  const [memberGroup, setMemberGroup] = useState<UserGroup | null>(null); const [memberIds, setMemberIds] = useState<number[]>([]);
  const [roleGroup, setRoleGroup] = useState<UserGroup | null>(null); const [roleIds, setRoleIds] = useState<number[]>([]);
  const list = useQuery({ queryKey: ['user-groups', page, search], queryFn: () => operation<Paged>(userGroupContract.list, { query: { page, pageSize: 10, keyword: search } }) });
  const users = useQuery({ queryKey: ['users-all'], queryFn: () => operation<User[]>(userContract.all), enabled: memberGroup !== null || (open && form.memberMode === 'dynamic') });
  const departments = useQuery({ queryKey: ['departments-flat'], queryFn: () => operation<Department[]>(departmentContract.flat), enabled: open && form.memberMode === 'dynamic' });
  const positions = useQuery({ queryKey: ['positions-all'], queryFn: () => operation<Position[]>(positionContract.all), enabled: open && form.memberMode === 'dynamic' });
  const roles = useQuery({ queryKey: ['roles-all'], queryFn: () => operation<Role[]>(roleContract.all), enabled: roleGroup !== null });
  const save = useMutation({ mutationFn: () => {
    const body = { name: form.name, code: form.code, description: form.description, status: form.status,
      memberMode: form.memberMode, memberRule: form.memberMode === 'dynamic' ? form.memberRule : null };
    const parsed = (editing ? userGroupContract.update.body : userGroupContract.create.body)?.safeParse(editing ? body : { ...body, roleIds: [], userIds: [] });
    if (parsed && !parsed.success) throw new Error(parsed.error.issues[0]?.message ?? '表单无效');
    return editing ? operation<UserGroup>(userGroupContract.update, { id: editing.id, body }) : operation<UserGroup>(userGroupContract.create, { body: { ...body, roleIds: [], userIds: [] } });
  },
    onSuccess: () => { setOpen(false); void cache.invalidateQueries({ queryKey: ['user-groups'] }); Toast.success('保存成功'); }, onError: error => Toast.error(String(error)) });
  const remove = useMutation({ mutationFn: (id: number) => operation<null>(userGroupContract.remove, { id }), onSuccess: () => { void cache.invalidateQueries({ queryKey: ['user-groups'] }); Toast.success('已删除'); }, onError: error => Toast.error(String(error)) });
  const saveMembers = useMutation({ mutationFn: () => operation<null>(userGroupContract.setMembers, { id: memberGroup!.id, body: { userIds: memberIds } }), onSuccess: () => { setMemberGroup(null); void cache.invalidateQueries({ queryKey: ['user-groups'] }); Toast.success('成员已更新'); }, onError: error => Toast.error(String(error)) });
  const saveRoles = useMutation({ mutationFn: () => operation<null>(userGroupContract.setRoles, { id: roleGroup!.id, body: { roleIds } }), onSuccess: () => { setRoleGroup(null); void cache.invalidateQueries({ queryKey: ['user-groups'] }); Toast.success('角色已更新'); }, onError: error => Toast.error(String(error)) });
  const preview = useMutation({ mutationFn: () => operation<{ total: number; joiningCount: number; leavingCount: number }>(userGroupContract.rulePreview, { body: { groupId: editing?.id, memberRule: form.memberRule } }), onError: error => Toast.error(String(error)) });
  const sync = useMutation({ mutationFn: (id: number) => operation<{ added: number; removed: number }>(userGroupContract.sync, { id }), onSuccess: result => { void cache.invalidateQueries({ queryKey: ['user-groups'] }); Toast.success(`同步完成：加入 ${result.added} 人，移除 ${result.removed} 人`); }, onError: error => Toast.error(String(error)) });
  const openMembers = async (row: UserGroup) => { setMemberGroup(row); try { const result = await operation<{ id: number }[]>(userGroupContract.members, { id: row.id }); setMemberIds(result.map(item => item.id)); } catch (error) { Toast.error(String(error)); } };
  const openRoles = async (row: UserGroup) => { setRoleGroup(row); try { const result = await operation<{ id: number }[]>(userGroupContract.roles, { id: row.id }); setRoleIds(result.map(item => item.id)); } catch (error) { Toast.error(String(error)); } };
  return <><PageHeader title="用户组管理" description="维护手工与动态成员组，成员继承绑定角色" actions={can('system:user-groups:create') ? <Button theme="solid" onClick={() => { setEditing(null); setForm(blank()); setOpen(true); }}>新增用户组</Button> : null}/>
    <div className="zenith-card"><div style={{ display: 'flex', gap: 8, marginBottom: 16 }}><Input placeholder="名称或编码" value={keyword} onChange={setKeyword} onEnterPress={() => { setSearch(keyword); setPage(1); }} style={{ width: 230 }}/><Button onClick={() => { setSearch(keyword); setPage(1); }}>查询</Button></div>
      <Table<UserGroup> rowKey="id" dataSource={list.data?.list ?? []} loading={list.isLoading} pagination={{ currentPage: page, pageSize: 10, total: list.data?.total ?? 0, onPageChange: setPage }} columns={[
        { title: '名称', dataIndex: 'name' }, { title: '编码', dataIndex: 'code' }, { title: '模式', dataIndex: 'memberMode', render: value => value === 'dynamic' ? '动态规则' : '手工' }, { title: '成员', dataIndex: 'memberCount' }, { title: '角色', dataIndex: 'roleCount' }, { title: '状态', dataIndex: 'status', render: value => value === 'enabled' ? '启用' : '停用' },
        { title: '操作', render: (_, row) => <div style={{ display: 'flex', gap: 4 }}>{can('system:user-groups:update') && <Button theme="borderless" onClick={() => { setEditing(row); setForm({ name: row.name, code: row.code, description: row.description ?? '', status: row.status, memberMode: row.memberMode, memberRule: row.memberRule ?? emptyRule(), roleIds: [], userIds: [] }); setOpen(true); }}>编辑</Button>}{can('system:user-groups:assign') && row.memberMode === 'static' && <Button theme="borderless" onClick={() => void openMembers(row)}>分配成员</Button>}{can('system:user-groups:assign') && row.memberMode === 'dynamic' && <Button theme="borderless" onClick={() => sync.mutate(row.id)}>同步成员</Button>}{can('system:user-groups:assign') && <Button theme="borderless" onClick={() => void openRoles(row)}>绑定角色</Button>}{can('system:user-groups:delete') && <Button theme="borderless" type="danger" onClick={() => Modal.confirm({ title: `删除用户组「${row.name}」？`, onOk: () => remove.mutateAsync(row.id) })}>删除</Button>}</div> },
      ]}/></div>
    <Modal title={editing ? '编辑用户组' : '新增用户组'} visible={open} onCancel={() => setOpen(false)} onOk={() => save.mutate()} okButtonProps={{ loading: save.isPending }} width={660}><div style={{ display: 'grid', gap: 12 }}>
      <div className="zenith-form-row"><label>名称</label><Input value={form.name} onChange={name => setForm({ ...form, name })}/></div>
      <div className="zenith-form-row"><label>编码</label><Input value={form.code} onChange={code => setForm({ ...form, code })}/></div>
      <div className="zenith-form-row"><label>说明</label><Input value={form.description} onChange={description => setForm({ ...form, description })}/></div>
      <div className="zenith-form-row"><label>成员模式</label><Select value={form.memberMode} onChange={value => { setForm({ ...form, memberMode: value as Form['memberMode'] }); preview.reset(); }} optionList={[{ label: '手工维护', value: 'static' }, { label: '动态规则', value: 'dynamic' }]}/></div>
      {form.memberMode === 'dynamic' && <>
        <p>部门与岗位条件相互取交集；强制包含可补充成员，排除名单优先。仅匹配当前租户中启用的账号。</p>
        <div className="zenith-form-row"><label>部门</label><Select multiple filter value={form.memberRule.departmentIds ?? []} onChange={value => setForm({ ...form, memberRule: { ...form.memberRule, departmentIds: (value as number[]) ?? [] } })} style={{ width: '100%' }} optionList={(departments.data ?? []).map(row => ({ label: row.name, value: row.id }))}/></div>
        <div className="zenith-form-row"><label>包含子部门</label><Switch checked={form.memberRule.includeSubDepartments ?? false} onChange={includeSubDepartments => setForm({ ...form, memberRule: { ...form.memberRule, includeSubDepartments } })}/></div>
        <div className="zenith-form-row"><label>岗位</label><Select multiple filter value={form.memberRule.positionIds ?? []} onChange={value => setForm({ ...form, memberRule: { ...form.memberRule, positionIds: (value as number[]) ?? [] } })} style={{ width: '100%' }} optionList={(positions.data ?? []).map(row => ({ label: row.name, value: row.id }))}/></div>
        <div className="zenith-form-row"><label>强制包含</label><Select multiple filter value={form.memberRule.includeUserIds ?? []} onChange={value => setForm({ ...form, memberRule: { ...form.memberRule, includeUserIds: (value as number[]) ?? [] } })} style={{ width: '100%' }} optionList={(users.data ?? []).map(row => ({ label: row.nickname, value: row.id }))}/></div>
        <div className="zenith-form-row"><label>排除账号</label><Select multiple filter value={form.memberRule.excludeUserIds ?? []} onChange={value => setForm({ ...form, memberRule: { ...form.memberRule, excludeUserIds: (value as number[]) ?? [] } })} style={{ width: '100%' }} optionList={(users.data ?? []).map(row => ({ label: row.nickname, value: row.id }))}/></div>
        <div><Button loading={preview.isPending} onClick={() => preview.mutate()}>预览成员变化</Button>{preview.data && <span style={{ marginLeft: 12 }}>目标 {preview.data.total} 人，加入 {preview.data.joiningCount} 人，移除 {preview.data.leavingCount} 人</span>}</div>
      </>}
      <div className="zenith-form-row"><label>状态</label><Select value={form.status} onChange={value => setForm({ ...form, status: value as Form['status'] })} optionList={[{ label: '启用', value: 'enabled' }, { label: '停用', value: 'disabled' }]}/></div>
    </div></Modal>
    <Modal title={`成员 · ${memberGroup?.name ?? ''}`} visible={memberGroup !== null} onCancel={() => setMemberGroup(null)} onOk={() => saveMembers.mutate()} okButtonProps={{ loading: saveMembers.isPending }}><Select multiple filter value={memberIds} onChange={value => setMemberIds((value as number[]) ?? [])} style={{ width: '100%' }} optionList={(users.data ?? []).map(row => ({ label: `${row.nickname} (${row.username})`, value: row.id }))}/></Modal>
    <Modal title={`继承角色 · ${roleGroup?.name ?? ''}`} visible={roleGroup !== null} onCancel={() => setRoleGroup(null)} onOk={() => saveRoles.mutate()} okButtonProps={{ loading: saveRoles.isPending }}><Select multiple filter value={roleIds} onChange={value => setRoleIds((value as number[]) ?? [])} style={{ width: '100%' }} optionList={(roles.data ?? []).map(row => ({ label: row.name, value: row.id }))}/></Modal>
  </>;
}
